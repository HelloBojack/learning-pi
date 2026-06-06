import { loadEnv, resolveChatEndpoint } from "../env";
import {
  ChatMessageSchema,
  ChatRequestSchema,
  ChatResponseSchema,
  type ChatMessage,
} from "../schemas/chat";
import { readOpenAiSseStream } from "./sse";
import { writeChunkToStdout } from "./stdout";

export class LlmApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "LlmApiError";
    this.status = status;
    this.body = body;
  }

  /** HTTP 4xx — 请求或鉴权问题，不应重试。 */
  isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

/** fetch 抛错或超时（非 HTTP 4xx/5xx 响应体）。 */
export class LlmNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmNetworkError";
  }
}

const FETCH_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

function isClientHttpStatus(status: number): boolean {
  return status >= 400 && status < 500;
}

function isRetryableHttpStatus(status: number): boolean {
  return status >= 500;
}

function retryDelayMs(attempt: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** attempt;
}

function toNetworkError(err: unknown): LlmNetworkError {
  if (err instanceof LlmNetworkError) return err;
  if (err instanceof DOMException && err.name === "AbortError") {
    return new LlmNetworkError("请求超时或已取消", { cause: err });
  }
  if (err instanceof Error) {
    return new LlmNetworkError(`网络请求失败: ${err.message}`, { cause: err });
  }
  return new LlmNetworkError("网络请求失败", { cause: err });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitBeforeRetry(
  attempt: number,
  options: ChatOptions,
): Promise<void> {
  if (options.retryBackoff) {
    await options.retryBackoff(attempt);
    return;
  }
  await sleep(retryDelayMs(attempt));
}

async function fetchChatWithRetry(
  endpoint: string,
  init: Omit<RequestInit, "signal">,
  options: ChatOptions,
): Promise<Response> {
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= FETCH_MAX_RETRIES; attempt++) {
    const signal =
      options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 60_000);

    try {
      const response = await fetch(endpoint, { ...init, signal });

      if (response.ok || isClientHttpStatus(response.status)) {
        return response;
      }

      lastResponse = response;
      if (isRetryableHttpStatus(response.status) && attempt < FETCH_MAX_RETRIES) {
        await waitBeforeRetry(attempt, options);
        continue;
      }
      return response;
    } catch (err) {
      if (options.signal?.aborted) {
        throw toNetworkError(err);
      }
      if (attempt < FETCH_MAX_RETRIES) {
        await waitBeforeRetry(attempt, options);
        continue;
      }
      throw toNetworkError(err);
    }
  }

  return lastResponse!;
}

export type ChatOptions = {
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 重试前等待；测试可传入 no-op 以跳过真实退避。 */
  retryBackoff?: (attempt: number) => Promise<void>;
};

async function postChat(
  messages: ChatMessage[],
  options: ChatOptions,
  stream: boolean,
): Promise<Response> {
  const env = loadEnv();
  const endpoint = resolveChatEndpoint(env);
  const model = options.model ?? env.API_MODEL ?? "azure/gpt-5.4-mini";

  const payload = ChatRequestSchema.parse({
    model,
    messages: messages.map((m) => ChatMessageSchema.parse(m)),
    temperature: options.temperature,
    stream,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.API_KEY}`,
  };
  if (stream) {
    headers.Accept = "text/event-stream";
  }

  return fetchChatWithRetry(
    endpoint,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    options,
  );
}

async function throwForFailedResponse(response: Response): Promise<never> {
  const raw = await response.text();
  const label = isClientHttpStatus(response.status) ? "客户端错误" : "服务端错误";
  throw new LlmApiError(
    `LLM ${label} (${response.status})`,
    response.status,
    raw,
  );
}

async function parseJsonChatResponse(
  response: Response,
  raw: string,
): Promise<string> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new LlmApiError("LLM returned non-JSON body", response.status, raw);
  }

  const parsed = ChatResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new LlmApiError(
      `Invalid LLM response shape: ${parsed.error.message}`,
      response.status,
      raw,
    );
  }

  const data = parsed.data;
  if (data.error) {
    throw new LlmApiError(data.error.message, response.status, raw);
  }

  const content = data.choices[0]?.message.content;
  if (content == null || content === "") {
    throw new LlmApiError("LLM returned empty content", response.status, raw);
  }

  return content;
}

/**
 * 流式调用大模型，逐段 yield 文本增量（OpenAI SSE）。
 */
export async function* chatStream(
  messages: ChatMessage[],
  options: ChatOptions = {},
): AsyncGenerator<string, string> {
  const response = await postChat(messages, options, true);

  if (!response.ok) {
    await throwForFailedResponse(response);
  }

  const contentType = response.headers.get("content-type") ?? "";

  // 部分网关在 stream:true 时仍返回整段 JSON
  if (contentType.includes("application/json")) {
    const raw = await response.text();
    const content = await parseJsonChatResponse(response, raw);
    for (const char of content) {
      yield char;
    }
    return content;
  }

  if (!response.body) {
    throw new LlmApiError("LLM returned no response body", response.status, "");
  }

  let full = "";
  try {
    for await (const chunk of readOpenAiSseStream(response.body)) {
      full += chunk;
      yield chunk;
    }
  } catch (err) {
    if (err instanceof Error && err.message) {
      throw new LlmApiError(err.message, response.status, full);
    }
    throw err;
  }

  if (!full) {
    throw new LlmApiError("LLM returned empty stream", response.status, "");
  }

  return full;
}

/**
 * 非流式调用，等待完整回复后返回（内部走 stream 收集，失败时兼容 JSON 响应）。
 */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const response = await postChat(messages, options, false);

  if (!response.ok) {
    await throwForFailedResponse(response);
  }

  const raw = await response.text();
  return parseJsonChatResponse(response, raw);
}

/** 消费流式输出并写入 stdout，返回完整文本。 */
export async function chatStreamToStdout(
  messages: ChatMessage[],
  options: ChatOptions = {},
  opts: { prefix?: string } = {},
): Promise<string> {
  const prefix = opts.prefix ?? "";
  if (prefix) process.stdout.write(prefix);

  let full = "";
  for await (const chunk of chatStream(messages, options)) {
    await writeChunkToStdout(chunk);
    full += chunk;
  }

  return full;
}
