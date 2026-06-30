/**
 * 向后兼容门面：新代码请直接用 `src/tools/*` 与 `ToolRegistry`。
 */
import type { ToolDefinition } from "../schemas/chat";
import { getLocalToolRegistry } from "../tools/factory";
import {
	CALCULATE_TOOL,
	createLocalToolRegistry,
	evaluateMathExpression,
	formatLocalIso8601,
	GET_CONTEXT_USAGE_TOOL,
	GET_CURRENT_TIME_TOOL,
	TOOL_DEFINITIONS,
} from "../tools/local";
import { toolMessageFromResult } from "../tools/registry";
import type { ToolExecutionContext, ToolExecutor } from "../tools/types";

export type { ToolExecutionContext, ToolExecutor };
export {
	CALCULATE_TOOL,
	evaluateMathExpression,
	formatLocalIso8601,
	GET_CONTEXT_USAGE_TOOL,
	GET_CURRENT_TIME_TOOL,
	TOOL_DEFINITIONS,
	toolMessageFromResult,
};

export function getToolDefinitions(): ToolDefinition[] {
	return getLocalToolRegistry().getDefinitions();
}

export async function executeTool(
	name: string,
	argsJson: string,
	context: ToolExecutionContext = {},
): Promise<string> {
	return getLocalToolRegistry().execute(name, argsJson, context);
}

export { createLocalToolRegistry };
