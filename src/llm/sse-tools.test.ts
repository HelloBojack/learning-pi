import { describe, expect, test } from "bun:test";
import { readOpenAiSseToolsStream } from "./sse-tools";

function encodeSse(lines: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(`${lines.join("\n")}\n`));
			controller.close();
		},
	});
}

async function collectToolsStream(body: ReadableStream<Uint8Array>) {
	const chunks: string[] = [];
	const gen = readOpenAiSseToolsStream(body);
	let result = await gen.next();
	while (!result.done) {
		chunks.push(result.value);
		result = await gen.next();
	}
	return { chunks, result: result.value };
}

describe("readOpenAiSseToolsStream", () => {
	test("yields content and returns empty tool_calls", async () => {
		const body = encodeSse([
			'data: {"choices":[{"delta":{"content":"你"}}]}',
			'data: {"choices":[{"delta":{"content":"好"}}]}',
			'data: {"choices":[{"finish_reason":"stop"}]}',
			"data: [DONE]",
		]);

		const { chunks, result } = await collectToolsStream(body);
		expect(chunks).toEqual(["你", "好"]);
		expect(result.content).toBe("你好");
		expect(result.toolCalls).toEqual([]);
		expect(result.finishReason).toBe("stop");
	});

	test("merges streamed tool_calls by index", async () => {
		const body = encodeSse([
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_current_time","arguments":""}}]}}]}',
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}',
			'data: {"choices":[{"finish_reason":"tool_calls"}]}',
			"data: [DONE]",
		]);

		const { chunks, result } = await collectToolsStream(body);
		expect(chunks).toEqual([]);
		expect(result.toolCalls).toEqual([
			{
				id: "call_1",
				type: "function",
				function: { name: "get_current_time", arguments: "{}" },
			},
		]);
		expect(result.finishReason).toBe("tool_calls");
	});

	test("captures usage from final SSE chunk", async () => {
		const body = encodeSse([
			'data: {"choices":[{"delta":{"content":"hi"}}]}',
			'data: {"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
			"data: [DONE]",
		]);

		const { result } = await collectToolsStream(body);
		expect(result.usage).toEqual({
			promptTokens: 5,
			completionTokens: 2,
			totalTokens: 7,
		});
	});
});
