import { createChatAbortControls, LlmCancelledError } from "../llm/chat";
import type { CompactHistoryResult } from "../repl/summary";
import {
	addTokenUsage,
	type ChatMessage,
	type TokenUsage,
	ZERO_TOKEN_USAGE,
} from "../schemas/chat";
import type { ToolRegistry } from "../tools/registry";
import type { ToolExecutionContext } from "../tools/types";
import { printChatDivider } from "./display";
import {
	AgentLoopError,
	type AgentLoopOptions,
	type AgentLoopResult,
	runAgentLoop,
} from "./loop";

export type AgentOptions = {
	history: ChatMessage[];
	toolRegistry: ToolRegistry;
	toolContext?: Omit<ToolExecutionContext, "history" | "confirmedPaths">;
	stream?: boolean;
	onStreamChunk?: (chunk: string) => void | Promise<void>;
	onToolStep?: AgentLoopOptions["onToolStep"];
	onCompact?: (compact: CompactHistoryResult) => void;
	autoSave?: (history: ChatMessage[]) => Promise<void>;
	/** 每轮 chat 结束打印分隔线（参考 printDivider） */
	printDivider?: boolean;
	maxSteps?: number;
	/** 测试注入 */
	compactHistory?: AgentLoopOptions["compactHistory"];
	skipCompact?: boolean;
	chatWithTools?: AgentLoopOptions["chatWithTools"];
	chatStreamWithTools?: AgentLoopOptions["chatStreamWithTools"];
};

/**
 * 会话级 Agent：封装单轮 chat 的生命周期（AbortController、loop、history、autoSave）。
 * 对应参考项目第一章 Agent.chat() / abort()。
 */
export class Agent {
	private readonly options: AgentOptions;
	private abortController: AbortController | null = null;
	private totalUsage: TokenUsage = { ...ZERO_TOKEN_USAGE };
	private readonly confirmedPaths = new Set<string>();

	constructor(options: AgentOptions) {
		this.options = options;
	}

	get history(): ChatMessage[] {
		return this.options.history;
	}

	get totalInputTokens(): number {
		return this.totalUsage.promptTokens;
	}

	get totalOutputTokens(): number {
		return this.totalUsage.completionTokens;
	}

	/** 本会话累计 token 用量（跨多轮 chat）。 */
	get sessionUsage(): TokenUsage {
		return { ...this.totalUsage };
	}

	/** 中断当前 chat()（如 REPL Ctrl+C）。 */
	abort(): void {
		this.abortController?.abort();
	}

	private accumulateUsage(usage: TokenUsage): void {
		this.totalUsage = addTokenUsage(this.totalUsage, usage);
	}

	/**
	 * 处理一条用户消息：推入 history → 跑 agent loop → 写回结果 → autoSave。
	 */
	async chat(userMessage: string): Promise<AgentLoopResult> {
		const history = this.options.history;
		history.push({ role: "user", content: userMessage });

		const { cancel, signal } = createChatAbortControls();
		this.abortController = cancel;

		try {
			const result = await runAgentLoop(history, {
				toolRegistry: this.options.toolRegistry,
				toolContext: {
					...this.options.toolContext,
					confirmedPaths: this.confirmedPaths,
				},
				signal,
				cancelSignal: cancel.signal,
				stream: this.options.stream,
				onStreamChunk: this.options.onStreamChunk,
				onToolStep: this.options.onToolStep,
				maxSteps: this.options.maxSteps,
				compactHistory: this.options.compactHistory,
				skipCompact: this.options.skipCompact,
				chatWithTools: this.options.chatWithTools,
				chatStreamWithTools: this.options.chatStreamWithTools,
			});

			if (result.compact) {
				this.options.onCompact?.(result.compact);
			}

			history.push(...result.messagesAppended);
			this.accumulateUsage(result.usage);
			return result;
		} catch (err) {
			if (err instanceof LlmCancelledError) {
				if (err.partialContent) {
					history.push({
						role: "assistant",
						content: err.partialContent,
					});
				}
				throw err;
			}

			if (err instanceof AgentLoopError) {
				if (err.partial?.usage) {
					this.accumulateUsage(err.partial.usage);
				}
				if (err.partial?.messagesAppended.length) {
					history.push(...err.partial.messagesAppended);
				}
				throw err;
			}

			history.pop();
			throw err;
		} finally {
			this.abortController = null;
			if (this.options.printDivider !== false) {
				printChatDivider();
			}
			await this.options.autoSave?.(history);
		}
	}
}
