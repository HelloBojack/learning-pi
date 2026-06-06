import { StreamChunkSchema } from "../schemas/chat";

/**
 * 解析 OpenAI 兼容的 SSE 流（data: {...} / data: [DONE]）。
 */
export async function* readOpenAiSseStream(
	body: ReadableStream<Uint8Array>,
	options: { signal?: AbortSignal } = {},
): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

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
				const piece = parseSseDataLine(line);
				if (piece) {
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
			const piece = parseSseDataLine(tail);
			if (piece) yield piece;
		}
	} finally {
		reader.releaseLock();
	}
}

function parseSseDataLine(line: string): string | null {
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

	const content = parsed.data.choices?.[0]?.delta?.content;
	return typeof content === "string" && content.length > 0 ? content : null;
}
