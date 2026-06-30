import { matchesDangerousBashCommand } from "./patterns";
import type { PermissionDecision, PermissionMode } from "./types";

const READ_ONLY_TOOLS = new Set(["read_file", "grep"]);
const SHELL_TOOL = "run_terminal_cmd";

export function getPermissionModeFromEnv(): PermissionMode {
	const raw = process.env.PERMISSION_MODE?.trim().toLowerCase();
	if (raw === "yolo") return "yolo";
	if (raw === "dont-ask" || raw === "dont_ask" || raw === "deny") {
		return "dont-ask";
	}
	return "default";
}

export function evaluatePermission(
	toolName: string,
	args: unknown,
	mode: PermissionMode = getPermissionModeFromEnv(),
): PermissionDecision {
	if (READ_ONLY_TOOLS.has(toolName)) {
		return "allow";
	}

	if (toolName !== SHELL_TOOL) {
		return "allow";
	}

	const command =
		typeof args === "object" &&
		args !== null &&
		"command" in args &&
		typeof (args as { command: unknown }).command === "string"
			? (args as { command: string }).command
			: "";

	if (!command.trim()) {
		return "deny";
	}

	if (matchesDangerousBashCommand(command)) {
		return "deny";
	}

	if (mode === "yolo") {
		return "allow";
	}

	if (mode === "dont-ask") {
		return "deny";
	}

	return "ask";
}

export function permissionDeniedMessage(
	toolName: string,
	reason: string,
): string {
	return JSON.stringify({ error: "permission denied", tool: toolName, reason });
}
