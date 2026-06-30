import type { AgentToolStep } from "./loop";

function formatToolArgs(args: unknown): string {
	if (args === undefined) return "";
	try {
		return JSON.stringify(args);
	} catch {
		return String(args);
	}
}

function previewToolResult(result: string, maxLen = 200): string {
	if (result.length <= maxLen) return result;
	return `${result.slice(0, maxLen)}…`;
}

export function formatToolStepLog(step: AgentToolStep): string {
	return `[tool] ${step.name}(${formatToolArgs(step.args)})\n[tool result] ${previewToolResult(step.result)}`;
}

export function printAgentToolSteps(steps: AgentToolStep[]): void {
	if (steps.length === 0) return;
	for (const step of steps) {
		console.log(`\n${formatToolStepLog(step)}`);
	}
	console.log();
}
