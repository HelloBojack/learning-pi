import { chat } from "../llm/chat";
import type { ChatMessage } from "../schemas/chat";
import {
	estimateHistoryTokens,
	getTrimTokenBudget,
	type TrimHistoryResult,
	trimHistoryToTokenLimit,
} from "./context";

export const SUMMARY_SECTION_START = "---\n【对话摘要】\n";
export const SUMMARY_SECTION_END = "\n---";

const DEFAULT_KEEP_RECENT_TURNS = 2;

const SUMMARIZE_SYSTEM_PROMPT = `你是会议记录助手。将对话压缩为简洁摘要，保留：
- 用户的主要目标与约束
- 已确认的事实与决策
- 重要的代码/命令/结论
- 尚未解决的问题

使用中文，控制在 200–400 字，不要编造对话中没有的内容。`;

export type CompactHistoryResult = {
	summarized: boolean;
	compressedMessageCount: number;
	trimmed: TrimHistoryResult | null;
	tokensBefore: number;
	tokensAfter: number;
};

export function isSummaryEnabled(): boolean {
	const raw = process.env.CONTEXT_SUMMARIZE?.trim().toLowerCase();
	if (raw === "0" || raw === "false" || raw === "off") return false;
	return true;
}

export function getKeepRecentTurns(): number {
	const raw = process.env.CONTEXT_KEEP_RECENT_TURNS?.trim();
	if (!raw) return DEFAULT_KEEP_RECENT_TURNS;

	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return DEFAULT_KEEP_RECENT_TURNS;
	}

	return Math.floor(parsed);
}

export function parseSystemWithSummary(content: string): {
	base: string;
	summary: string | null;
} {
	const start = content.indexOf(SUMMARY_SECTION_START);
	if (start === -1) {
		return { base: content, summary: null };
	}

	const base = content.slice(0, start).trimEnd();
	const rest = content.slice(start + SUMMARY_SECTION_START.length);
	const end = rest.indexOf(SUMMARY_SECTION_END);
	const summary = end === -1 ? rest.trim() : rest.slice(0, end).trim();

	return { base, summary: summary || null };
}

export function applySummaryToSystemContent(
	base: string,
	summary: string,
): string {
	return `${base}\n\n${SUMMARY_SECTION_START}${summary.trim()}${SUMMARY_SECTION_END}`;
}

export function splitHistoryForCompression(
	history: ChatMessage[],
	keepRecentTurns: number,
): {
	systemMessages: ChatMessage[];
	toCompress: ChatMessage[];
	toKeep: ChatMessage[];
	priorSummary: string | null;
} {
	const systemMessages = history.filter((m) => m.role === "system");
	const turns = history.filter((m) => m.role !== "system");

	const groupedTurns: ChatMessage[][] = [];
	for (let i = 0; i < turns.length; ) {
		const msg = turns[i];
		if (!msg) break;

		if (msg.role === "user") {
			const turn: ChatMessage[] = [msg];
			i += 1;
			if (turns[i]?.role === "assistant") {
				turn.push(turns[i] as ChatMessage);
				i += 1;
			}
			groupedTurns.push(turn);
			continue;
		}

		groupedTurns.push([msg]);
		i += 1;
	}

	const keepCount = Math.max(1, keepRecentTurns);
	const keepTurns = groupedTurns.slice(-keepCount);
	const compressTurns = groupedTurns.slice(
		0,
		Math.max(0, groupedTurns.length - keepCount),
	);

	const firstSystem = systemMessages[0];
	const parsed = firstSystem
		? parseSystemWithSummary(firstSystem.content)
		: { base: "", summary: null };

	return {
		systemMessages,
		toCompress: compressTurns.flat(),
		toKeep: keepTurns.flat(),
		priorSummary: parsed.summary,
	};
}

export function formatTranscript(messages: ChatMessage[]): string {
	return messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
}

export function buildSummarizationMessages(
	toCompress: ChatMessage[],
	priorSummary: string | null,
): ChatMessage[] {
	const transcript = formatTranscript(toCompress);
	const userContent = priorSummary
		? `已有摘要：\n${priorSummary}\n\n请将以下较早对话合并进摘要并输出更新后的完整摘要：\n${transcript}`
		: `请摘要以下对话：\n${transcript}`;

	return [
		{ role: "system", content: SUMMARIZE_SYSTEM_PROMPT },
		{ role: "user", content: userContent },
	];
}

