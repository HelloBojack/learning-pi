import type { ChatMessage } from "../schemas/chat";

/** 每条消息的 role / JSON 等格式开销（经验值）。 */
const MESSAGE_OVERHEAD_TOKENS = 4;

/** 未配置 CONTEXT_TOKEN_LIMIT 时的默认 context 上限。 */
export const DEFAULT_CONTEXT_TOKEN_LIMIT = 8192;

/** 发送前为即将生成的 assistant 回复预留的 token（heuristic）。 */
export const GENERATION_RESERVE_TOKENS = 1024;

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

export type ContextUsage = {
	/** heuristic 估算的 token 数 */
	tokens: number;
	/** 消息正文总字符数 */
	chars: number;
	/** context 上限（来自 env 或默认值） */
	limit: number;
	remaining: number;
	messageCount: number;
	turnCount: number;
};

/**
 * 简单 token 估算：CJK 约 1 字 ≈ 1 token，其它字符约 4 字 ≈ 1 token。
 * 不依赖模型 tokenizer，仅供上下文裁剪决策与 /tokens 展示。
 */
export function estimateTextTokens(text: string): number {
	let cjk = 0;
	let other = 0;

	for (const char of text) {
		if (CJK_RE.test(char)) {
			cjk += 1;
		} else {
			other += 1;
		}
	}

	return cjk + Math.ceil(other / 4);
}

export function estimateMessageTokens(message: ChatMessage): number {
	return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content);
}

export function estimateHistoryTokens(messages: ChatMessage[]): number {
	return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

export function countHistoryChars(messages: ChatMessage[]): number {
	return messages.reduce((sum, msg) => sum + msg.content.length, 0);
}

export function getContextTokenLimit(): number {
	const raw = process.env.CONTEXT_TOKEN_LIMIT?.trim();
	if (!raw) return DEFAULT_CONTEXT_TOKEN_LIMIT;

	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_CONTEXT_TOKEN_LIMIT;
	}

	return Math.floor(parsed);
}

/** 裁剪时使用的有效上限（为 assistant 回复预留空间）。 */
export function getTrimTokenBudget(): number {
	const limit = getContextTokenLimit();
	return Math.max(
		MESSAGE_OVERHEAD_TOKENS * 2,
		limit - GENERATION_RESERVE_TOKENS,
	);
}

export type TrimHistoryResult = {
	trimmedCount: number;
	tokensBefore: number;
	tokensAfter: number;
};

/**
 * 以 user 消息为锚将非 system 消息分组为一轮对话。
 * 一轮可包含 agent 轨迹：user → assistant(tool_calls) → tool* → assistant。
 */
export function groupHistoryIntoUserTurns(
	messages: ChatMessage[],
): ChatMessage[][] {
	const turns: ChatMessage[][] = [];
	let current: ChatMessage[] = [];

	for (const msg of messages) {
		if (msg.role === "user") {
			if (current.length > 0) turns.push(current);
			current = [msg];
			continue;
		}
		current.push(msg);
	}

	if (current.length > 0) turns.push(current);
	return turns;
}

function rebuildHistory(
	systemMessages: ChatMessage[],
	turns: ChatMessage[][],
): ChatMessage[] {
	return [...systemMessages, ...turns.flat()];
}

/**
 * 滑动窗口裁剪：保留 system，从最早一轮起整轮删除，直到估算 token 低于预算。
 * 至少保留 1 轮（通常是当前 user 输入）。原地修改 history。
 */
export function trimHistoryToTokenLimit(
	history: ChatMessage[],
	budget?: number,
): TrimHistoryResult {
	const cap = budget ?? getTrimTokenBudget();
	const tokensBefore = estimateHistoryTokens(history);

	if (tokensBefore <= cap) {
		return { trimmedCount: 0, tokensBefore, tokensAfter: tokensBefore };
	}

	const systemMessages = history.filter((m) => m.role === "system");
	const turns = groupHistoryIntoUserTurns(
		history.filter((m) => m.role !== "system"),
	);

	let trimmedCount = 0;

	while (
		turns.length > 1 &&
		estimateHistoryTokens(rebuildHistory(systemMessages, turns)) > cap
	) {
		const removed = turns.shift();
		trimmedCount += removed?.length ?? 0;
	}

	const next = rebuildHistory(systemMessages, turns);
	history.length = 0;
	history.push(...next);

	return {
		trimmedCount,
		tokensBefore,
		tokensAfter: estimateHistoryTokens(history),
	};
}

export function formatTrimNotice(result: TrimHistoryResult): string {
	if (result.trimmedCount === 0) return "";
	return `[上下文] 已裁剪 ${result.trimmedCount} 条旧消息（约 ${formatNumber(result.tokensBefore)} → ${formatNumber(result.tokensAfter)} tokens）`;
}

export function summarizeContextUsage(messages: ChatMessage[]): ContextUsage {
	const tokens = estimateHistoryTokens(messages);
	const limit = getContextTokenLimit();

	return {
		tokens,
		chars: countHistoryChars(messages),
		limit,
		remaining: Math.max(0, limit - tokens),
		messageCount: messages.length,
		turnCount: messages.filter((m) => m.role !== "system").length,
	};
}

function formatNumber(n: number): string {
	return n.toLocaleString("en-US");
}

export function formatContextUsage(usage: ContextUsage): string {
	const usedPct = Math.min(100, Math.round((usage.tokens / usage.limit) * 100));
	const trimBudget = getTrimTokenBudget();
	const lines = [
		`上下文（估算）：约 ${formatNumber(usage.tokens)} / ${formatNumber(usage.limit)} tokens（${usedPct}%）`,
		`自动裁剪预算：约 ${formatNumber(trimBudget)} tokens（预留 ${formatNumber(GENERATION_RESERVE_TOKENS)} 给回复）`,
		`字符数：${formatNumber(usage.chars)}`,
		`剩余（估算）：约 ${formatNumber(usage.remaining)} tokens`,
		`消息：${usage.messageCount} 条（user/assistant ${usage.turnCount} 条）`,
	];
	return lines.join("\n");
}

export function formatContextUsageWithSummary(
	usage: ContextUsage,
	summary: string | null,
): string {
	const base = formatContextUsage(usage);
	if (!summary) return base;
	const preview = summary.length > 120 ? `${summary.slice(0, 120)}…` : summary;
	return `${base}\n对话摘要：${preview}`;
}

export function printContextUsage(history: ChatMessage[]): void {
	console.log(`\n${formatContextUsage(summarizeContextUsage(history))}\n`);
}
