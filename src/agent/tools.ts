import { getTrimTokenBudget, summarizeContextUsage } from "../repl/context";
import type { ChatMessage, ToolDefinition } from "../schemas/chat";

export type ToolExecutionContext = {
	history?: ChatMessage[];
};

export type ToolExecutor = (
	args: unknown,
	context: ToolExecutionContext,
) => Promise<string>;

export const GET_CURRENT_TIME_TOOL: ToolDefinition = {
	type: "function",
	function: {
		name: "get_current_time",
		description: "获取当前本地时间的 ISO 8601 字符串",
		parameters: {
			type: "object",
			properties: {},
			required: [],
		},
	},
};

export const CALCULATE_TOOL: ToolDefinition = {
	type: "function",
	function: {
		name: "calculate",
		description: "计算简单数学表达式，支持 + - * / % 和括号",
		parameters: {
			type: "object",
			properties: {
				expression: {
					type: "string",
					description: '数学表达式，例如 "2+3*4" 或 "(10-2)/4"',
				},
			},
			required: ["expression"],
		},
	},
};

export const GET_CONTEXT_USAGE_TOOL: ToolDefinition = {
	type: "function",
	function: {
		name: "get_context_usage",
		description: "获取当前对话的上下文 token 用量估算",
		parameters: {
			type: "object",
			properties: {},
			required: [],
		},
	},
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	GET_CURRENT_TIME_TOOL,
	CALCULATE_TOOL,
	GET_CONTEXT_USAGE_TOOL,
];

const SAFE_MATH_EXPRESSION_RE = /^[\d+\-*/().%\s]+$/;

/** 白名单校验后计算数学表达式。 */
export function evaluateMathExpression(expression: string): number {
	const trimmed = expression.trim();
	if (!trimmed) {
		throw new Error("expression must not be empty");
	}
	if (!SAFE_MATH_EXPRESSION_RE.test(trimmed)) {
		throw new Error("expression contains invalid characters");
	}

	const result = Function(`"use strict"; return (${trimmed});`)() as unknown;
	if (typeof result !== "number" || !Number.isFinite(result)) {
		throw new Error("expression did not evaluate to a finite number");
	}

	return result;
}

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

/** 本地时间的 ISO 8601 字符串（含时区偏移，如 +08:00）。 */
export function formatLocalIso8601(date: Date): string {
	const offsetMin = -date.getTimezoneOffset();
	const sign = offsetMin >= 0 ? "+" : "-";
	const abs = Math.abs(offsetMin);
	const offset = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;

	return (
		`${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
		`T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` +
		`.${String(date.getMilliseconds()).padStart(3, "0")}${offset}`
	);
}

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
	async get_current_time() {
		const now = new Date();
		return JSON.stringify({
			iso: formatLocalIso8601(now),
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		});
	},

	async calculate(args) {
		const expression = (args as { expression?: unknown }).expression;
		if (typeof expression !== "string" || !expression.trim()) {
			return JSON.stringify({
				error: "expression must be a non-empty string",
			});
		}

		try {
			const result = evaluateMathExpression(expression);
			return JSON.stringify({ expression: expression.trim(), result });
		} catch (err) {
			const message = err instanceof Error ? err.message : "calculation failed";
			return JSON.stringify({ error: message });
		}
	},

	async get_context_usage(_args, context) {
		if (!context.history) {
			return JSON.stringify({ error: "conversation history unavailable" });
		}

		const usage = summarizeContextUsage(context.history);
		return JSON.stringify({
			tokens: usage.tokens,
			limit: usage.limit,
			remaining: usage.remaining,
			chars: usage.chars,
			messageCount: usage.messageCount,
			turnCount: usage.turnCount,
			trimBudget: getTrimTokenBudget(),
		});
	},
};

export function getToolDefinitions(): ToolDefinition[] {
	return TOOL_DEFINITIONS;
}

export function parseToolArguments(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export async function executeTool(
	name: string,
	argsJson: string,
	context: ToolExecutionContext = {},
): Promise<string> {
	const executor = TOOL_EXECUTORS[name];
	if (!executor) {
		return JSON.stringify({ error: `unknown tool: ${name}` });
	}

	const args = parseToolArguments(argsJson);
	if (args === null) {
		return JSON.stringify({
			error: "invalid tool arguments JSON",
			raw: argsJson,
		});
	}

	try {
		return await executor(args, context);
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "tool execution failed";
		return JSON.stringify({ error: message });
	}
}

export function toolMessageFromResult(
	toolCallId: string,
	result: string,
	name?: string,
): {
	role: "tool";
	tool_call_id: string;
	content: string;
	name?: string;
} {
	return {
		role: "tool",
		tool_call_id: toolCallId,
		content: result,
		...(name ? { name } : {}),
	};
}
