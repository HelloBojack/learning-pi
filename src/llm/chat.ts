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
}

export type ChatOptions = {
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
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

  const signal =
    options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 60_000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.API_KEY}`,
  };
  if (stream) {
    headers.Accept = "text/event-stream";
  }

  return fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });
}

async function throwForFailedResponse(response: Response): Promise<never> {
  const raw = await response.text();
  throw new LlmApiError(
    `LLM request failed (${response.status})`,
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
