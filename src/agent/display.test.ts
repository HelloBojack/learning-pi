import { describe, expect, test } from "bun:test";
import { formatToolStepLog } from "./display";

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
});
