import { runOnce, runRepl } from "./repl";

export { chat, LlmApiError } from "./llm/chat";
export type { ChatMessage, ChatRole } from "./schemas/chat";
export type { ChatOptions } from "./llm/chat";
export { runRepl, runOnce } from "./repl";

if (import.meta.main) {
  const oneShot = process.argv.slice(2).join(" ").trim();
  if (oneShot) {
    await runOnce(oneShot);
  } else {
    await runRepl();
  }
}
