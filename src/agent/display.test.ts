import { describe, expect, test } from "bun:test";
import { ZERO_TOKEN_USAGE } from "../schemas/chat";
import { formatTokenUsageLine, formatToolStepLog } from "./display";

describe("agent display", () => {
	test("formatToolStepLog renders tool name, args, and result preview", () => {
		const line = formatToolStepLog({
			kind: "tool_call",
			name: "get_current_time",
			args: {},
			result: '{"iso":"2026-06-05T12:00:00.000Z"}',
		});

		expect(line).toContain("[tool] get_current_time({})");
		expect(line).toContain("[tool result]");
		expect(line).toContain("2026-06-05");
	});

	test("formatTokenUsageLine estimates cost", () => {
		const line = formatTokenUsageLine({
			promptTokens: 1_000_000,
			completionTokens: 1_000_000,
			totalTokens: 2_000_000,
		});
		expect(line).toContain("1000000 in / 1000000 out");
		expect(line).toContain("$18.0000");
		expect(line.startsWith("[tokens]")).toBe(true);
		expect(formatTokenUsageLine(ZERO_TOKEN_USAGE, "session")).toContain(
			"[session]",
		);
	});
});
