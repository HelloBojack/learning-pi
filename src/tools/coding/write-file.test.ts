import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalToolRegistry } from "../local";
import { executeWriteFile } from "./write-file";

describe("write_file tool", () => {
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
		workspace = await mkdtemp(join(tmpdir(), "learning-pi-write-"));
		previousRoot = process.env.WORKSPACE_ROOT;
		process.env.WORKSPACE_ROOT = workspace;
	}

	test("writes file content", async () => {
		await setupWorkspace();
		const raw = await executeWriteFile({
			path: "notes/hello.txt",
			content: "hello world",
		});
		const parsed = JSON.parse(raw) as { path: string; bytesWritten: number };
		expect(parsed.path).toBe("notes/hello.txt");
		expect(parsed.bytesWritten).toBe(11);
		const disk = await readFile(join(workspace, "notes", "hello.txt"), "utf-8");
		expect(disk).toBe("hello world");
	});

	test("rejects path outside workspace", async () => {
		await setupWorkspace();
		const raw = await executeWriteFile({
			path: "../escape.txt",
			content: "nope",
		});
		const parsed = JSON.parse(raw) as { error: string };
		expect(parsed.error).toContain("path escapes workspace");
	});

	test("registers write_file in local tool registry", () => {
		const registry = createLocalToolRegistry();
		expect(registry.has("write_file")).toBe(true);
	});
});
