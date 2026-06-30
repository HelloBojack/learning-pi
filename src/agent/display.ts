import type { TokenUsage } from "../schemas/chat";
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

/** token 用量行；label 默认 `tokens`（本轮），会话累计可用 `session`。 */
export function formatTokenUsageLine(
	usage: TokenUsage,
	label = "tokens",
): string {
	const costIn = (usage.promptTokens / 1_000_000) * 3;
	const costOut = (usage.completionTokens / 1_000_000) * 15;
	const total = costIn + costOut;
	return `[${label}] ${usage.promptTokens} in / ${usage.completionTokens} out（约 $${total.toFixed(4)}）`;
}

export function printChatDivider(): void {
	console.log(`\n ${"─".repeat(50)}`);
}
