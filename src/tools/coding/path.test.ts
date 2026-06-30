import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getWorkspaceRoot,
	PathSandboxError,
	resolveSafePath,
	toWorkspaceRelative,
} from "./path";

describe("path sandbox", () => {
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
		workspace = await mkdtemp(join(tmpdir(), "learning-pi-ws-"));
		previousRoot = process.env.WORKSPACE_ROOT;
		process.env.WORKSPACE_ROOT = workspace;
		await writeFile(join(workspace, "inside.txt"), "ok");
	}

	test("getWorkspaceRoot honors WORKSPACE_ROOT", async () => {
		await setupWorkspace();
		expect(getWorkspaceRoot()).toBe(realpathSync(workspace));
	});

	test("resolveSafePath accepts relative path inside workspace", async () => {
		await setupWorkspace();
		const resolved = resolveSafePath("inside.txt");
		expect(resolved.endsWith("/inside.txt")).toBe(true);
		expect(resolved).toContain("learning-pi-ws-");
	});

	test("resolveSafePath rejects path traversal", async () => {
		await setupWorkspace();
		expect(() => resolveSafePath("../outside.txt")).toThrow(PathSandboxError);
		expect(() => resolveSafePath("../../etc/passwd")).toThrow(PathSandboxError);
	});

	test("resolveSafePath rejects empty path", async () => {
		await setupWorkspace();
		expect(() => resolveSafePath("   ")).toThrow(PathSandboxError);
	});

	test("resolveSafePath rejects symlink escape when target exists", async () => {
		await setupWorkspace();
		const outside = await mkdtemp(join(tmpdir(), "learning-pi-out-"));
		try {
			await writeFile(join(outside, "secret.txt"), "secret");
			await symlink(outside, join(workspace, "link-out"));
			expect(() => resolveSafePath("link-out/secret.txt")).toThrow(
				PathSandboxError,
			);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	test("toWorkspaceRelative returns path relative to root", async () => {
		await setupWorkspace();
		await mkdir(join(workspace, "src"), { recursive: true });
		await writeFile(join(workspace, "src", "main.ts"), "");
		const abs = resolveSafePath("src/main.ts");
		expect(toWorkspaceRelative(abs)).toBe("src/main.ts");
	});
});
