import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpRegisteredTool } from "../mcp/adapter";
import {
	evaluatePermission,
	getPermissionModeFromEnv,
	permissionDeniedMessage,
} from "../permissions/policy";
import type { ToolDefinition } from "../schemas/chat";
import type {
	LocalToolSpec,
	RegisteredTool,
	ToolExecutionContext,
} from "./types";

type McpConnection = {
	serverName: string;
	client: Client;
	close: () => Promise<void>;
};

function localToolToRegistered(spec: LocalToolSpec): RegisteredTool {
	return {
		name: spec.name,
		definition: {
			type: "function",
			function: {
				name: spec.name,
				description: spec.description,
				parameters: spec.parameters,
			},
		},
		source: { kind: "local" },
		execute: spec.execute,
	};
}

function parseToolArguments(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/** 统一工具注册表：本地工具 + MCP 远程工具。 */
export class ToolRegistry {
	private readonly tools = new Map<string, RegisteredTool>();
	private readonly mcpConnections: McpConnection[] = [];

	registerLocal(spec: LocalToolSpec): void {
		this.register(localToolToRegistered(spec));
	}

	register(tool: RegisteredTool): void {
		if (this.tools.has(tool.name)) {
			throw new Error(`tool already registered: ${tool.name}`);
		}
		this.tools.set(tool.name, tool);
	}

	/** 从已连接的 MCP 客户端发现并注册工具。 */
	async registerMcpServer(serverName: string, client: Client): Promise<number> {
		const { tools } = await client.listTools();
		const usedNames = new Set(this.tools.keys());
		let registered = 0;

		for (const tool of tools) {
			let llmName = tool.name;
			if (usedNames.has(llmName)) {
				llmName = `${serverName}__${tool.name}`;
			}
			if (usedNames.has(llmName)) {
				throw new Error(
					`MCP tool name collision: ${serverName}/${tool.name} → ${llmName}`,
				);
			}

			const entry = createMcpRegisteredTool(serverName, tool, client, llmName);
			this.register(entry);
			usedNames.add(llmName);
			registered += 1;
		}

		return registered;
	}

	trackMcpConnection(
		serverName: string,
		client: Client,
		close: () => Promise<void>,
	): void {
		this.mcpConnections.push({ serverName, client, close });
	}

	getDefinitions(): ToolDefinition[] {
		return [...this.tools.values()].map((tool) => tool.definition);
	}

	list(): RegisteredTool[] {
		return [...this.tools.values()];
	}

	listBySource(): { local: RegisteredTool[]; mcp: RegisteredTool[] } {
		const local: RegisteredTool[] = [];
		const mcp: RegisteredTool[] = [];
		for (const tool of this.tools.values()) {
			if (tool.source.kind === "local") {
				local.push(tool);
			} else {
				mcp.push(tool);
			}
		}
		return { local, mcp };
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}

	async execute(
		name: string,
		argsJson: string,
		context: ToolExecutionContext = {},
	): Promise<string> {
		const tool = this.tools.get(name);
		if (!tool) {
			return JSON.stringify({ error: `unknown tool: ${name}` });
		}

		const args = parseToolArguments(argsJson);
		if (args === null) {
			return JSON.stringify({
				error: "invalid tool arguments JSON",
				raw: argsJson,
			});
		}

		const permissionMode = context.permissionMode ?? getPermissionModeFromEnv();
		const permission = evaluatePermission(name, args, permissionMode);

		if (permission === "deny") {
			const reason =
				name === "run_terminal_cmd"
					? permissionMode === "dont-ask"
						? "shell commands disabled in dont-ask mode"
						: "command blocked by safety policy"
					: "not allowed";
			return permissionDeniedMessage(name, reason);
		}

		if (permission === "ask") {
			const confirm = context.confirm;
			if (!confirm) {
				return permissionDeniedMessage(
					name,
					"confirmation required (non-interactive session)",
				);
			}
			const command =
				typeof args === "object" &&
				args !== null &&
				"command" in args &&
				typeof (args as { command: unknown }).command === "string"
					? (args as { command: string }).command.trim()
					: "";
			const approved = await confirm(
				`Allow run_terminal_cmd?\n  $ ${command}\n[y/N] `,
			);
			if (!approved) {
				return permissionDeniedMessage(name, "user denied");
			}
		}

		try {
			return await tool.execute(args, context);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "tool execution failed";
			return JSON.stringify({ error: message });
		}
	}

	async close(): Promise<void> {
		await Promise.allSettled(
			this.mcpConnections.map((connection) => connection.close()),
		);
		this.mcpConnections.length = 0;
	}
}

export function defineLocalTool(spec: LocalToolSpec): LocalToolSpec {
	return spec;
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
