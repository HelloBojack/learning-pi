import { formatToolStepLog } from "./agent/display";
import { AgentLoopError, runAgentLoop } from "./agent/loop";
import {
	createChatAbortControls,
	LlmApiError,
	LlmCancelledError,
	LlmNetworkError,
} from "./llm/chat";
import { writeChunkToStdout } from "./llm/stdout";
import { withSystemPrompt } from "./prompts";
import { tryHandleLocalCommand } from "./repl/commands";
import { formatTrimNotice } from "./repl/context";
import { createInitialHistory } from "./repl/conversation";
import { createSuggestingInterface, ReplInterrupt } from "./repl/input";
import {
	countConversationTurns,
	loadLatestSession,
	saveLatestSession,
} from "./repl/session";
import { compactHistoryIfNeeded, formatCompactNotice } from "./repl/summary";
import type { ChatMessage } from "./schemas/chat";
import { createToolRegistry, formatToolRegistrySummary } from "./tools/factory";
import type { ToolRegistry } from "./tools/registry";

async function withToolRegistry<T>(
	fn: (registry: ToolRegistry) => Promise<T>,
): Promise<T> {
	const init = await createToolRegistry();
	try {
		return await fn(init.registry);
	} finally {
		await init.registry.close();
	}
}

export async function runRepl(): Promise<void> {
	const toolInit = await createToolRegistry();
	const toolRegistry = toolInit.registry;

	const rl = createSuggestingInterface();
	const restored = await loadLatestSession();
	const history: ChatMessage[] = restored ?? createInitialHistory();
	const restoredTurnCount = restored ? countConversationTurns(history) : 0;

	if (restored) {
		const compact = await compactHistoryIfNeeded(history);
		if (compact.summarized) {
			console.log(formatCompactNotice(compact));
		}
		if (compact.trimmed && compact.trimmed.trimmedCount > 0) {
			console.log(formatTrimNotice(compact.trimmed));
		}
	}

	console.log("learning-pi 对话已启动（流式输出，支持工具调用）");
	console.log(`工具：${formatToolRegistrySummary(toolInit)}`);
	if (restored) {
		console.log(`已恢复上次对话（${restoredTurnCount} 条消息）`);
	}
	console.log(
		"输入 / 呼出命令菜单（↑↓ 选择），/help 查看全部，/quit 退出\n" +
			"输出过程中 Ctrl+C 中断当前回复；支持本地工具与 MCP 远程工具\n",
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

			const compact = await compactHistoryIfNeeded(history);
			if (compact.summarized) {
				console.log(`\n${formatCompactNotice(compact)}\n`);
			}
			if (compact.trimmed && compact.trimmed.trimmedCount > 0) {
				console.log(`\n${formatTrimNotice(compact.trimmed)}\n`);
			}

			const { cancel, signal } = createChatAbortControls();
			const stopInterruptWatch = rl.onStreamInterrupt(() => cancel.abort());

			try {
				let prefixWritten = false;
				const result = await runAgentLoop(history, {
					toolRegistry,
					signal,
					cancelSignal: cancel.signal,
					stream: true,
					onStreamChunk: async (chunk) => {
						if (!prefixWritten) {
							process.stdout.write("assistant> ");
							prefixWritten = true;
						}
						await writeChunkToStdout(chunk);
					},
					onToolStep: (step) => {
						console.log(`\n${formatToolStepLog(step)}\n`);
					},
				});
				if (!result.streamed) {
					console.log(`assistant> ${result.finalText}`);
				}
				console.log("\n");
				history.push(...result.messagesAppended);
			} catch (err) {
				if (err instanceof LlmCancelledError) {
					console.log("\n[已中断]");
					if (err.partialContent) {
						history.push({
							role: "assistant",
							content: err.partialContent,
						});
					}
					console.log();
					continue;
				}

				if (err instanceof AgentLoopError) {
					if (err.partial?.messagesAppended.length) {
						history.push(...err.partial.messagesAppended);
					}
					console.error(`\n[Agent] ${err.message}`);
				} else {
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
				}
				console.log();
			} finally {
				stopInterruptWatch();
			}
		}
	} finally {
		rl.close();
		await saveLatestSession(history);
		await toolRegistry.close();
	}
}

export async function runOnce(prompt: string): Promise<void> {
	await withToolRegistry(async (toolRegistry) => {
		const history = withSystemPrompt([{ role: "user", content: prompt }]);
		const result = await runAgentLoop(history, {
			toolRegistry,
			stream: true,
			onStreamChunk: writeChunkToStdout,
			onToolStep: (step) => {
				console.log(formatToolStepLog(step));
			},
		});
		if (!result.streamed) {
			console.log(result.finalText);
		}
		console.log();
	});
}
