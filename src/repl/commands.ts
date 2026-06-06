import {
	isEnvPromptLocked,
	PRESET_PROMPTS,
	type PresetPromptId,
} from "../prompts";
import type { ChatMessage } from "../schemas/chat";
import {
	formatContextUsage,
	formatContextUsageWithSummary,
	summarizeContextUsage,
} from "./context";
import {
	applyPresetSwitch,
	clearConversation,
	printActivePreset,
	printConversationHistory,
	printPresetCatalog,
} from "./conversation";
import { getStoredSummary, printStoredSummary } from "./summary";

export const COMMAND_PREFIX = "/";

export type ReplCommand = {
	id: string;
	label: string;
	/** 额外别名（不出现在 / 菜单里） */
	aliases?: string[];
};

export type LocalCommandResult = "not-local" | "handled" | "exit";

const META_COMMANDS: ReplCommand[] = [
	{ id: "help", label: "显示帮助" },
	{ id: "clear", label: "清空对话" },
	{ id: "history", label: "查看对话历史" },
	{ id: "tokens", label: "估算上下文 token" },
	{ id: "summary", label: "查看对话摘要" },
	{
		id: "presets",
		label: "列出 preset",
		aliases: ["list", "prompts"],
	},
	{ id: "current", label: "查看当前 preset" },
	{ id: "quit", label: "退出", aliases: ["exit", "q"] },
];

/** / 菜单候选（meta + preset 切换项，不含 quit 别名）。 */
export function getReplCommands(): ReplCommand[] {
	const presets = Object.entries(PRESET_PROMPTS).map(([id, preset]) => ({
		id,
		label: preset.label,
	}));
	return [...META_COMMANDS, ...presets];
}

export function formatCommand(id: string): string {
	return `${COMMAND_PREFIX}${id}`;
}

function parseLocalCommandLine(line: string): string | null {
	const trimmed = line.trim();
	if (trimmed.startsWith(COMMAND_PREFIX)) {
		return trimmed.slice(COMMAND_PREFIX.length);
	}
	return null;
}

function resolveCommandId(raw: string): string | null {
	const cmd = raw.trim().toLowerCase();
	if (!cmd) return null;

	for (const item of getReplCommands()) {
		if (item.id === cmd) return item.id;
		if (item.aliases?.includes(cmd)) return item.id;
	}

	if (cmd in PRESET_PROMPTS) return cmd;
	return null;
}

function printHelp(): void {
	console.log(`
本地命令（不会发送给大模型）：
  /help        显示此帮助
  /clear       清空对话（保留 system prompt）
  /history     查看当前对话历史
  /tokens      估算当前上下文 token / 字符占用
  /summary     查看完整对话摘要（上下文压缩后生成）
  /presets     列出 preset（别名：/list、/prompts）
  /current     查看当前 preset
  /default     通用助手
  /code        编程助教
  /translate   翻译官
  /concise     简洁模式
  /quit        退出（别名：/exit、/q、Ctrl+C）
`);
}

function isPresetId(id: string): id is PresetPromptId {
	return id in PRESET_PROMPTS;
}

/**
 * 解析并执行 / 本地命令。
 */
export function tryHandleLocalCommand(
	line: string,
	history: ChatMessage[],
): LocalCommandResult {
	const raw = parseLocalCommandLine(line);
	if (raw === null) return "not-local";

	const cmd = resolveCommandId(raw);
	if (cmd === null) {
		const unknown = raw.trim().toLowerCase();
		if (unknown === "" || unknown === "?") {
			printHelp();
			return "handled";
		}
		console.log(
			`\n未知命令 ${formatCommand(unknown)}。输入 /help 或 /presets 查看。\n`,
		);
		return "handled";
	}

	if (cmd === "quit") return "exit";

	if (cmd === "help") {
		printHelp();
		return "handled";
	}

	if (cmd === "presets") {
		printPresetCatalog();
		return "handled";
	}

	if (cmd === "current") {
		printActivePreset();
		return "handled";
	}

	if (cmd === "clear") {
		clearConversation(history);
		console.log("\n对话已清空（system prompt 保留）。\n");
		return "handled";
	}

	if (cmd === "history") {
		printConversationHistory(history);
		return "handled";
	}

	if (cmd === "tokens") {
		const usage = summarizeContextUsage(history);
		const summary = getStoredSummary(history);
		const text = summary
			? formatContextUsageWithSummary(usage, summary)
			: formatContextUsage(usage);
		console.log(`\n${text}\n`);
		return "handled";
	}

	if (cmd === "summary") {
		printStoredSummary(history);
		return "handled";
	}

	if (isPresetId(cmd)) {
		if (isEnvPromptLocked()) {
			console.log(
				"\n已在 .env 设置 SYSTEM_PROMPT，运行时 preset 切换被禁用。请删除或注释后重试。\n",
			);
			return "handled";
		}
		applyPresetSwitch(history, cmd);
		console.log(
			`\n已切换为 ${formatCommand(cmd)}（${PRESET_PROMPTS[cmd].label}），对话已清空。\n`,
		);
		return "handled";
	}

	return "handled";
}
