import { z } from "zod";

export const ChatRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const ToolCallSchema = z.object({
	id: z.string(),
	type: z.literal("function"),
	function: z.object({
		name: z.string(),
		arguments: z.string(),
	}),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ChatMessageSchema = z
	.object({
		role: ChatRoleSchema,
		content: z.string().nullable().optional(),
		tool_calls: z.array(ToolCallSchema).optional(),
		tool_call_id: z.string().optional(),
		name: z.string().optional(),
	})
	.transform((msg) => ({
		...msg,
		content: msg.content ?? "",
	}));
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ToolDefinitionSchema = z.object({
	type: z.literal("function"),
	function: z.object({
		name: z.string(),
		description: z.string(),
		parameters: z.record(z.string(), z.unknown()),
	}),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ChatRequestSchema = z.object({
	model: z.string(),
	messages: z.array(ChatMessageSchema).min(1),
	temperature: z.number().min(0).max(2).optional(),
	stream: z.boolean().optional(),
	tools: z.array(ToolDefinitionSchema).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

const ChatChoiceMessageSchema = z.object({
	role: z.string(),
	content: z.string().nullable(),
	tool_calls: z.array(ToolCallSchema).optional(),
});

const ChatChoiceSchema = z.object({
	message: ChatChoiceMessageSchema,
	finish_reason: z.string().nullable().optional(),
});

/** OpenAI 兼容 usage 字段（部分网关会在流式最后一帧返回）。 */
export const ChatUsageSchema = z.object({
	prompt_tokens: z.number().nonnegative().optional(),
	completion_tokens: z.number().nonnegative().optional(),
	total_tokens: z.number().nonnegative().optional(),
});
export type ChatUsage = z.infer<typeof ChatUsageSchema>;

export type TokenUsage = {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
};

export const ZERO_TOKEN_USAGE: TokenUsage = {
	promptTokens: 0,
	completionTokens: 0,
	totalTokens: 0,
};

export function tokenUsageFromApi(
	usage: ChatUsage | null | undefined,
): TokenUsage | null {
	if (!usage) return null;
	const promptTokens = usage.prompt_tokens ?? 0;
	const completionTokens = usage.completion_tokens ?? 0;
	const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
	if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
		return null;
	}
	return { promptTokens, completionTokens, totalTokens };
}

export function addTokenUsage(
	accumulated: TokenUsage,
	increment: TokenUsage | null | undefined,
): TokenUsage {
	if (!increment) return accumulated;
	return {
		promptTokens: accumulated.promptTokens + increment.promptTokens,
		completionTokens: accumulated.completionTokens + increment.completionTokens,
		totalTokens: accumulated.totalTokens + increment.totalTokens,
	};
}

export const ChatResponseSchema = z.object({
	id: z.string().optional(),
	choices: z.array(ChatChoiceSchema).min(1),
	usage: ChatUsageSchema.optional(),
	error: z
		.object({
			message: z.string(),
			type: z.string().optional(),
			code: z.string().optional(),
		})
		.optional(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

const StreamToolCallDeltaSchema = z.object({
	index: z.number().optional(),
	id: z.string().optional(),
	type: z.literal("function").optional(),
	function: z
		.object({
			name: z.string().optional(),
			arguments: z.string().optional(),
		})
		.optional(),
});

/** OpenAI SSE chunk: choices[].delta.content / tool_calls */
export const StreamChunkSchema = z.object({
	choices: z
		.array(
			z.object({
				delta: z
					.object({
						content: z.string().optional(),
						tool_calls: z.array(StreamToolCallDeltaSchema).optional(),
					})
					.optional(),
				finish_reason: z.string().nullable().optional(),
			}),
		)
		.optional(),
	usage: ChatUsageSchema.optional(),
	error: z
		.object({
			message: z.string(),
			type: z.string().optional(),
			code: z.string().optional(),
		})
		.optional(),
});
export type StreamChunk = z.infer<typeof StreamChunkSchema>;

/** 将 API 响应中的 assistant message 规范化为 ChatMessage。 */
export function assistantMessageFromResponse(
	message: z.infer<typeof ChatChoiceMessageSchema>,
): ChatMessage {
	return ChatMessageSchema.parse({
		role: "assistant",
		content: message.content,
		tool_calls: message.tool_calls,
	});
}
