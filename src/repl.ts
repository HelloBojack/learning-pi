import { Agent } from "./agent/agent";
import { formatTokenUsageLine, formatToolStepLog } from "./agent/display";
import { AgentLoopError } from "./agent/loop";
import { LlmApiError, LlmCancelledError, LlmNetworkError } from "./llm/chat";
import { writeChunkToStdout } from "./llm/stdout";
import { getPermissionModeFromEnv } from "./permissions/policy";
import { withSystemPrompt } from "./prompts";
import { tryHandleLocalCommand } from "./repl/commands";
import { createInitialHistory } from "./repl/conversation";
import { createSuggestingInterface, ReplInterrupt } from "./repl/input";
import {
	countConversationTurns,
	loadLatestSession,
	saveLatestSession,
} from "./repl/session";
import { compactHistoryIfNeeded, printCompactNotices } from "./repl/summary";
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
		printCompactNotices(compact);
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

	let prefixWritten = false;
	const agent = new Agent({
		history,
		toolRegistry,
		autoSave: saveLatestSession,
		onCompact: printCompactNotices,
		toolContext: {
			permissionMode: getPermissionModeFromEnv(),
			confirm: async (message) => {
				const answer = (await rl.question(message)).trim().toLowerCase();
				return answer === "y" || answer === "yes";
			},
		},
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

			prefixWritten = false;
			const stopInterruptWatch = rl.onStreamInterrupt(() => agent.abort());

			try {
				const result = await agent.chat(line);

				if (result.cancelled) {
					console.log("\n[已中断]");
					console.log();
					continue;
				}

				if (!result.streamed) {
					console.log(`assistant> ${result.finalText}`);
				}
				console.log(`\n${formatTokenUsageLine(result.usage)}`);
				console.log(`${formatTokenUsageLine(agent.sessionUsage, "session")}\n`);
			} catch (err) {
				if (err instanceof LlmCancelledError) {
					console.log("\n[已中断]");
					console.log();
					continue;
				}

				if (err instanceof AgentLoopError) {
					console.error(`\n[Agent] ${err.message}`);
				} else if (err instanceof LlmNetworkError) {
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
		const history = withSystemPrompt([]);
		const agent = new Agent({
			history,
			toolRegistry,
			stream: true,
			printDivider: false,
			onStreamChunk: writeChunkToStdout,
			onToolStep: (step) => {
				console.log(formatToolStepLog(step));
			},
		});

		const result = await agent.chat(prompt);
		if (!result.streamed) {
			console.log(result.finalText);
		}
		console.log(formatTokenUsageLine(result.usage));
		console.log();
	});
}
