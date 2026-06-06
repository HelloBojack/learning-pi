import { chatStreamToStdout, LlmApiError, LlmNetworkError } from "./llm/chat";
import { withSystemPrompt } from "./prompts";
import { tryHandleLocalCommand } from "./repl/commands";
import { createInitialHistory } from "./repl/conversation";
import { createSuggestingInterface, ReplInterrupt } from "./repl/input";
import {
	countConversationTurns,
	loadLatestSession,
	saveLatestSession,
} from "./repl/session";
import type { ChatMessage } from "./schemas/chat";

export async function runRepl(): Promise<void> {
	const rl = createSuggestingInterface();
	const restored = await loadLatestSession();
	const history: ChatMessage[] = restored ?? createInitialHistory();

	console.log("learning-pi 对话已启动（流式输出）");
	if (restored) {
		const turns = countConversationTurns(restored);
		console.log(`已恢复上次对话（${turns} 条消息）`);
	}
	console.log(
		"输入 / 呼出命令菜单（↑↓ 选择），/help 查看全部，/quit 或 Ctrl+C 退出\n",
	);

	try {
		while (true) {
			let line: string;
			try {
				line = (await rl.question("you> ")).trim();
			} catch (err) {
				if (err instanceof ReplInterrupt) {
					console.log("再见。\n");
					break;
				}
				throw err;
			}
			if (!line) continue;

			const local = tryHandleLocalCommand(line, history);
			if (local === "exit") {
				console.log("再见。\n");
				break;
			}
			if (local === "handled") continue;

			history.push({ role: "user", content: line });

			try {
				const reply = await chatStreamToStdout(
					history,
					{},
					{
						prefix: "assistant> ",
					},
				);
				console.log("\n");
				history.push({ role: "assistant", content: reply });
			} catch (err) {
				history.pop();
				if (err instanceof LlmNetworkError) {
					console.error(`\n[网络错误] ${err.message}`);
				} else if (err instanceof LlmApiError) {
					const tag = err.isClientError() ? "客户端错误" : "服务端错误";
					console.error(`\n[${tag} ${err.status}] ${err.message}`);
					if (err.body) console.error(err.body);
				} else if (err instanceof Error) {
					console.error(`\n[错误] ${err.message}`);
				} else {
					console.error("\n[错误] 未知错误");
				}
				console.log();
			}
		}
	} finally {
		rl.close();
		await saveLatestSession(history);
	}
}

export async function runOnce(prompt: string): Promise<void> {
	await chatStreamToStdout(
		withSystemPrompt([{ role: "user", content: prompt }]),
	);
	console.log();
}
