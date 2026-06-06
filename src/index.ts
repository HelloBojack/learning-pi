import { runOnce, runRepl } from "./repl";

export type { ChatOptions } from "./llm/chat";
export {
	chat,
	chatStream,
	chatStreamToStdout,
	LlmApiError,
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
export type { ChatMessage, ChatRole } from "./schemas/chat";

if (import.meta.main) {
	const oneShot = process.argv.slice(2).join(" ").trim();
	if (oneShot) {
		await runOnce(oneShot);
	} else {
		await runRepl();
	}
}
