import { loadEnv, resolveChatEndpoint } from "../env";
import {
	assistantMessageFromResponse,
	type ChatMessage,
	ChatMessageSchema,
	ChatRequestSchema,
	ChatResponseSchema,
	type ToolCall,
	type ToolDefinition,
} from "../schemas/chat";
import { readOpenAiSseStream } from "./sse";
import { readOpenAiSseToolsStream } from "./sse-tools";
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

/** 用户主动取消（如 Ctrl+C）；partialContent 为已收到的文本。 */
export class LlmCancelledError extends Error {
	readonly partialContent: string;

	constructor(partialContent: string, options?: { cause?: unknown }) {
		super("已取消");
		this.name = "LlmCancelledError";
		this.partialContent = partialContent;
		if (options?.cause !== undefined) {
			this.cause = options.cause;
		}
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

function isAbortError(err: unknown): boolean {
	return (
		(err instanceof DOMException && err.name === "AbortError") ||
		(err instanceof Error && err.name === "AbortError")
	);
}

function throwIfUserCancelled(
	options: ChatOptions,
	partial: string,
	cause?: unknown,
): void {
	if (options.cancelSignal?.aborted) {
		throw new LlmCancelledError(partial, {
			cause: cause ?? options.cancelSignal.reason,
		});
	}
}

function rethrowStreamError(
	err: unknown,
	options: ChatOptions,
	partial: string,
): never {
	if (options.cancelSignal?.aborted) {
		throw new LlmCancelledError(partial, { cause: err });
	}
	if (isAbortError(err) && options.signal?.aborted) {
		throw toNetworkError(err);
	}
	if (err instanceof LlmApiError || err instanceof LlmNetworkError) {
		throw err;
	}
	if (err instanceof Error && err.message) {
		throw new LlmApiError(err.message, 200, partial);
	}
	throw err;
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
			if (
				isRetryableHttpStatus(response.status) &&
				attempt < FETCH_MAX_RETRIES
			) {
				await waitBeforeRetry(attempt, options);
				continue;
			}
			return response;
		} catch (err) {
			if (options.signal?.aborted || options.cancelSignal?.aborted) {
				throwIfUserCancelled(options, "");
				throw toNetworkError(err);
			}
			if (attempt < FETCH_MAX_RETRIES) {
				await waitBeforeRetry(attempt, options);
				continue;
			}
			throw toNetworkError(err);
		}
	}

	if (!lastResponse) {
		throw new LlmNetworkError("网络请求失败");
	}
	return lastResponse;
}

export type ChatOptions = {
	model?: string;
	temperature?: number;
	signal?: AbortSignal;
	/** 用户主动取消（如 Ctrl+C）；与 signal 组合时可区分超时与取消。 */
	cancelSignal?: AbortSignal;
	timeoutMs?: number;
	/** 重试前等待；测试可传入 no-op 以跳过真实退避。 */
	retryBackoff?: (attempt: number) => Promise<void>;
};

export type ChatWithToolsOptions = ChatOptions & {
	tools?: ToolDefinition[];
};

export type ChatWithToolsResult = {
	content: string;
	toolCalls: ToolCall[];
	finishReason: string | null;
	message: ChatMessage;
};

/** 合并用户取消与超时，供 REPL / CLI 使用。 */
export function createChatAbortControls(timeoutMs = 60_000): {
	cancel: AbortController;
	signal: AbortSignal;
} {
	const cancel = new AbortController();
	const signal = AbortSignal.any([
		cancel.signal,
		AbortSignal.timeout(timeoutMs),
	]);
	return { cancel, signal };
}