export async function defaultSummarizeMessages(
	toCompress: ChatMessage[],
	priorSummary: string | null,
): Promise<string> {
	const summary = await chat(
		buildSummarizationMessages(toCompress, priorSummary),
		{
			temperature: 0.2,
		},
	);
	return summary.trim();
}

export function applySummaryToHistory(
	history: ChatMessage[],
	summary: string,
	toKeep: ChatMessage[],
): void {
	const systemIdx = history.findIndex((m) => m.role === "system");
	if (systemIdx === -1) return;

	const current = history[systemIdx];
	if (!current) return;

	const { base } = parseSystemWithSummary(current.content);
	const systemMessages = history.filter((m) => m.role === "system");
	const updatedSystem = {
		role: "system" as const,
		content: applySummaryToSystemContent(base, summary),
	};

	history.length = 0;
	if (systemMessages.length > 0) {
		history.push(updatedSystem, ...systemMessages.slice(1));
	} else {
		history.push(updatedSystem);
	}
	history.push(...toKeep);
}

export function formatCompactNotice(result: CompactHistoryResult): string {
	if (!result.summarized) return "";
	return `[上下文] 已摘要压缩 ${result.compressedMessageCount} 条旧消息（约 ${result.tokensBefore.toLocaleString("en-US")} → ${result.tokensAfter.toLocaleString("en-US")} tokens）`;
}

export type CompactHistoryOptions = {
	budget?: number;
	keepRecentTurns?: number;
	summarize?: (
		messages: ChatMessage[],
		priorSummary: string | null,
	) => Promise<string>;
};

/**
 * 上下文压缩：超预算时先摘要旧轮次并写入 system，仍超限则滑动窗口裁剪。
 */
export async function compactHistoryIfNeeded(
	history: ChatMessage[],
	options: CompactHistoryOptions = {},
): Promise<CompactHistoryResult> {
	const budget = options.budget ?? getTrimTokenBudget();
	const tokensBefore = estimateHistoryTokens(history);

	if (tokensBefore <= budget) {
		return {
			summarized: false,
			compressedMessageCount: 0,
			trimmed: null,
			tokensBefore,
			tokensAfter: tokensBefore,
		};
	}

	let summarized = false;
	let compressedMessageCount = 0;
	let trimmed: TrimHistoryResult | null = null;

	if (isSummaryEnabled()) {
		const keepRecentTurns = options.keepRecentTurns ?? getKeepRecentTurns();
		const { toCompress, toKeep, priorSummary } = splitHistoryForCompression(
			history,
			keepRecentTurns,
		);

		if (toCompress.length > 0) {
			try {
				const summarize = options.summarize ?? defaultSummarizeMessages;
				const summary = await summarize(toCompress, priorSummary);
				if (summary) {
					applySummaryToHistory(history, summary, toKeep);
					summarized = true;
					compressedMessageCount = toCompress.length;
				}
			} catch {
				// 摘要失败时降级为滑动窗口裁剪
			}
		}
	}

	if (estimateHistoryTokens(history) > budget) {
		trimmed = trimHistoryToTokenLimit(history, budget);
	}

	return {
		summarized,
		compressedMessageCount,
		trimmed,
		tokensBefore,
		tokensAfter: estimateHistoryTokens(history),
	};
}

export function getStoredSummary(history: ChatMessage[]): string | null {
	const system = history.find((m) => m.role === "system");
	if (!system) return null;
	return parseSystemWithSummary(system.content).summary;
}

export function formatStoredSummaryDisplay(summary: string | null): string {
	if (!summary) {
		return [
			"（暂无对话摘要）",
			"",
			"摘要会在上下文超限时自动生成并写入 system prompt。",
			"可用 /tokens 查看上下文占用。",
		].join("\n");
	}

	return ["--- 对话摘要 ---", summary, "---"].join("\n");
}

export function printStoredSummary(history: ChatMessage[]): void {
	console.log(`\n${formatStoredSummaryDisplay(getStoredSummary(history))}\n`);
}
