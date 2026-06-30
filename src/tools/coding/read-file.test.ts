import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalToolRegistry } from "../local";
import { executeReadFile, MAX_READ_FILE_BYTES } from "./read-file";

describe("read_file tool", () => {
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

	async function setupWorkspace(
		content = "line1\nline2\nline3\n",
	): Promise<void> {
		workspace = await mkdtemp(join(tmpdir(), "learning-pi-read-"));
		previousRoot = process.env.WORKSPACE_ROOT;
		process.env.WORKSPACE_ROOT = workspace;
		await writeFile(join(workspace, "sample.txt"), content);
	}

	test("reads file content via executeReadFile", async () => {
		await setupWorkspace();
		const raw = await executeReadFile({ path: "sample.txt" });
		const parsed = JSON.parse(raw) as {
			path: string;
			content: string;
			totalLines: number;
			mtime_ms: number;
		};
		expect(parsed.path).toBe("sample.txt");
		expect(parsed.content).toBe("line1\nline2\nline3");
		expect(parsed.totalLines).toBe(3);
		expect(typeof parsed.mtime_ms).toBe("number");
	});

	test("supports offset and limit", async () => {
		await setupWorkspace();
		const raw = await executeReadFile({
			path: "sample.txt",
			offset: 2,
			limit: 1,
		});
		const parsed = JSON.parse(raw) as {
			content: string;
			startLine: number;
			endLine: number;
		};
		expect(parsed.content).toBe("line2");
		expect(parsed.startLine).toBe(2);
		expect(parsed.endLine).toBe(2);
	});

	test("rejects path outside workspace", async () => {
		await setupWorkspace();
		const raw = await executeReadFile({ path: "../sample.txt" });
		const parsed = JSON.parse(raw) as { error: string };
		expect(parsed.error).toContain("path escapes workspace");
	});

	test("returns error for missing file", async () => {
		await setupWorkspace();
		const raw = await executeReadFile({ path: "missing.txt" });
		const parsed = JSON.parse(raw) as { error: string };
		expect(parsed.error).toBe("file not found");
	});

	test("marks truncated when file exceeds byte limit", async () => {
		await setupWorkspace();
		const big = "x".repeat(MAX_READ_FILE_BYTES + 100);
		await writeFile(join(workspace, "big.txt"), big);
		const raw = await executeReadFile({ path: "big.txt" });
		const parsed = JSON.parse(raw) as {
			truncated: boolean;
			bytesRead: number;
		};
		expect(parsed.truncated).toBe(true);
		expect(parsed.bytesRead).toBe(MAX_READ_FILE_BYTES);
	});

	test("registered on local tool registry", async () => {
		await setupWorkspace();
		const registry = createLocalToolRegistry();
		expect(registry.has("read_file")).toBe(true);
		const raw = await registry.execute(
			"read_file",
			JSON.stringify({ path: "sample.txt" }),
		);
		const parsed = JSON.parse(raw) as { content: string };
		expect(parsed.content).toContain("line1");
	});
});
