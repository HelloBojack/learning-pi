import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatWithToolsResult } from "../llm/chat";
import { LlmCancelledError } from "../llm/chat";
import type { ChatMessage } from "../schemas/chat";
import { ZERO_TOKEN_USAGE } from "../schemas/chat";
import { createLocalToolRegistry } from "../tools/local";
import { Agent } from "./agent";

describe("Agent", () => {
	const baseHistory: ChatMessage[] = [{ role: "system", content: "你是助手" }];

	test("chat pushes user message and appends assistant reply", async () => {
		const history = [...baseHistory];
		const agent = new Agent({
			history,
			toolRegistry: createLocalToolRegistry(),
			skipCompact: true,
			chatWithTools: async () => ({
				content: "你好",
				toolCalls: [],
				finishReason: "stop",
				message: { role: "assistant", content: "你好" },
				usage: ZERO_TOKEN_USAGE,
			}),
		});

		const result = await agent.chat("hi");

		expect(result.finalText).toBe("你好");
		expect(history.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
	});

	test("abort() cancels in-flight chat via loop", async () => {
		const history = [...baseHistory];
		const agent = new Agent({
			history,
			toolRegistry: createLocalToolRegistry(),
			skipCompact: true,
			chatWithTools: async (): Promise<ChatWithToolsResult> => ({
				content: "",
				toolCalls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "get_current_time", arguments: "{}" },
					},
					{
						id: "call_2",
						type: "function",
						function: { name: "calculate", arguments: '{"expression":"1+1"}' },
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
						{
							id: "call_2",
							type: "function",
							function: {
								name: "calculate",
								arguments: '{"expression":"1+1"}',
							},
						},
					],
				},
				usage: ZERO_TOKEN_USAGE,
			}),
			onToolStep: () => {
				agent.abort();
			},
		});

		const result = await agent.chat("time and math");

		expect(result.cancelled).toBe(true);
		expect(history.map((m) => m.role)).toEqual([
			"system",
			"user",
			"assistant",
			"tool",
		]);
	});

	test("autoSave runs after chat completes", async () => {
		const history = [...baseHistory];
		let saved = 0;

		const agent = new Agent({
			history,
			toolRegistry: createLocalToolRegistry(),
			skipCompact: true,
			autoSave: async () => {
				saved += 1;
			},
			chatWithTools: async () => ({
				content: "ok",
				toolCalls: [],
				finishReason: "stop",
				message: { role: "assistant", content: "ok" },
				usage: ZERO_TOKEN_USAGE,
			}),
		});

		await agent.chat("go");
		expect(saved).toBe(1);
	});

	test("removes user message when chat fails", async () => {
		const history = [...baseHistory];
		const agent = new Agent({
			history,
			toolRegistry: createLocalToolRegistry(),
			skipCompact: true,
			chatWithTools: async () => {
				throw new Error("boom");
			},
		});

		await expect(agent.chat("fail")).rejects.toThrow("boom");
		expect(history).toEqual(baseHistory);
	});

	test("keeps partial assistant on LlmCancelledError", async () => {
		const history = [...baseHistory];
		const agent = new Agent({
			history,
			toolRegistry: createLocalToolRegistry(),
			skipCompact: true,
			stream: true,
			chatStreamWithTools: async function* () {
				yield "part";
				throw new LlmCancelledError("part");
			},
		});

		await expect(agent.chat("stream")).rejects.toBeInstanceOf(
			LlmCancelledError,
		);
		expect(history.at(-1)).toEqual({ role: "assistant", content: "part" });
	});

	test("accumulates session token usage across chats", async () => {
		const history = [...baseHistory];
		let call = 0;
		const agent = new Agent({
			history,
			toolRegistry: createLocalToolRegistry(),
			skipCompact: true,
			printDivider: false,
			chatWithTools: async () => {
				call += 1;
				return {
					content: "ok",
					toolCalls: [],
					finishReason: "stop",
					message: { role: "assistant", content: "ok" },
					usage: {
						promptTokens: call * 10,
						completionTokens: call * 5,
						totalTokens: call * 15,
					},
				};
			},
		});

		await agent.chat("a");
		await agent.chat("b");

		expect(agent.totalInputTokens).toBe(30);
		expect(agent.totalOutputTokens).toBe(15);
		expect(agent.sessionUsage.totalTokens).toBe(45);
	});

	test("reuses confirmedPaths so ask is only once per prompt", async () => {
		const history = [...baseHistory];
		let asks = 0;
		const workspace = await mkdtemp(join(tmpdir(), "learning-pi-agent-"));
		const previousRoot = process.env.WORKSPACE_ROOT;
		process.env.WORKSPACE_ROOT = workspace;

		try {
			let call = 0;
			const agent = new Agent({
				history,
				toolRegistry: createLocalToolRegistry(),
				skipCompact: true,
				printDivider: false,
				toolContext: {
					permissionMode: "default",
					confirm: async () => {
						asks += 1;
						return true;
					},
				},
				chatWithTools: async (): Promise<ChatWithToolsResult> => {
					call += 1;
					if (call > 1) {
						return {
							content: "ok",
							toolCalls: [],
							finishReason: "stop",
							message: { role: "assistant", content: "ok" },
							usage: ZERO_TOKEN_USAGE,
						};
					}
					return {
						content: "",
						toolCalls: [
							{
								id: "call_1",
								type: "function",
								function: {
									name: "write_file",
									arguments: '{"path":"same.txt","content":"first"}',
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
										name: "write_file",
										arguments: '{"path":"same.txt","content":"first"}',
									},
								},
							],
						},
						usage: ZERO_TOKEN_USAGE,
					};
				},
			});

			await agent.chat("write once");
			await agent.chat("write again");

			expect(asks).toBe(1);
		} finally {
			if (previousRoot === undefined) {
				delete process.env.WORKSPACE_ROOT;
			} else {
				process.env.WORKSPACE_ROOT = previousRoot;
			}
			await rm(workspace, { recursive: true, force: true });
		}
	});
});