async function postChat(
	messages: ChatMessage[],
	options: ChatWithToolsOptions,
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
		tools: options.tools,
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
	const label = isClientHttpStatus(response.status)
		? "客户端错误"
		: "服务端错误";
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

function parseChatWithToolsResponse(
	response: Response,
	raw: string,
): ChatWithToolsResult {
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

	const choice = data.choices[0];
	if (!choice) {
		throw new LlmApiError("LLM returned no choices", response.status, raw);
	}

	const toolCalls = choice.message.tool_calls ?? [];
	const content = choice.message.content ?? "";

	if (toolCalls.length === 0 && content === "") {
		throw new LlmApiError("LLM returned empty content", response.status, raw);
	}

	return {
		content,
		toolCalls,
		finishReason: choice.finish_reason ?? null,
		message: assistantMessageFromResponse(choice.message),
	};
}

/**
 * 非流式调用，返回文本或 tool_calls（OpenAI 兼容 tools API）。
 */
export async function chatWithTools(
	messages: ChatMessage[],
	options: ChatWithToolsOptions = {},
): Promise<ChatWithToolsResult> {
	const response = await postChat(messages, options, false);

	if (!response.ok) {
		await throwForFailedResponse(response);
	}

	const raw = await response.text();
	return parseChatWithToolsResponse(response, raw);
}

function buildChatWithToolsResultFromStream(
	content: string,
	toolCalls: ToolCall[],
	finishReason: string | null,
): ChatWithToolsResult {
	if (toolCalls.length === 0 && content === "") {
		throw new LlmApiError("LLM returned empty stream", 200, "");
	}

	return {
		content,
		toolCalls,
		finishReason,
		message: assistantMessageFromResponse({
			role: "assistant",
			content: content || null,
			tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
		}),
	};
}

/**
 * 流式调用，逐段 yield 文本增量；结束时 return 完整 content 与 tool_calls。
 */
export async function* chatStreamWithTools(
	messages: ChatMessage[],
	options: ChatWithToolsOptions = {},
): AsyncGenerator<string, ChatWithToolsResult> {
	let full = "";

	try {
		const response = await postChat(messages, options, true);

		if (!response.ok) {
			await throwForFailedResponse(response);
		}

		const contentType = response.headers.get("content-type") ?? "";

		if (contentType.includes("application/json")) {
			const raw = await response.text();
			throwIfUserCancelled(options, full);
			const parsed = parseChatWithToolsResponse(response, raw);
			for (const char of parsed.content) {
				throwIfUserCancelled(options, full);
				full += char;
				yield char;
			}
			return parsed;
		}

		if (!response.body) {
			throw new LlmApiError(
				"LLM returned no response body",
				response.status,
				"",
			);
		}

		const stream = readOpenAiSseToolsStream(response.body, {
			signal: options.signal,
		});
		let result = await stream.next();
		while (!result.done) {
			throwIfUserCancelled(options, full);
			full += result.value;
			yield result.value;
			result = await stream.next();
		}

		return buildChatWithToolsResultFromStream(
			result.value.content,
			result.value.toolCalls,
			result.value.finishReason,
		);
	} catch (err) {
		if (err instanceof LlmCancelledError) throw err;
		if (options.cancelSignal?.aborted) {
			throw new LlmCancelledError(full, { cause: err });
		}
		rethrowStreamError(err, options, full);
	}
}

/**
 * 流式调用大模型，逐段 yield 文本增量（OpenAI SSE）。
 */
export async function* chatStream(
	messages: ChatMessage[],
	options: ChatOptions = {},
): AsyncGenerator<string, string> {
	let full = "";

	try {
		const response = await postChat(messages, options, true);

		if (!response.ok) {
			await throwForFailedResponse(response);
		}

		const contentType = response.headers.get("content-type") ?? "";

		// 部分网关在 stream:true 时仍返回整段 JSON
		if (contentType.includes("application/json")) {
			const raw = await response.text();
			throwIfUserCancelled(options, full);
			const content = await parseJsonChatResponse(response, raw);
			for (const char of content) {
				throwIfUserCancelled(options, full);
				full += char;
				yield char;
			}
			return content;
		}

		if (!response.body) {
			throw new LlmApiError(
				"LLM returned no response body",
				response.status,
				"",
			);
		}

		for await (const chunk of readOpenAiSseStream(response.body, {
			signal: options.signal,
		})) {
			throwIfUserCancelled(options, full);
			full += chunk;
			yield chunk;
		}
	} catch (err) {
		if (err instanceof LlmCancelledError) throw err;
		if (options.cancelSignal?.aborted) {
			throw new LlmCancelledError(full, { cause: err });
		}
		rethrowStreamError(err, options, full);
	}

	if (!full) {
		throw new LlmApiError("LLM returned empty stream", 200, "");
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

/** 消费流式输出并写入 stdout，返回完整文本（取消时抛出 LlmCancelledError 并携带已输出片段）。 */
export async function chatStreamToStdout(
	messages: ChatMessage[],
	options: ChatOptions = {},
	opts: { prefix?: string } = {},
): Promise<string> {
	const prefix = opts.prefix ?? "";
	if (prefix) process.stdout.write(prefix);

	let full = "";
	try {
		for await (const chunk of chatStream(messages, options)) {
			throwIfUserCancelled(options, full);
			await writeChunkToStdout(chunk);
			full += chunk;
		}
	} catch (err) {
		if (err instanceof LlmCancelledError) throw err;
		if (options.cancelSignal?.aborted) {
			throw new LlmCancelledError(full, { cause: err });
		}
		throw err;
	}

	throwIfUserCancelled(options, full);
	return full;
}
