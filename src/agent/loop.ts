import {
	type ChatWithToolsOptions,
	type ChatWithToolsResult,
	chatStreamWithTools as defaultChatStreamWithTools,
	chatWithTools as defaultChatWithTools,
} from "../llm/chat";
import type { ChatMessage } from "../schemas/chat";
import {
	executeTool,
	getToolDefinitions,
	toolMessageFromResult,
} from "./tools";

export type AgentLoopPartialResult = {
	messagesAppended: ChatMessage[];
	steps: AgentToolStep[];
	streamed: boolean;
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
};

export type AgentLoopOptions = ChatWithToolsOptions & {
	maxSteps?: number;
	onToolStep?: (step: AgentToolStep) => void;
	stream?: boolean;
	onStreamChunk?: (chunk: string) => void | Promise<void>;
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

async function invokeLlm(
	working: ChatMessage[],
	options: AgentLoopOptions,
	tools: ReturnType<typeof getToolDefinitions>,
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
 * Agent loop：LLM 返回 tool_calls 时执行工具、写回 history，直到给出最终文字。
 * 不修改传入的 history，由调用方 append messagesAppended。
 */
export async function runAgentLoop(
	history: ChatMessage[],
	options: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
	const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
	const tools = options.tools ?? getToolDefinitions();
	const working = [...history];
	const messagesAppended: ChatMessage[] = [];
	const steps: AgentToolStep[] = [];
	let streamed = false;

	for (let step = 0; step < maxSteps; step++) {
		const { response, streamed: stepStreamed } = await invokeLlm(
			working,
			options,
			tools,
		);

		if (response.toolCalls.length === 0) {
			streamed ||= stepStreamed;
			messagesAppended.push(response.message);
			return {
				finalText: response.content,
				steps,
				messagesAppended,
				stepsTaken: step + 1,
				streamed,
			};
		}

		messagesAppended.push(response.message);
		working.push(response.message);

		for (const call of response.toolCalls) {
			const args = parseToolCallArgs(call.function.arguments);
			const result = await executeTool(
				call.function.name,
				call.function.arguments,
				{ history: working },
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
	});
}
