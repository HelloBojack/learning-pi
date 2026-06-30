import {
	StreamChunkSchema,
	type TokenUsage,
	type ToolCall,
	tokenUsageFromApi,
} from "../schemas/chat";

export type SseToolsStreamResult = {
	content: string;
	toolCalls: ToolCall[];
	finishReason: string | null;
	usage: TokenUsage | null;
};

type ToolCallAccumulator = {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
};

/**
 * 解析 OpenAI 兼容 SSE，同时收集 content 增量与 tool_calls 片段。
 * yield 文本增量；return 完整 content + 合并后的 tool_calls。
 */
export async function* readOpenAiSseToolsStream(
	body: ReadableStream<Uint8Array>,
	options: { signal?: AbortSignal } = {},
): AsyncGenerator<string, SseToolsStreamResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let content = "";
	let finishReason: string | null = null;
	let usage: TokenUsage | null = null;
	const toolCallsByIndex = new Map<number, ToolCallAccumulator>();

	try {
		while (true) {
			if (options.signal?.aborted) {
				await reader.cancel(options.signal.reason);
				throw (
					options.signal.reason ?? new DOMException("Aborted", "AbortError")
				);
			}

			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				const piece = parseSseToolsDataLine(
					line,
					toolCallsByIndex,
					(reason) => {
						finishReason = reason;
					},
					(nextUsage) => {
						usage = nextUsage;
					},
				);
				if (piece) {
					content += piece;
					yield piece;
					if (options.signal?.aborted) {
						await reader.cancel(options.signal.reason);
						throw (
							options.signal.reason ?? new DOMException("Aborted", "AbortError")
						);
					}
				}
				newlineIndex = buffer.indexOf("\n");
			}
		}

		const tail = buffer.trim();
		if (tail) {
			const piece = parseSseToolsDataLine(
				tail,
				toolCallsByIndex,
				(reason) => {
					finishReason = reason;
				},
				(nextUsage) => {
					usage = nextUsage;
				},
			);
			if (piece) {
				content += piece;
				yield piece;
			}
		}
	} finally {
		reader.releaseLock();
	}

	return {
		content,
		toolCalls: finalizeToolCalls(toolCallsByIndex),
		finishReason,
		usage,
	};
}

function parseSseToolsDataLine(
	line: string,
	toolCallsByIndex: Map<number, ToolCallAccumulator>,
	onFinishReason: (reason: string | null) => void,
	onUsage: (usage: TokenUsage | null) => void,
): string | null {
	if (!line.startsWith("data:")) return null;

	const data = line.slice(5).trim();
	if (!data || data === "[DONE]") return null;

	let json: unknown;
	try {
		json = JSON.parse(data);
	} catch {
		return null;
	}

	const parsed = StreamChunkSchema.safeParse(json);
	if (!parsed.success) return null;

	if (parsed.data.error) {
		throw new Error(parsed.data.error.message);
	}

	const parsedUsage = tokenUsageFromApi(parsed.data.usage);
	if (parsedUsage) {
		onUsage(parsedUsage);
	}

	const choice = parsed.data.choices?.[0];
	if (choice?.finish_reason !== undefined) {
		onFinishReason(choice.finish_reason);
	}

	const delta = choice?.delta;
	if (delta?.tool_calls) {
		mergeToolCallDeltas(toolCallsByIndex, delta.tool_calls);
	}

	const content = delta?.content;
	return typeof content === "string" && content.length > 0 ? content : null;
}

function mergeToolCallDeltas(
	acc: Map<number, ToolCallAccumulator>,
	deltas: Array<{
		index?: number;
		id?: string;
		type?: "function";
		function?: { name?: string; arguments?: string };
	}>,
): void {
	for (const part of deltas) {
		const index = part.index ?? 0;
		let entry = acc.get(index);
		if (!entry) {
			entry = {
				id: "",
				type: "function",
				function: { name: "", arguments: "" },
			};
			acc.set(index, entry);
		}
		if (part.id) entry.id = part.id;
		if (part.function?.name) entry.function.name += part.function.name;
		if (part.function?.arguments)
			entry.function.arguments += part.function.arguments;
	}
}

function finalizeToolCalls(acc: Map<number, ToolCallAccumulator>): ToolCall[] {
	return [...acc.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, value]) => ({
			id: value.id,
			type: "function" as const,
			function: value.function,
		}))
		.filter((call) => call.id && call.function.name);
}
