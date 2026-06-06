import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ChatMessage } from "../schemas/chat";
import { clearStubEnv, stubRequiredEnv } from "../test/helpers";
import {
	applySummaryToHistory,
	applySummaryToSystemContent,
	buildSummarizationMessages,
	compactHistoryIfNeeded,
	formatCompactNotice,
	formatStoredSummaryDisplay,
	getStoredSummary,
	parseSystemWithSummary,
	SUMMARY_SECTION_END,
	SUMMARY_SECTION_START,
	splitHistoryForCompression,
} from "./summary";

describe("summary compression", () => {
	beforeEach(() => {
		stubRequiredEnv();
		delete process.env.CONTEXT_SUMMARIZE;
		delete process.env.CONTEXT_KEEP_RECENT_TURNS;
		delete process.env.CONTEXT_TOKEN_LIMIT;
	});

	afterEach(() => {
		clearStubEnv();
		delete process.env.CONTEXT_SUMMARIZE;
		delete process.env.CONTEXT_KEEP_RECENT_TURNS;
		delete process.env.CONTEXT_TOKEN_LIMIT;
	});

	test("parseSystemWithSummary extracts embedded summary", () => {
		const content = applySummaryToSystemContent("base prompt", "用户问了 TS");
		const parsed = parseSystemWithSummary(content);

		expect(parsed.base).toBe("base prompt");
		expect(parsed.summary).toBe("用户问了 TS");
		expect(content).toContain(SUMMARY_SECTION_START);
		expect(content).toContain(SUMMARY_SECTION_END);
	});

	test("splitHistoryForCompression keeps recent turns", () => {
		const history: ChatMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "1" },
			{ role: "assistant", content: "2" },
			{ role: "user", content: "3" },
			{ role: "assistant", content: "4" },
			{ role: "user", content: "5" },
		];

		const split = splitHistoryForCompression(history, 2);
		expect(split.toCompress.map((m) => m.content)).toEqual(["1", "2"]);
		expect(split.toKeep.map((m) => m.content)).toEqual(["3", "4", "5"]);
	});

	test("applySummaryToHistory writes summary and removes old turns", () => {
		const history: ChatMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "old" },
			{ role: "assistant", content: "reply" },
			{ role: "user", content: "new" },
		];

		applySummaryToHistory(history, "旧对话摘要", [
			{ role: "user", content: "new" },
		]);

		expect(getStoredSummary(history)).toBe("旧对话摘要");
		expect(history.map((m) => m.content)).toEqual([
			applySummaryToSystemContent("sys", "旧对话摘要"),
			"new",
		]);
	});

	test("buildSummarizationMessages merges prior summary", () => {
		const messages = buildSummarizationMessages(
			[{ role: "user", content: "hello" }],
			"已有内容",
		);

		expect(messages[0]?.role).toBe("system");
		expect(messages[1]?.content).toContain("已有摘要");
		expect(messages[1]?.content).toContain("hello");
	});

	test("compactHistoryIfNeeded summarizes before trim", async () => {
		const budget = 100;

		const history: ChatMessage[] = [
			{ role: "system", content: "s" },
			{ role: "user", content: "a".repeat(80) },
			{ role: "assistant", content: "b".repeat(80) },
			{ role: "user", content: "c".repeat(80) },
			{ role: "assistant", content: "d".repeat(80) },
			{ role: "user", content: "latest" },
		];

		const result = await compactHistoryIfNeeded(history, {
			budget,
			summarize: async () => "压缩摘要",
		});

		expect(result.summarized).toBe(true);
		expect(result.compressedMessageCount).toBe(2);
		expect(getStoredSummary(history)).toBe("压缩摘要");
		expect(history.some((m) => m.content === "latest")).toBe(true);
		expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
		expect(result.tokensAfter).toBeLessThanOrEqual(budget);
	});

	test("compactHistoryIfNeeded falls back to trim when summarize disabled", async () => {
		process.env.CONTEXT_SUMMARIZE = "false";
		process.env.CONTEXT_TOKEN_LIMIT = "80";

		const history: ChatMessage[] = [
			{ role: "system", content: "s" },
			{ role: "user", content: "a".repeat(100) },
			{ role: "assistant", content: "b".repeat(100) },
			{ role: "user", content: "keep" },
		];

		const result = await compactHistoryIfNeeded(history);
		expect(result.summarized).toBe(false);
		expect(result.trimmed?.trimmedCount).toBeGreaterThan(0);
		expect(history.at(-1)?.content).toBe("keep");
	});

	test("formatStoredSummaryDisplay shows full summary or empty hint", () => {
		expect(formatStoredSummaryDisplay(null)).toContain("暂无对话摘要");
		expect(formatStoredSummaryDisplay("完整摘要内容")).toContain(
			"完整摘要内容",
		);
		expect(formatStoredSummaryDisplay("完整摘要内容")).toContain(
			"--- 对话摘要 ---",
		);
	});

	test("formatCompactNotice describes compression", () => {
		const line = formatCompactNotice({
			summarized: true,
			compressedMessageCount: 4,
			trimmed: null,
			tokensBefore: 9000,
			tokensAfter: 3000,
		});

		expect(line).toContain("已摘要压缩 4 条");
	});
});
