import { describe, expect, test } from "bun:test";
import {
	assistantMessageFromResponse,
	ChatMessageSchema,
	ChatRequestSchema,
	ChatResponseSchema,
	ToolDefinitionSchema,
} from "./chat";

describe("tool calling schemas", () => {
	test("ChatMessageSchema accepts legacy user/assistant messages", () => {
		const msg = ChatMessageSchema.parse({
			role: "user",
			content: "hello",
		});
		expect(msg.content).toBe("hello");
	});

	test("ChatMessageSchema accepts assistant message with tool_calls", () => {
		const msg = ChatMessageSchema.parse({
			role: "assistant",
			content: "",
			tool_calls: [
				{
					id: "call_1",
					type: "function",
					function: {
						name: "get_current_time",
						arguments: "{}",
					},
				},
			],
		});

		expect(msg.content).toBe("");
		expect(msg.tool_calls?.[0]?.function.name).toBe("get_current_time");
	});

	test("ChatMessageSchema accepts tool result message", () => {
		const msg = ChatMessageSchema.parse({
			role: "tool",
			tool_call_id: "call_1",
			content: '{"iso":"2026-06-05T12:00:00.000Z"}',
		});

		expect(msg.role).toBe("tool");
		expect(msg.tool_call_id).toBe("call_1");
	});

	test("ChatRequestSchema accepts tools array", () => {
		const req = ChatRequestSchema.parse({
			model: "gpt-test",
			messages: [{ role: "user", content: "hi" }],
			tools: [
				{
					type: "function",
					function: {
						name: "get_current_time",
						description: "Get current time",
						parameters: { type: "object", properties: {} },
					},
				},
			],
		});

		expect(req.tools).toHaveLength(1);
		expect(ToolDefinitionSchema.parse(req.tools?.[0]).function.name).toBe(
			"get_current_time",
		);
	});

	test("ChatResponseSchema parses tool_calls finish response", () => {
		const raw = {
			id: "chatcmpl-test",
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_abc",
								type: "function",
								function: {
									name: "get_current_time",
									arguments: "{}",
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		};

		const parsed = ChatResponseSchema.parse(raw);
		expect(parsed.choices[0]?.finish_reason).toBe("tool_calls");
		expect(parsed.choices[0]?.message.tool_calls).toHaveLength(1);
	});

	test("assistantMessageFromResponse normalizes nullable content", () => {
		const message = assistantMessageFromResponse({
			role: "assistant",
			content: null,
			tool_calls: [
				{
					id: "call_1",
					type: "function",
					function: { name: "demo", arguments: "{}" },
				},
			],
		});

		expect(message.content).toBe("");
		expect(message.tool_calls).toHaveLength(1);
	});
});
