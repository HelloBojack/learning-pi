import { defineLocalTool } from "../registry";
import type { LocalToolSpec } from "../types";
import { getWorkspaceRoot, PathSandboxError, resolveSafePath } from "./path";

export const DEFAULT_BASH_TIMEOUT_MS = 30_000;
export const MAX_BASH_TIMEOUT_MS = 120_000;
export const MAX_BASH_OUTPUT_CHARS = 32_000;

export type RunTerminalCmdArgs = {
	command?: unknown;
	cwd?: unknown;
	timeout_ms?: unknown;
};

function parseTimeoutMs(value: unknown): number {
	if (value === undefined || value === null) {
		return DEFAULT_BASH_TIMEOUT_MS;
	}
	if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
		throw new Error("timeout_ms must be a positive number");
	}
	return Math.min(Math.floor(value), MAX_BASH_TIMEOUT_MS);
}

function truncateOutput(text: string): { text: string; truncated: boolean } {
	if (text.length <= MAX_BASH_OUTPUT_CHARS) {
		return { text, truncated: false };
	}
	return {
		text: text.slice(0, MAX_BASH_OUTPUT_CHARS),
		truncated: true,
	};
}

export async function executeRunTerminalCmd(
	args: RunTerminalCmdArgs,
): Promise<string> {
	const command = args.command;
	if (typeof command !== "string" || !command.trim()) {
		return JSON.stringify({ error: "command must be a non-empty string" });
	}

	let timeoutMs: number;
	try {
		timeoutMs = parseTimeoutMs(args.timeout_ms);
	} catch (err) {
		const message = err instanceof Error ? err.message : "invalid timeout_ms";
		return JSON.stringify({ error: message });
	}

	const workspaceRoot = getWorkspaceRoot();
	let cwd = workspaceRoot;
	if (typeof args.cwd === "string" && args.cwd.trim()) {
		try {
			cwd = resolveSafePath(args.cwd.trim(), workspaceRoot);
		} catch (err) {
			const message =
				err instanceof PathSandboxError ? err.message : "invalid cwd";
			return JSON.stringify({ error: message });
		}
	}

	const shell = process.env.SHELL?.trim() || "/bin/bash";
	const proc = Bun.spawn([shell, "-lc", command.trim()], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, timeoutMs);

	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		const out = truncateOutput(stdout);
		const errOut = truncateOutput(stderr);

		return JSON.stringify({
			command: command.trim(),
			cwd,
			exitCode: timedOut ? null : exitCode,
			timedOut,
			stdout: out.text,
			stderr: errOut.text,
			truncated: out.truncated || errOut.truncated,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "command failed";
		return JSON.stringify({ error: message, command: command.trim() });
	} finally {
		clearTimeout(timer);
	}
}

export const RUN_TERMINAL_CMD_TOOL_SPEC: LocalToolSpec = defineLocalTool({
	name: "run_terminal_cmd",
	description:
		"在工作区内执行 shell 命令并返回 stdout/stderr（需用户确认，除非 PERMISSION_MODE=yolo）",
	parameters: {
		type: "object",
		properties: {
			command: {
				type: "string",
				description: "要执行的 shell 命令",
			},
			cwd: {
				type: "string",
				description: "工作目录（须在工作区内，默认 WORKSPACE_ROOT）",
			},
			timeout_ms: {
				type: "number",
				description: `超时毫秒数，默认 ${DEFAULT_BASH_TIMEOUT_MS}`,
			},
		},
		required: ["command"],
	},
	execute: async (args) => executeRunTerminalCmd(args as RunTerminalCmdArgs),
});
