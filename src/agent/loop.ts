import {
	type ChatWithToolsOptions,
	type ChatWithToolsResult,
	chatStreamWithTools as defaultChatStreamWithTools,
	chatWithTools as defaultChatWithTools,
} from "../llm/chat";
import { gateToolExecution } from "../permissions/policy";
import {
	type CompactHistoryResult,
	compactHistoryIfNeeded,
} from "../repl/summary";
import type { ChatMessage } from "../schemas/chat";
import {
	addTokenUsage,
	type TokenUsage,
	ZERO_TOKEN_USAGE,
} from "../schemas/chat";
import { getLocalToolRegistry } from "../tools/factory";
import type { ToolRegistry } from "../tools/registry";
import { toolMessageFromResult } from "../tools/registry";
import type { ToolExecutionContext } from "../tools/types";
import { withCodingToolHints } from "./tool-hints";

export type AgentLoopPartialResult = {
	messagesAppended: ChatMessage[];
	steps: AgentToolStep[];
	streamed: boolean;
	usage: TokenUsage;
};

export class AgentLoopError extends Error {
	readonly partial?: AgentLoopPartialResult;

	constructor(message: string, partial?: AgentLoopPartialResult) {
		super(message);
		this.name = "AgentLoopError";
		this.partial = partial;
	}
}

export type AgentToolStep = {
	kind: "tool_call";
	name: string;
	args: unknown;
	result: string;
};

export type AgentLoopResult = {
	finalText: string;
	steps: AgentToolStep[];
	messagesAppended: ChatMessage[];
	stepsTaken: number;
	/** 最终回复是否已通过 onStreamChunk 流式输出 */
	streamed: boolean;
	/** 用户中断（Ctrl+C）时提前结束 */
	cancelled?: boolean;
	/** 本轮累计 token 用量 */
	usage: TokenUsage;
	/** turn boundary 上下文压缩结果（在 loop 入口执行） */
	compact: CompactHistoryResult | null;
};

export type AgentLoopOptions = ChatWithToolsOptions & {
	maxSteps?: number;
	onToolStep?: (step: AgentToolStep) => void;
	stream?: boolean;
	onStreamChunk?: (chunk: string) => void | Promise<void>;
	toolRegistry?: ToolRegistry;
	toolContext?: Omit<ToolExecutionContext, "history">;
	/** 测试注入；默认在 loop 入口调用 compactHistoryIfNeeded */
	compactHistory?: (history: ChatMessage[]) => Promise<CompactHistoryResult>;
	skipCompact?: boolean;
	chatWithTools?: (
		messages: ChatMessage[],
		options: ChatWithToolsOptions,
	) => Promise<ChatWithToolsResult>;
	chatStreamWithTools?: (
		messages: ChatMessage[],
		options: ChatWithToolsOptions,
	) => AsyncGenerator<string, ChatWithToolsResult>;
};

const DEFAULT_MAX_STEPS = 8;

function parseToolCallArgs(argsJson: string): unknown {
	try {
		return JSON.parse(argsJson);
	} catch {
		return argsJson;
	}
}

function isLoopAborted(options: AgentLoopOptions): boolean {
	return options.cancelSignal?.aborted === true;
}

function buildLoopResult(
	partial: {
		finalText: string;
		steps: AgentToolStep[];
		messagesAppended: ChatMessage[];
		stepsTaken: number;
		streamed: boolean;
		usage: TokenUsage;
		compact: CompactHistoryResult | null;
	},
	cancelled = false,
): AgentLoopResult {
	return { ...partial, cancelled };
}

async function executeToolInLoop(
	registry: ToolRegistry,
	toolName: string,
	argsJson: string,
	args: unknown,
	toolContext: Omit<ToolExecutionContext, "history"> | undefined,
	working: ChatMessage[],
): Promise<string> {
	const context: ToolExecutionContext = { history: working, ...toolContext };
	const gate = await gateToolExecution(toolName, args, context);
	if (!gate.allowed) {
		return gate.result;
	}
	return registry.invoke(toolName, argsJson, context);
}

async function invokeLlm(
	working: ChatMessage[],
	options: AgentLoopOptions,
	tools: ReturnType<ToolRegistry["getDefinitions"]>,
): Promise<{ response: ChatWithToolsResult; streamed: boolean }> {
	const llmOptions = { ...options, tools };

	if (options.stream) {
		const streamFn = options.chatStreamWithTools ?? defaultChatStreamWithTools;
		const gen = streamFn(working, llmOptions);
		let streamed = false;

		while (true) {
			const { value, done } = await gen.next();
			if (done) {
				return { response: value, streamed };
			}
			if (options.onStreamChunk) {
				await options.onStreamChunk(value);
				streamed = true;
			}
		}
	}

	const chatFn = options.chatWithTools ?? defaultChatWithTools;
	const response = await chatFn(working, llmOptions);
	return { response, streamed: false };
}

/**
 * Agent loop：turn boundary 压缩 → LLM → 工具 → 写回 history，直到给出最终文字。
 * 不修改传入 history 中 loop 前的消息；压缩与 messagesAppended 由调用方同步。
 */
export async function runAgentLoop(
	history: ChatMessage[],
	options: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
	const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
	const registry = options.toolRegistry ?? getLocalToolRegistry();
	const tools = options.tools ?? registry.getDefinitions();

	const compact = options.skipCompact
		? null
		: await (options.compactHistory ?? compactHistoryIfNeeded)(history);

	const working = [...history];
	const messagesAppended: ChatMessage[] = [];
	const steps: AgentToolStep[] = [];
	let streamed = false;
	let usage = ZERO_TOKEN_USAGE;
	let finalText = "";

	for (let step = 0; step < maxSteps; step++) {
		if (isLoopAborted(options)) {
			return buildLoopResult(
				{
					finalText,
					steps,
					messagesAppended,
					stepsTaken: step,
					streamed,
					usage,
					compact,
				},
				true,
			);
		}

		const llmMessages = withCodingToolHints(working, tools);
		const { response, streamed: stepStreamed } = await invokeLlm(
			llmMessages,
			options,
			tools,
		);

		usage = addTokenUsage(usage, response.usage);
		streamed ||= stepStreamed;

		if (response.toolCalls.length === 0) {
			finalText = response.content;
			messagesAppended.push(response.message);
			return buildLoopResult({
				finalText,
				steps,
				messagesAppended,
				stepsTaken: step + 1,
				streamed,
				usage,
				compact,
			});
		}

		messagesAppended.push(response.message);
		working.push(response.message);

		for (const call of response.toolCalls) {
			if (isLoopAborted(options)) {
				return buildLoopResult(
					{
						finalText,
						steps,
						messagesAppended,
						stepsTaken: step + 1,
						streamed,
						usage,
						compact,
					},
					true,
				);
			}

			const args = parseToolCallArgs(call.function.arguments);
			const result = await executeToolInLoop(
				registry,
				call.function.name,
				call.function.arguments,
				args,
				options.toolContext,
				working,
			);

			const toolStep: AgentToolStep = {
				kind: "tool_call",
				name: call.function.name,
				args,
				result,
			};
			steps.push(toolStep);
			options.onToolStep?.(toolStep);

			const toolMsg = toolMessageFromResult(
				call.id,
				result,
				call.function.name,
			);
			messagesAppended.push(toolMsg);
			working.push(toolMsg);
		}
	}

	throw new AgentLoopError(`Agent loop exceeded max steps (${maxSteps})`, {
		messagesAppended,
		steps,
		streamed,
		usage,
	});
}
