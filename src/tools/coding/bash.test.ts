import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalToolRegistry } from "../local";
import { executeRunTerminalCmd } from "./bash";

describe("run_terminal_cmd tool", () => {
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
		workspace = await mkdtemp(join(tmpdir(), "learning-pi-bash-"));
		previousRoot = process.env.WORKSPACE_ROOT;
		process.env.WORKSPACE_ROOT = workspace;
	}

	test("runs command in workspace", async () => {
		await setupWorkspace();
		const raw = await executeRunTerminalCmd({ command: "echo hello-bash" });
		const parsed = JSON.parse(raw) as {
			stdout: string;
			exitCode: number | null;
			timedOut: boolean;
		};
		expect(parsed.stdout.trim()).toBe("hello-bash");
		expect(parsed.exitCode).toBe(0);
		expect(parsed.timedOut).toBe(false);
	});

	test("rejects cwd outside workspace", async () => {
		await setupWorkspace();
		const raw = await executeRunTerminalCmd({
			command: "echo hi",
			cwd: "..",
		});
		const parsed = JSON.parse(raw) as { error: string };
		expect(parsed.error).toContain("path escapes workspace");
	});

	test("registers run_terminal_cmd in local tool registry", () => {
		const registry = createLocalToolRegistry();
		expect(registry.has("run_terminal_cmd")).toBe(true);
	});
});
