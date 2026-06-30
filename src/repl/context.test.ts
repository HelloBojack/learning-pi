import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ChatMessage } from "../schemas/chat";
import { clearStubEnv, stubRequiredEnv } from "../test/helpers";
import {
	DEFAULT_CONTEXT_TOKEN_LIMIT,
	estimateHistoryTokens,
	estimateTextTokens,
	getContextTokenLimit,
	getTrimTokenBudget,
	summarizeContextUsage,
	trimHistoryToTokenLimit,
} from "./context";

describe("context token estimate", () => {
	beforeEach(() => {
		stubRequiredEnv();
		delete process.env.CONTEXT_TOKEN_LIMIT;
	});

	afterEach(() => {
		clearStubEnv();
		delete process.env.CONTEXT_TOKEN_LIMIT;
	});

	test("estimateTextTokens treats CJK roughly 1 char per token", () => {
		expect(estimateTextTokens("你好")).toBe(2);
	});

	test("estimateTextTokens treats Latin roughly 4 chars per token", () => {
		expect(estimateTextTokens("hello")).toBe(2);
		expect(estimateTextTokens("abcd")).toBe(1);
	});

	test("estimateHistoryTokens includes per-message overhead", () => {
		const messages: ChatMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "hi" },
		];

		expect(estimateHistoryTokens(messages)).toBe(
			estimateTextTokens("sys") + 4 + estimateTextTokens("hi") + 4,
		);
	});

	test("summarizeContextUsage computes remaining tokens", () => {
		process.env.CONTEXT_TOKEN_LIMIT = "100";

		const usage = summarizeContextUsage([
			{ role: "system", content: "x".repeat(40) },
			{ role: "user", content: "y".repeat(20) },
		]);

		expect(usage.limit).toBe(100);
		expect(usage.chars).toBe(60);
		expect(usage.turnCount).toBe(1);
		expect(usage.remaining).toBe(Math.max(0, 100 - usage.tokens));
	});

	test("getContextTokenLimit falls back when env invalid", () => {
		process.env.CONTEXT_TOKEN_LIMIT = "nope";
		expect(getContextTokenLimit()).toBe(DEFAULT_CONTEXT_TOKEN_LIMIT);
	});

	test("getContextTokenLimit reads positive integer from env", () => {
		process.env.CONTEXT_TOKEN_LIMIT = "32000";
		expect(getContextTokenLimit()).toBe(32000);
	});
});

describe("trimHistoryToTokenLimit", () => {
	beforeEach(() => {
		stubRequiredEnv();
		delete process.env.CONTEXT_TOKEN_LIMIT;
	});

	afterEach(() => {
		clearStubEnv();
		delete process.env.CONTEXT_TOKEN_LIMIT;
	});

	test("does nothing when under budget", () => {
		const history: ChatMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "hi" },
		];

		const result = trimHistoryToTokenLimit(history, 10_000);
		expect(result.trimmedCount).toBe(0);
		expect(history).toHaveLength(2);
	});

	test("removes oldest user/assistant pair and keeps system", () => {
		const history: ChatMessage[] = [
			{ role: "system", content: "s" },
			{ role: "user", content: "a".repeat(200) },
			{ role: "assistant", content: "b".repeat(200) },
			{ role: "user", content: "latest" },
		];

		const result = trimHistoryToTokenLimit(history, 80);
		expect(result.trimmedCount).toBe(2);
		expect(history.map((m) => m.role)).toEqual(["system", "user"]);
		expect(history[1]?.content).toBe("latest");
		expect(estimateHistoryTokens(history)).toBeLessThanOrEqual(80);
	});

	test("keeps at least the latest user message even when over budget", () => {
		const history: ChatMessage[] = [
			{ role: "system", content: "s" },
			{ role: "user", content: "x".repeat(500) },
		];

		const result = trimHistoryToTokenLimit(history, 50);
		expect(result.trimmedCount).toBe(0);
		expect(history).toHaveLength(2);
		expect(estimateHistoryTokens(history)).toBeGreaterThan(50);
	});

	test("getTrimTokenBudget reserves space for generation", () => {
		process.env.CONTEXT_TOKEN_LIMIT = "5000";
		expect(getTrimTokenBudget()).toBe(5000 - 1024);
	});

	test("removes oldest user turn atomically including agent tool messages", () => {
		const history: ChatMessage[] = [
			{ role: "system", content: "s" },
			{ role: "user", content: "a".repeat(120) },
			{
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
			{
				role: "tool",
				content: '{"iso":"2026-01-01T00:00:00+08:00"}',
				tool_call_id: "call_1",
			},
			{ role: "assistant", content: "b".repeat(120) },
			{ role: "user", content: "latest" },
		];

		const result = trimHistoryToTokenLimit(history, 80);
		expect(result.trimmedCount).toBe(4);
		expect(history.map((m) => m.role)).toEqual(["system", "user"]);
		expect(history[1]?.content).toBe("latest");
		expect(estimateHistoryTokens(history)).toBeLessThanOrEqual(80);
	});
});
