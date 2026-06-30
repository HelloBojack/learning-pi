import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ToolDefinition } from "../schemas/chat";
import { clearStubEnv, stubRequiredEnv } from "../test/helpers";
import { type ChatWithToolsOptions, chatWithTools, LlmApiError } from "./chat";

const originalFetch = globalThis.fetch;

function mockFetch(
	impl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): void {
	globalThis.fetch = impl as typeof fetch;
}

const instantRetry: ChatWithToolsOptions = {
	retryBackoff: async () => {},
};

const DEMO_TOOL: ToolDefinition = {
	type: "function",
	function: {
		name: "get_current_time",
		description: "Get current time",
		parameters: { type: "object", properties: {} },
	},
};

function captureRequestBody(responseJson: unknown) {
	let capturedBody: unknown;
	mockFetch(async (_url, init) => {
		capturedBody = JSON.parse(String(init?.body));
		return new Response(JSON.stringify(responseJson), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	});
	return () => capturedBody;
}

describe("chatWithTools", () => {
	beforeEach(() => {
		stubRequiredEnv();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		clearStubEnv();
	});

	test("returns final text when model responds without tool_calls", async () => {
		mockFetch(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: { role: "assistant", content: "hello" },
								finish_reason: "stop",
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		);

		const result = await chatWithTools(
			[{ role: "user", content: "hi" }],
			instantRetry,
		);

		expect(result.content).toBe("hello");
		expect(result.toolCalls).toHaveLength(0);
		expect(result.finishReason).toBe("stop");
		expect(result.message.content).toBe("hello");
	});

	test("parses tool_calls response", async () => {
		mockFetch(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									role: "assistant",
									content: null,
									tool_calls: [
										{
											id: "call_1",
											type: "function",
											function: {
												name: "get_current_time",
												arguments: "{}",
											},
										},
									],
								},
								finish_reason: "tool_calls",
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		);

		const result = await chatWithTools(
			[{ role: "user", content: "现在几点？" }],
			{ ...instantRetry, tools: [DEMO_TOOL] },
		);

		expect(result.content).toBe("");
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0]?.function.name).toBe("get_current_time");
		expect(result.finishReason).toBe("tool_calls");
		expect(result.message.tool_calls).toHaveLength(1);
	});

	test("includes tools in request payload", async () => {
		const getBody = captureRequestBody({
			choices: [
				{
					message: { role: "assistant", content: "ok" },
					finish_reason: "stop",
				},
			],
		});

		await chatWithTools([{ role: "user", content: "hi" }], {
			...instantRetry,
			tools: [DEMO_TOOL],
		});

		const body = getBody() as { tools?: ToolDefinition[] };
		expect(body.tools).toHaveLength(1);
		expect(body.tools?.[0]?.function.name).toBe("get_current_time");
	});

	test("throws when response has neither content nor tool_calls", async () => {
		mockFetch(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: { role: "assistant", content: null },
								finish_reason: "stop",
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		);

		await expect(
			chatWithTools([{ role: "user", content: "hi" }], instantRetry),
		).rejects.toBeInstanceOf(LlmApiError);
	});
});
