import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ChatMessage } from "../schemas/chat";
import { clearStubEnv, stubRequiredEnv } from "../test/helpers";
import {
	DEFAULT_CONTEXT_TOKEN_LIMIT,
	estimateHistoryTokens,
	estimateTextTokens,
	getContextTokenLimit,
	summarizeContextUsage,
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
