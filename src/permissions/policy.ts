import { matchesDangerousBashCommand } from "./patterns";
import type { PermissionDecision, PermissionMode } from "./types";

const READ_ONLY_TOOLS = new Set(["read_file", "grep", "list_dir"]);
const WRITE_TOOLS = new Set(["write_file", "edit_file"]);
const SHELL_TOOL = "run_terminal_cmd";

export function getPermissionModeFromEnv(): PermissionMode {
	const raw = process.env.PERMISSION_MODE?.trim().toLowerCase();
	if (raw === "yolo") return "yolo";
	if (raw === "accept-edits" || raw === "accept_edits") {
		return "accept-edits";
	}
	if (raw === "dont-ask" || raw === "dont_ask" || raw === "deny") {
		return "dont-ask";
	}
	return "default";
}

function stringField(args: unknown, field: string): string {
	if (
		typeof args === "object" &&
		args !== null &&
		field in args &&
		typeof (args as Record<string, unknown>)[field] === "string"
	) {
		return ((args as Record<string, string>)[field] ?? "").trim();
	}
	return "";
}

export function formatPermissionConfirmPrompt(
	toolName: string,
	args: unknown,
): string {
	if (toolName === SHELL_TOOL) {
		const command = stringField(args, "command");
		return `Allow run_terminal_cmd?\n  $ ${command}\n[y/N] `;
	}

	if (toolName === "write_file") {
		const path = stringField(args, "path");
		const content = stringField(args, "content");
		const preview =
			content.length > 120 ? `${content.slice(0, 120)}…` : content;
		return `Allow write_file?\n  path: ${path}\n  preview: ${preview}\n[y/N] `;
	}

	if (toolName === "edit_file") {
		const path = stringField(args, "path");
		const oldString = stringField(args, "old_string");
		const preview =
			oldString.length > 80 ? `${oldString.slice(0, 80)}…` : oldString;
		return `Allow edit_file?\n  path: ${path}\n  old_string: ${preview}\n[y/N] `;
	}

	return `Allow ${toolName}?\n[y/N] `;
}

function evaluateWritePermission(mode: PermissionMode): PermissionDecision {
	if (mode === "yolo" || mode === "accept-edits") return "allow";
	if (mode === "dont-ask") return "deny";
	return "ask";
}

function evaluateShellPermission(
	args: unknown,
	mode: PermissionMode,
): PermissionDecision {
	const command = stringField(args, "command");
	if (!command) return "deny";
	if (matchesDangerousBashCommand(command)) return "deny";
	if (mode === "yolo") return "allow";
	if (mode === "dont-ask") return "deny";
	return "ask";
}

export function evaluatePermission(
	toolName: string,
	args: unknown,
	mode: PermissionMode = getPermissionModeFromEnv(),
): PermissionDecision {
	if (READ_ONLY_TOOLS.has(toolName)) {
		return "allow";
	}

	if (WRITE_TOOLS.has(toolName)) {
		return evaluateWritePermission(mode);
	}

	if (toolName === SHELL_TOOL) {
		return evaluateShellPermission(args, mode);
	}

	return "allow";
}

export function permissionDeniedReason(
	toolName: string,
	mode: PermissionMode,
): string {
	if (WRITE_TOOLS.has(toolName) && mode === "dont-ask") {
		return "file edits disabled in dont-ask mode";
	}
	if (toolName === SHELL_TOOL) {
		if (mode === "dont-ask") {
			return "shell commands disabled in dont-ask mode";
		}
		return "command blocked by safety policy";
	}
	return "not allowed";
}

export function permissionDeniedMessage(
	toolName: string,
	reason: string,
): string {
	return JSON.stringify({ error: "permission denied", tool: toolName, reason });
}
