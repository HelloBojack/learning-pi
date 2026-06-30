import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalToolRegistry } from "../local";
import { executeListDir } from "./list-dir";

describe("list_dir tool", () => {
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

	async function setupWorkspace(): Promise<void> {
		workspace = await mkdtemp(join(tmpdir(), "learning-pi-list-"));
		previousRoot = process.env.WORKSPACE_ROOT;
		process.env.WORKSPACE_ROOT = workspace;
		await writeFile(join(workspace, "a.txt"), "a");
		await mkdir(join(workspace, "subdir"), { recursive: true });
	}

	test("lists directory entries", async () => {
		await setupWorkspace();
		const raw = await executeListDir({ path: "." });
		const parsed = JSON.parse(raw) as {
			entryCount: number;
			entries: Array<{ name: string; kind: string }>;
		};
		expect(parsed.entryCount).toBeGreaterThanOrEqual(2);
		expect(
			parsed.entries.some((e) => e.name === "a.txt" && e.kind === "file"),
		).toBe(true);
		expect(
			parsed.entries.some((e) => e.name === "subdir" && e.kind === "directory"),
		).toBe(true);
	});

	test("rejects path outside workspace", async () => {
		await setupWorkspace();
		const raw = await executeListDir({ path: "../" });
		const parsed = JSON.parse(raw) as { error: string };
		expect(parsed.error).toContain("path escapes workspace");
	});

	test("registers list_dir in local tool registry", () => {
		const registry = createLocalToolRegistry();
		expect(registry.has("list_dir")).toBe(true);
	});
});
