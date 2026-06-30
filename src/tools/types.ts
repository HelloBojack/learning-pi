import type { PermissionMode } from "../permissions/types";
import type { ChatMessage, ToolDefinition } from "../schemas/chat";

export type ToolExecutionContext = {
	history?: ChatMessage[];
	permissionMode?: PermissionMode;
	/** default 模式下 run_terminal_cmd 需用户确认时调用 */
	confirm?: (message: string) => Promise<boolean>;
};

export type ToolExecutor = (
	args: unknown,
	context: ToolExecutionContext,
) => Promise<string>;

export type ToolSource =
	| { kind: "local" }
	| { kind: "mcp"; serverName: string; mcpToolName: string };

/** MCP 风格：schema 与 execute 合一，避免双表维护。 */
export type LocalToolSpec = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute: ToolExecutor;
};

export type RegisteredTool = {
	name: string;
	definition: ToolDefinition;
	source: ToolSource;
	execute: ToolExecutor;
};
