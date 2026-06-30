import { describe, expect, test } from "bun:test";
import { evaluatePermission } from "./policy";

describe("evaluatePermission", () => {
	test("allows read-only tools in all modes", () => {
		expect(evaluatePermission("read_file", { path: "a.ts" }, "default")).toBe(
			"allow",
		);
		expect(evaluatePermission("grep", { pattern: "foo" }, "dont-ask")).toBe(
			"allow",
		);
		expect(evaluatePermission("list_dir", { path: "." }, "dont-ask")).toBe(
			"allow",
		);
	});

	test("asks for write tools in default mode", () => {
		expect(
			evaluatePermission(
				"write_file",
				{ path: "a.ts", content: "x" },
				"default",
			),
		).toBe("ask");
		expect(
			evaluatePermission(
				"edit_file",
				{ path: "a.ts", old_string: "a", new_string: "b" },
				"default",
			),
		).toBe("ask");
	});

	test("allows write tools in accept-edits mode", () => {
		expect(
			evaluatePermission(
				"write_file",
				{ path: "a.ts", content: "x" },
				"accept-edits",
			),
		).toBe("allow");
		expect(
			evaluatePermission(
				"run_terminal_cmd",
				{ command: "echo hi" },
				"accept-edits",
			),
		).toBe("ask");
	});

	test("denies write tools in dont-ask mode", () => {
		expect(
			evaluatePermission(
				"edit_file",
				{ path: "a.ts", old_string: "a", new_string: "b" },
				"dont-ask",
			),
		).toBe("deny");
	});

	test("asks for shell in default mode", () => {
		expect(
			evaluatePermission("run_terminal_cmd", { command: "echo hi" }, "default"),
		).toBe("ask");
	});

	test("denies shell in dont-ask mode", () => {
		expect(
			evaluatePermission(
				"run_terminal_cmd",
				{ command: "echo hi" },
				"dont-ask",
			),
		).toBe("deny");
	});

	test("allows shell in yolo mode for safe commands", () => {
		expect(
			evaluatePermission("run_terminal_cmd", { command: "echo hi" }, "yolo"),
		).toBe("allow");
	});

	test("denies dangerous commands even in yolo mode", () => {
		expect(
			evaluatePermission("run_terminal_cmd", { command: "rm -rf /" }, "yolo"),
		).toBe("deny");
	});
});
