import { getTrimTokenBudget, summarizeContextUsage } from "../repl/context";
import type { ToolDefinition } from "../schemas/chat";
import { defineLocalTool, ToolRegistry } from "./registry";
import type { LocalToolSpec } from "./types";

export {
	defineLocalTool,
	ToolRegistry,
	toolMessageFromResult,
} from "./registry";
export type { ToolExecutionContext, ToolExecutor } from "./types";

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

export const LOCAL_TOOL_SPECS: LocalToolSpec[] = [
	defineLocalTool({
		name: "get_current_time",
		description: "获取当前本地时间的 ISO 8601 字符串",
		parameters: { type: "object", properties: {}, required: [] },
		execute: async () => {
			const now = new Date();
			return JSON.stringify({
				iso: formatLocalIso8601(now),
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			});
		},
	}),
	defineLocalTool({
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
		execute: async (args) => {
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
				const message =
					err instanceof Error ? err.message : "calculation failed";
				return JSON.stringify({ error: message });
			}
		},
	}),
	defineLocalTool({
		name: "get_context_usage",
		description: "获取当前对话的上下文 token 用量估算",
		parameters: { type: "object", properties: {}, required: [] },
		execute: async (_args, context) => {
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
	}),
	defineLocalTool({
		name: "fetch_url",
		description:
			"抓取 HTTP/HTTPS 网页并返回文本内容（HTML 或纯文本），支持 max_length 截断",
		parameters: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description: "要抓取的 URL，例如 https://example.com",
				},
				max_length: {
					type: "number",
					description: "最大返回字符数，默认 5000",
				},
			},
			required: ["url"],
		},
		execute: async (args) => {
			const url = (args as { url?: unknown }).url;
			const maxLengthRaw = (args as { max_length?: unknown }).max_length;
			const maxLength =
				typeof maxLengthRaw === "number" && maxLengthRaw > 0
					? Math.min(maxLengthRaw, 50_000)
					: 5000;

			if (typeof url !== "string" || !url.trim()) {
				return JSON.stringify({ error: "url must be a non-empty string" });
			}

			let parsed: URL;
			try {
				parsed = new URL(url.trim());
			} catch {
				return JSON.stringify({ error: "invalid url" });
			}
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				return JSON.stringify({ error: "only http and https URLs are supported" });
			}

			try {
				const response = await fetch(parsed.toString(), {
					redirect: "follow",
					signal: AbortSignal.timeout(30_000),
				});
				const contentType = response.headers.get("content-type") ?? "";
				const body = await response.text();
				const truncated = body.length > maxLength;
				return JSON.stringify({
					url: parsed.toString(),
					status: response.status,
					contentType,
					content: body.slice(0, maxLength),
					truncated,
					totalLength: body.length,
				});
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "fetch failed";
				return JSON.stringify({ error: message, url: parsed.toString() });
			}
		},
	}),
];

function specToDefinition(spec: LocalToolSpec): ToolDefinition {
	return {
		type: "function",
		function: {
			name: spec.name,
			description: spec.description,
			parameters: spec.parameters,
		},
	};
}

export const GET_CURRENT_TIME_TOOL = specToDefinition(
	LOCAL_TOOL_SPECS[0] ?? {
		name: "get_current_time",
		description: "",
		parameters: {},
		execute: async () => "{}",
	},
);
export const CALCULATE_TOOL = specToDefinition(
	LOCAL_TOOL_SPECS[1] ?? {
		name: "calculate",
		description: "",
		parameters: {},
		execute: async () => "{}",
	},
);
export const GET_CONTEXT_USAGE_TOOL = specToDefinition(
	LOCAL_TOOL_SPECS[2] ?? {
		name: "get_context_usage",
		description: "",
		parameters: {},
		execute: async () => "{}",
	},
);

export function registerLocalTools(registry: ToolRegistry): void {
	for (const spec of LOCAL_TOOL_SPECS) {
		registry.registerLocal(spec);
	}
}

export function createLocalToolRegistry(): ToolRegistry {
	const registry = new ToolRegistry();
	registerLocalTools(registry);
	return registry;
}

/** @deprecated 使用 registry.getDefinitions() */
export const TOOL_DEFINITIONS: ToolDefinition[] = LOCAL_TOOL_SPECS.map(
	(spec) => ({
		type: "function" as const,
		function: {
			name: spec.name,
			description: spec.description,
			parameters: spec.parameters,
		},
	}),
);
