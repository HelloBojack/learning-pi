import { describe, expect, test } from "bun:test";
import { buildCodingToolHint, withCodingToolHints } from "./tool-hints";

describe("coding tool hints", () => {
	test("buildCodingToolHint lists registered coding tools", () => {
		const hint = buildCodingToolHint([
			"calculate",
			"read_file",
			"run_terminal_cmd",
		]);
		expect(hint).toContain("read_file");
		expect(hint).toContain("run_terminal_cmd");
		expect(hint).not.toContain("calculate");
	});

	test("withCodingToolHints appends to system message without mutating input", () => {
		const history = [
			{ role: "system" as const, content: "你是助手" },
			{ role: "user" as const, content: "echo hi" },
		];
		const tools = [
			{
				type: "function" as const,
				function: {
					name: "run_terminal_cmd",
					description: "shell",
					parameters: { type: "object", properties: {} },
				},
			},
		];
		const augmented = withCodingToolHints(history, tools);
		expect(augmented[0]?.content).toContain("run_terminal_cmd");
		expect(history[0]?.content).toBe("你是助手");
	});
});
