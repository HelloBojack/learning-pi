import { loadEnv, resolveChatEndpoint } from "../env";
import {
  ChatMessageSchema,
  ChatRequestSchema,
  ChatResponseSchema,
  type ChatMessage,
} from "../schemas/chat";

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

/**
 * 调用 OpenAI 兼容的 Chat Completions 接口（POST + JSON）。
 * 在 .env 中配置 API_URL、API_KEY；若 API_URL 仅为域名，可用 API_CHAT_PATH 指定路径。
 */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const env = loadEnv();
  const endpoint = resolveChatEndpoint(env);
  const model = options.model ?? env.API_MODEL ?? "azure/gpt-5.4-mini";

  const payload = ChatRequestSchema.parse({
    model,
    messages: messages.map((m) => ChatMessageSchema.parse(m)),
    temperature: options.temperature,
    stream: false,
  });

  const timeoutMs = options.timeoutMs ?? 60_000;
  const signal =
    options.signal ??
    AbortSignal.timeout(timeoutMs);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.API_KEY}`,
    },
    body: JSON.stringify(payload),
    signal,
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new LlmApiError(
      `LLM request failed (${response.status})`,
      response.status,
      raw,
    );
  }

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
