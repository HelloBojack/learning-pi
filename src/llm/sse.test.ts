import { describe, expect, test } from "bun:test";
import { readOpenAiSseStream } from "./sse";

function encodeSse(lines: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(`${lines.join("\n")}\n`));
			controller.close();
		},
	});
}

function splitSseBody(lines: string[]): ReadableStream<Uint8Array> {
	const text = `${lines.join("\n")}\n`;
	const encoder = new TextEncoder();
	const chunkA = text.slice(0, 20);
	const chunkB = text.slice(20);
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(chunkA));
			controller.enqueue(encoder.encode(chunkB));
			controller.close();
		},
	});
}

async function collectStream(
	body: ReadableStream<Uint8Array>,
): Promise<string[]> {
	const chunks: string[] = [];
	for await (const piece of readOpenAiSseStream(body)) {
		chunks.push(piece);
	}
	return chunks;
}

describe("readOpenAiSseStream", () => {
	test("yields delta content from data lines", async () => {
		const body = encodeSse([
			'data: {"choices":[{"delta":{"content":"你"}}]}',
			'data: {"choices":[{"delta":{"content":"好"}}]}',
			"data: [DONE]",
		]);

		expect(await collectStream(body)).toEqual(["你", "好"]);
	});

	test("ignores non-data lines and empty chunks", async () => {
		const body = encodeSse([
			": keep-alive",
			'data: {"choices":[{"delta":{"content":"ok"}}]}',
			"data:",
		]);

		expect(await collectStream(body)).toEqual(["ok"]);
	});

	test("parses when chunks split mid-line", async () => {
		const body = splitSseBody([
			'data: {"choices":[{"delta":{"content":"split"}}]}',
			"data: [DONE]",
		]);

		expect(await collectStream(body)).toEqual(["split"]);
	});

	test("throws when stream payload includes error", async () => {
		const body = encodeSse(['data: {"error":{"message":"rate limited"}}']);

		await expect(collectStream(body)).rejects.toThrow("rate limited");
	});

	test("stops when signal aborts mid-read", async () => {
		const controller = new AbortController();
		const body = encodeSse([
			'data: {"choices":[{"delta":{"content":"a"}}]}',
			'data: {"choices":[{"delta":{"content":"b"}}]}',
		]);

		const chunks: string[] = [];
		const task = (async () => {
			for await (const piece of readOpenAiSseStream(body, {
				signal: controller.signal,
			})) {
				chunks.push(piece);
				if (chunks.length === 1) controller.abort();
			}
		})();

		await expect(task).rejects.toMatchObject({ name: "AbortError" });
		expect(chunks).toEqual(["a"]);
	});
});
