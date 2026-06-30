import { runOnce, runRepl } from "./repl";

export { formatToolStepLog, printAgentToolSteps } from "./agent/display";
export type {
	AgentLoopOptions,
	AgentLoopPartialResult,
	AgentLoopResult,
	AgentToolStep,
} from "./agent/loop";
export { AgentLoopError, runAgentLoop } from "./agent/loop";
export {
	CALCULATE_TOOL,
	executeTool,
	GET_CONTEXT_USAGE_TOOL,
	GET_CURRENT_TIME_TOOL,
	getToolDefinitions,
} from "./agent/tools";
export type {
	ChatOptions,
	ChatWithToolsOptions,
	ChatWithToolsResult,
} from "./llm/chat";
export {
	chat,
	chatStream,
	chatStreamToStdout,
	chatStreamWithTools,
	chatWithTools,
	createChatAbortControls,
	LlmApiError,
	LlmCancelledError,
	LlmNetworkError,
} from "./llm/chat";
export type { PresetPromptId } from "./prompts";
export {
	getActivePresetId,
	getSystemPrompt,
	PRESET_PROMPTS,
	withSystemPrompt,
} from "./prompts";
export { runOnce, runRepl } from "./repl";
export type {
	ChatMessage,
	ChatRole,
	ToolCall,
	ToolDefinition,
} from "./schemas/chat";

if (import.meta.main) {
	const oneShot = process.argv.slice(2).join(" ").trim();
	if (oneShot) {
		await runOnce(oneShot);
	} else {
		await runRepl();
	}
}
