import { describe, expect, test } from "bun:test";
import type { ChatWithToolsResult } from "../llm/chat";
import type { ChatMessage } from "../schemas/chat";
import { AgentLoopError, runAgentLoop } from "./loop";
import {
	CALCULATE_TOOL,
	evaluateMathExpression,
	executeTool,
	GET_CONTEXT_USAGE_TOOL,
	GET_CURRENT_TIME_TOOL,
} from "./tools";

describe("agent tools", () => {
	test("get_current_time returns local ISO timestamp JSON", async () => {
		const result = await executeTool(GET_CURRENT_TIME_TOOL.function.name, "{}");
		const parsed = JSON.parse(result) as { iso?: string; timezone?: string };
		expect(parsed.iso).toBeDefined();
		expect(parsed.iso).toMatch(/[+-]\d{2}:\d{2}$/);
		expect(Number.isNaN(Date.parse(parsed.iso ?? ""))).toBe(false);
		expect(parsed.timezone).toBeTruthy();
	});

	test("calculate evaluates simple expressions", async () => {
		const result = await executeTool(
			CALCULATE_TOOL.function.name,
			'{"expression":"(2+3)*4"}',
		);
		expect(JSON.parse(result)).toEqual({ expression: "(2+3)*4", result: 20 });
	});

	test("calculate rejects unsafe expressions", async () => {
		const result = await executeTool(
			CALCULATE_TOOL.function.name,
			'{"expression":"process.exit()"}',
		);
		expect(JSON.parse(result).error).toContain("invalid characters");
	});

	test("evaluateMathExpression supports modulo", () => {
		expect(evaluateMathExpression("10 % 3")).toBe(1);
	});

	test("get_context_usage returns token stats from history", async () => {
		const history: ChatMessage[] = [
			{ role: "system", content: "你是助手" },
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		];
		const result = await executeTool(
			GET_CONTEXT_USAGE_TOOL.function.name,
			"{}",
			{ history },
		);
		const parsed = JSON.parse(result) as {
			tokens?: number;
			limit?: number;
			messageCount?: number;
		};
		expect(parsed.tokens).toBeGreaterThan(0);
		expect(parsed.limit).toBeGreaterThan(0);
		expect(parsed.messageCount).toBe(3);
	});

	test("get_context_usage errors without history", async () => {
		const result = await executeTool(
			GET_CONTEXT_USAGE_TOOL.function.name,
			"{}",
		);
		expect(JSON.parse(result)).toEqual({
			error: "conversation history unavailable",
		});
	});

	test("executeTool returns error for unknown tool", async () => {
		const result = await executeTool("not_a_tool", "{}");
		expect(JSON.parse(result)).toEqual({ error: "unknown tool: not_a_tool" });
	});

	test("executeTool returns error for invalid JSON args", async () => {
		const result = await executeTool(
			GET_CURRENT_TIME_TOOL.function.name,
			"{bad",
		);
		expect(JSON.parse(result).error).toContain("invalid tool arguments");
	});
});

