import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActivePresetId, setActivePresetId } from "../prompts";
import { clearStubEnv, stubRequiredEnv } from "../test/helpers";
import { createInitialHistory } from "./conversation";
import {
	countConversationTurns,
	loadLatestSession,
	saveLatestSession,
} from "./session";

describe("session persistence", () => {
	let originalCwd = process.cwd();
	let tempDir = "";

	beforeEach(async () => {
		originalCwd = process.cwd();
		tempDir = await mkdtemp(join(tmpdir(), "learning-pi-session-"));
		process.chdir(tempDir);
		stubRequiredEnv();
		setActivePresetId("default");
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		await rm(tempDir, { recursive: true, force: true });
		clearStubEnv();
		setActivePresetId("default");
	});

	test("countConversationTurns excludes system and tool messages", () => {
		const history = [
			...createInitialHistory(),
			{ role: "user" as const, content: "a" },
			{
				role: "tool" as const,
				content: "{}",
				tool_call_id: "call_1",
			},
			{ role: "assistant" as const, content: "b" },
		];
		expect(countConversationTurns(history)).toBe(2);
	});

	test("saveLatestSession and loadLatestSession roundtrip", async () => {
		setActivePresetId("code");
		const history = [
			...createInitialHistory(),
			{ role: "user" as const, content: "remember me" },
			{ role: "assistant" as const, content: "ok" },
		];

		await saveLatestSession(history);
		const loaded = await loadLatestSession();

		expect(loaded).not.toBeNull();
		expect(loaded).toEqual(history);
		expect(getActivePresetId()).toBe("code");
	});

	test("loadLatestSession returns null for missing or invalid file", async () => {
		expect(await loadLatestSession()).toBeNull();

		await Bun.write(join(tempDir, "sessions", "latest.json"), "{not json");
		expect(await loadLatestSession()).toBeNull();
	});

	test("loadLatestSession replaces system when SYSTEM_PROMPT is locked", async () => {
		const history = [
			{ role: "system" as const, content: "old system" },
			{ role: "user" as const, content: "hi" },
		];
		await saveLatestSession(history);

		process.env.SYSTEM_PROMPT = "env locked system";
		const loaded = await loadLatestSession();

		expect(loaded?.[0]?.content).toBe("env locked system");
		expect(loaded?.[1]?.content).toBe("hi");
	});

	test("saveLatestSession writes valid json", async () => {
		const history = createInitialHistory();
		await saveLatestSession(history);

		const raw = await readFile(
			join(tempDir, "sessions", "latest.json"),
			"utf-8",
		);
		const parsed = JSON.parse(raw);
		expect(parsed.version).toBe(1);
		expect(parsed.messages).toEqual(history);
	});
});
