import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ToolDefinition } from "../schemas/chat";
import type { RegisteredTool, ToolExecutionContext } from "../tools/types";

type McpTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

type McpCallToolResult = Awaited<ReturnType<Client["callTool"]>>;

/** MCP inputSchema → OpenAI tools 字段。 */
export function mcpToolToDefinition(tool: McpTool): ToolDefinition {
	return {
		type: "function",
		function: {
			name: tool.name,
			description: tool.description ?? tool.title ?? tool.name,
			parameters: tool.inputSchema as Record<string, unknown>,
		},
	};
}

/** MCP callTool 结果 → 模型可读的 JSON 字符串。 */
export function mcpResultToString(result: McpCallToolResult): string {
	if ("toolResult" in result) {
		return JSON.stringify(result.toolResult);
	}

	if (result.isError) {
		return JSON.stringify({
			error: true,
			content: result.content,
			structuredContent: result.structuredContent,
		});
	}

	if (result.structuredContent !== undefined) {
		return JSON.stringify(result.structuredContent);
	}

	const textParts = result.content
		.filter(
			(part): part is { type: "text"; text: string } => part.type === "text",
		)
		.map((part) => part.text);

	if (textParts.length === 1) {
		return textParts[0] ?? JSON.stringify(result);
	}

	return JSON.stringify({
		content: result.content,
		text: textParts.join("\n"),
	});
}

export function createMcpRegisteredTool(
	serverName: string,
	tool: McpTool,
	client: Client,
	llmName: string,
): RegisteredTool {
	return {
		name: llmName,
		definition: {
			type: "function",
			function: {
				name: llmName,
				description: tool.description ?? tool.title ?? tool.name,
				parameters: tool.inputSchema as Record<string, unknown>,
			},
		},
		source: {
			kind: "mcp",
			serverName,
			mcpToolName: tool.name,
		},
		execute: async (args: unknown, _context: ToolExecutionContext) => {
			const result = await client.callTool({
				name: tool.name,
				arguments: (args ?? {}) as Record<string, unknown>,
			});
			return mcpResultToString(result);
		},
	};
}