describe("runAgentLoop", () => {
	const baseHistory: ChatMessage[] = [
		{ role: "system", content: "你是助手" },
		{ role: "user", content: "现在几点？" },
	];

	test("returns final text when model responds without tool_calls", async () => {
		const result = await runAgentLoop(baseHistory, {
			chatWithTools: async () => ({
				content: "现在是下午 3 点",
				toolCalls: [],
				finishReason: "stop",
				message: { role: "assistant", content: "现在是下午 3 点" },
			}),
		});

		expect(result.finalText).toBe("现在是下午 3 点");
		expect(result.streamed).toBe(false);
		expect(result.steps).toHaveLength(0);
		expect(result.messagesAppended).toHaveLength(1);
		expect(result.messagesAppended[0]?.role).toBe("assistant");
	});

	test("streams final text chunks when stream option is enabled", async () => {
		const seen: string[] = [];

		const result = await runAgentLoop(baseHistory, {
			stream: true,
			onStreamChunk: (chunk) => {
				seen.push(chunk);
			},
			chatStreamWithTools: async function* () {
				yield "现";
				yield "在";
				return {
					content: "现在",
					toolCalls: [],
					finishReason: "stop",
					message: { role: "assistant", content: "现在" },
				};
			},
		});

		expect(seen).toEqual(["现", "在"]);
		expect(result.finalText).toBe("现在");
		expect(result.streamed).toBe(true);
	});

	test("executes tool then returns final answer", async () => {
		let call = 0;
		const result = await runAgentLoop(baseHistory, {
			chatWithTools: async (): Promise<ChatWithToolsResult> => {
				call += 1;
				if (call === 1) {
					return {
						content: "",
						toolCalls: [
							{
								id: "call_1",
								type: "function",
								function: {
									name: "get_current_time",
									arguments: "{}",
								},
							},
						],
						finishReason: "tool_calls",
						message: {
							role: "assistant",
							content: "",
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
					};
				}

				return {
					content: "当前时间是 2026-06-05T12:00:00.000Z",
					toolCalls: [],
					finishReason: "stop",
					message: {
						role: "assistant",
						content: "当前时间是 2026-06-05T12:00:00.000Z",
					},
				};
			},
		});

		expect(result.stepsTaken).toBe(2);
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]?.name).toBe("get_current_time");
		expect(result.finalText).toContain("2026-06-05");
		expect(result.messagesAppended.map((m) => m.role)).toEqual([
			"assistant",
			"tool",
			"assistant",
		]);
		expect(result.messagesAppended[1]?.tool_call_id).toBe("call_1");
	});

	test("does not mutate input history", async () => {
		const history: ChatMessage[] = [...baseHistory];
		await runAgentLoop(history, {
			chatWithTools: async () => ({
				content: "ok",
				toolCalls: [],
				finishReason: "stop",
				message: { role: "assistant", content: "ok" },
			}),
		});

		expect(history).toHaveLength(2);
	});

	test("throws AgentLoopError when max steps exceeded", async () => {
		await expect(
			runAgentLoop(baseHistory, {
				maxSteps: 2,
				chatWithTools: async () => ({
					content: "",
					toolCalls: [
						{
							id: "call_loop",
							type: "function",
							function: { name: "get_current_time", arguments: "{}" },
						},
					],
					finishReason: "tool_calls",
					message: {
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call_loop",
								type: "function",
								function: { name: "get_current_time", arguments: "{}" },
							},
						],
					},
				}),
			}),
		).rejects.toBeInstanceOf(AgentLoopError);
	});

	test("includes partial messages in AgentLoopError when max steps exceeded", async () => {
		const alwaysToolCalls = async (): Promise<ChatWithToolsResult> => ({
			content: "",
			toolCalls: [
				{
					id: "call_partial",
					type: "function",
					function: { name: "get_current_time", arguments: "{}" },
				},
			],
			finishReason: "tool_calls",
			message: {
				role: "assistant",
				content: "",
				tool_calls: [
					{
						id: "call_partial",
						type: "function",
						function: { name: "get_current_time", arguments: "{}" },
					},
				],
			},
		});

		try {
			await runAgentLoop(baseHistory, {
				maxSteps: 1,
				chatWithTools: alwaysToolCalls,
			});
			throw new Error("expected AgentLoopError");
		} catch (err) {
			expect(err).toBeInstanceOf(AgentLoopError);
			const agentErr = err as AgentLoopError;
			expect(agentErr.partial?.messagesAppended.map((m) => m.role)).toEqual([
				"assistant",
				"tool",
			]);
			expect(agentErr.partial?.steps).toHaveLength(1);
		}
	});

	test("onToolStep fires for each tool execution", async () => {
		const seen: string[] = [];
		let call = 0;

		await runAgentLoop(baseHistory, {
			chatWithTools: async (): Promise<ChatWithToolsResult> => {
				call += 1;
				if (call === 1) {
					return {
						content: "",
						toolCalls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "get_current_time", arguments: "{}" },
							},
						],
						finishReason: "tool_calls",
						message: {
							role: "assistant",
							content: "",
							tool_calls: [
								{
									id: "call_1",
									type: "function",
									function: { name: "get_current_time", arguments: "{}" },
								},
							],
						},
					};
				}

				return {
					content: "done",
					toolCalls: [],
					finishReason: "stop",
					message: { role: "assistant", content: "done" },
				};
			},
			onToolStep: (step) => {
				seen.push(step.name);
			},
		});

		expect(seen).toEqual(["get_current_time"]);
	});
});
