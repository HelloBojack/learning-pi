import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getActivePresetId, setActivePresetId } from "../prompts";
import type { ChatMessage } from "../schemas/chat";
import { clearStubEnv, stubRequiredEnv } from "../test/helpers";
import {
	formatCommand,
	getReplCommands,
	tryHandleLocalCommand,
} from "./commands";
import { createInitialHistory } from "./conversation";

describe("getReplCommands", () => {
	test("includes meta commands and presets", () => {
		const ids = getReplCommands().map((c) => c.id);
		expect(ids).toContain("help");
		expect(ids).toContain("clear");
		expect(ids).toContain("tokens");
		expect(ids).toContain("presets");
		expect(ids).toContain("code");
		expect(ids).not.toContain("list");
	});
});

describe("formatCommand", () => {
	test("prefixes command id with slash", () => {
		expect(formatCommand("help")).toBe("/help");
	});
});

describe("tryHandleLocalCommand", () => {
	beforeEach(() => {
		stubRequiredEnv();
	});

	afterEach(() => {
		clearStubEnv();
		setActivePresetId("default");
	});

	test("returns not-local for normal chat input", () => {
		const history = createInitialHistory();
		expect(tryHandleLocalCommand("你好", history)).toBe("not-local");
	});

	test("returns exit for /quit and aliases", () => {
		const history = createInitialHistory();
		expect(tryHandleLocalCommand("/quit", history)).toBe("exit");
		expect(tryHandleLocalCommand("/exit", history)).toBe("exit");
		expect(tryHandleLocalCommand("/q", history)).toBe("exit");
	});

	test("/clear removes user and assistant messages", () => {
		const history: ChatMessage[] = [
			...createInitialHistory(),
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello" },
		];

		expect(tryHandleLocalCommand("/clear", history)).toBe("handled");
		expect(history).toHaveLength(1);
		expect(history[0]?.role).toBe("system");
	});

	test("/list alias resolves to presets", () => {
		const history = createInitialHistory();
		expect(tryHandleLocalCommand("/list", history)).toBe("handled");
	});

	test("/code switches preset and resets history", () => {
		setActivePresetId("default");
		const history: ChatMessage[] = [
			...createInitialHistory(),
			{ role: "user", content: "old" },
		];

		expect(tryHandleLocalCommand("/code", history)).toBe("handled");
		expect(getActivePresetId()).toBe("code");
		expect(history).toHaveLength(1);
		expect(history[0]?.role).toBe("system");
		expect(history[0]?.content).toContain("TypeScript");
	});

	test("blocks preset switch when SYSTEM_PROMPT is set", () => {
		process.env.SYSTEM_PROMPT = "fixed prompt";
		const history = createInitialHistory();

		expect(tryHandleLocalCommand("/code", history)).toBe("handled");
		expect(getActivePresetId()).toBe("default");
	});
});
