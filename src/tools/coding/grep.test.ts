import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalToolRegistry } from "../local";
import { executeGrep } from "./grep";

describe("grep tool", () => {
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
		workspace = await mkdtemp(join(tmpdir(), "learning-pi-grep-"));
		previousRoot = process.env.WORKSPACE_ROOT;
		process.env.WORKSPACE_ROOT = workspace;
		await writeFile(join(workspace, "alpha.ts"), "const foo = 1;\n");
		await writeFile(join(workspace, "beta.txt"), "nothing here\n");
	}

	test("finds pattern in workspace files", async () => {
		await setupWorkspace();
		const raw = await executeGrep({ pattern: "foo", path: "." });
		const parsed = JSON.parse(raw) as {
			matchCount: number;
			matches: Array<{ path: string; line: number; text: string }>;
		};
		expect(parsed.matchCount).toBeGreaterThanOrEqual(1);
		expect(parsed.matches.some((m) => m.path.endsWith("alpha.ts"))).toBe(true);
	});

	test("rejects path outside workspace", async () => {
		await setupWorkspace();
		const raw = await executeGrep({ pattern: "foo", path: "../" });
		const parsed = JSON.parse(raw) as { error: string };
		expect(parsed.error).toContain("path escapes workspace");
	});

	test("registers grep in local tool registry", () => {
		const registry = createLocalToolRegistry();
		expect(registry.has("grep")).toBe(true);
	});
});
