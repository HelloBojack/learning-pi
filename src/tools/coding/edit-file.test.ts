import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalToolRegistry } from "../local";
import { executeEditFile } from "./edit-file";

describe("edit_file tool", () => {
	let workspace: string;
	let previousRoot: string | undefined;

	afterEach(async () => {
		if (previousRoot === undefined) {
			delete process.env.WORKSPACE_ROOT;
		} else {
			process.env.WORKSPACE_ROOT = previousRoot;
		}
		if (workspace) {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	async function setupWorkspace(content = "alpha\nbeta\n"): Promise<void> {
		workspace = await mkdtemp(join(tmpdir(), "learning-pi-edit-"));
		previousRoot = process.env.WORKSPACE_ROOT;
		process.env.WORKSPACE_ROOT = workspace;
		await writeFile(join(workspace, "sample.txt"), content);
	}

	test("replaces unique old_string", async () => {
		await setupWorkspace();
		const raw = await executeEditFile({
			path: "sample.txt",
			old_string: "beta",
			new_string: "gamma",
		});
		const parsed = JSON.parse(raw) as { replacements: number };
		expect(parsed.replacements).toBe(1);
		const disk = await readFile(join(workspace, "sample.txt"), "utf-8");
		expect(disk).toBe("alpha\ngamma\n");
	});

	test("rejects ambiguous old_string without replace_all", async () => {
		await setupWorkspace("foo bar foo");
		const raw = await executeEditFile({
			path: "sample.txt",
			old_string: "foo",
			new_string: "baz",
		});
		const parsed = JSON.parse(raw) as { error: string; matchCount: number };
		expect(parsed.error).toContain("matches 2 times");
		expect(parsed.matchCount).toBe(2);
	});

	test("rejects when expected mtime does not match", async () => {
		await setupWorkspace();
		const info = await stat(join(workspace, "sample.txt"));
		const raw = await executeEditFile({
			path: "sample.txt",
			old_string: "beta",
			new_string: "gamma",
			expected_mtime_ms: Math.floor(info.mtimeMs) - 1,
		});
		const parsed = JSON.parse(raw) as { error: string };
		expect(parsed.error).toContain("mtime mismatch");
	});

	test("registers edit_file in local tool registry", () => {
		const registry = createLocalToolRegistry();
		expect(registry.has("edit_file")).toBe(true);
	});
});
