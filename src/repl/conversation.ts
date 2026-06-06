import { loadEnv } from "../env";
import {
	getActivePresetId,
	isEnvPromptLocked,
	PRESET_PROMPTS,
	switchActivePreset,
	systemMessageForPreset,
} from "../prompts";
import type { ChatMessage, ChatRole } from "../schemas/chat";

const ROLE_LABEL: Record<ChatRole, string> = {
	system: "system",
	user: "you",
	assistant: "assistant",
};

function formatContent(content: string, maxLen: number): string {
	const oneLine = content.replace(/\s+/g, " ").trim();
	if (oneLine.length <= maxLen) return oneLine;
	return `${oneLine.slice(0, maxLen)}…`;
}

/** 供 REPL 初始化。若 .env 有 SYSTEM_PROMPT 则优先使用。 */
export function createInitialHistory(): ChatMessage[] {
	const fromEnv = loadEnv().SYSTEM_PROMPT?.trim();
	if (fromEnv) {
		return [{ role: "system", content: fromEnv }];
	}
	return [systemMessageForPreset(getActivePresetId())];
}

/** 清空 user/assistant 消息，保留当前 system prompt。 */
export function clearConversation(history: ChatMessage[]): void {
	history.length = 0;
	history.push(...createInitialHistory());
}

export function printConversationHistory(history: ChatMessage[]): void {
	const turns = history.filter((m) => m.role !== "system");
	if (turns.length === 0) {
		console.log("\n（暂无 user/assistant 消息）\n");
		return;
	}

	console.log("\n--- 对话历史 ---");
	let turn = 0;
	for (const msg of history) {
		if (msg.role === "system") {
			console.log(`[system] ${formatContent(msg.content, 80)}`);
			continue;
		}
		turn += 1;
		console.log(
			`[${turn}] ${ROLE_LABEL[msg.role]}> ${formatContent(msg.content, 200)}`,
		);
	}
	console.log(`共 ${turn} 条消息\n`);
}

export function applyPresetSwitch(
	history: ChatMessage[],
	id: Parameters<typeof switchActivePreset>[0],
): void {
	history.length = 0;
	history.push(...switchActivePreset(id));
}

export function printActivePreset(): void {
	if (isEnvPromptLocked()) {
		const fromEnv = loadEnv().SYSTEM_PROMPT?.trim() ?? "";
		console.log("\n当前：.env SYSTEM_PROMPT（固定，重启后生效）");
		console.log(
			`内容预览：${fromEnv.slice(0, 80)}${fromEnv.length > 80 ? "…" : ""}\n`,
		);
		return;
	}
	const id = getActivePresetId();
	const preset = PRESET_PROMPTS[id];
	console.log(`\n当前：/${id}（${preset.label}）`);
	console.log(`内容预览：${preset.content.slice(0, 80)}…\n`);
}

export function printPresetCatalog(): void {
	console.log("\n可用 preset（/名称 切换，会清空当前对话）：");
	for (const [id, preset] of Object.entries(PRESET_PROMPTS)) {
		const mark = id === getActivePresetId() ? " *" : "";
		console.log(`  /${id.padEnd(10)} ${preset.label}${mark}`);
	}
	console.log("  /presets    显示此列表");
	console.log("  /current    查看当前 preset\n");
}
