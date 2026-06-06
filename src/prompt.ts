import type { ChatMessage } from "./schemas/chat";
import { loadEnv } from "./env";

export const PRESET_PROMPTS = {
  default: {
    label: "通用助手",
    content:
      "你是 learning-pi 助手。回答简洁准确，优先使用中文。不确定时直接说明，不要编造。",
  },
  code: {
    label: "编程助教",
    content:
      "你是 TypeScript 与 Bun 编程助教。回答侧重可运行示例与原理说明，代码用 markdown 代码块。遇到不确定的 API 要说明，不要编造。",
  },
  translate: {
    label: "翻译官",
    content:
      "你是中英互译助手。用户给中文则译成自然英文，给英文则译成自然中文。只输出译文，必要时用一行注释说明语气或歧义。",
  },
  concise: {
    label: "简洁模式",
    content:
      "你是极简回答助手。每次回答不超过 3 句话，优先给结论，避免废话和过度铺垫。",
  },
} as const;

export type PresetPromptId = keyof typeof PRESET_PROMPTS;

let activePresetId: PresetPromptId = "default";

export function getActivePresetId(): PresetPromptId {
  return activePresetId;
}

export function getPresetPrompt(id: PresetPromptId): string {
  return PRESET_PROMPTS[id].content;
}

export function getSystemPrompt(): string {
  const fromEnv = loadEnv().SYSTEM_PROMPT?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return getPresetPrompt(activePresetId);
}

export function historyWithPreset(id: PresetPromptId): ChatMessage[] {
  return [{ role: "system", content: getPresetPrompt(id) }];
}

/** 供 REPL 初始化 history。若 .env 有 SYSTEM_PROMPT 则优先使用。 */
export function createInitialHistory(): ChatMessage[] {
  const fromEnv = loadEnv().SYSTEM_PROMPT?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return [{ role: "system", content: fromEnv }];
  }
  return historyWithPreset(activePresetId);
}

export function withSystemPrompt(messages: ChatMessage[]): ChatMessage[] {
  if (messages.some((m) => m.role === "system")) {
    return messages;
  }
  return [{ role: "system", content: getSystemPrompt() }, ...messages];
}

export type BackslashCommand = {
  command: string;
  label: string;
};

const BACKSLASH_META_COMMANDS: BackslashCommand[] = [
  { command: "help", label: "显示帮助" },
  { command: "list", label: "列出 preset" },
  { command: "prompts", label: "列出 preset" },
  { command: "current", label: "查看当前 preset" },
];

/** 所有 \\ 命令（供补全与下拉提示使用）。 */
export function getBackslashCommands(): BackslashCommand[] {
  const presets = Object.entries(PRESET_PROMPTS).map(([id, preset]) => ({
    command: id,
    label: preset.label,
  }));
  return [...BACKSLASH_META_COMMANDS, ...presets];
}

function switchPreset(history: ChatMessage[], id: PresetPromptId): void {
  activePresetId = id;
  history.length = 0;
  history.push(...historyWithPreset(id));
}

function printPresetList(): void {
  console.log("\n可用预设（输入 \\名称 切换，会清空当前对话）：");
  for (const [id, preset] of Object.entries(PRESET_PROMPTS)) {
    const mark = id === activePresetId ? " *" : "";
    console.log(`  \\${id.padEnd(10)} ${preset.label}${mark}`);
  }
  console.log("  \\help       显示命令帮助");
  console.log("  \\current    查看当前 preset\n");
}

function printCurrentPreset(): void {
  const fromEnv = loadEnv().SYSTEM_PROMPT?.trim();
  if (fromEnv) {
    console.log("\n当前：.env SYSTEM_PROMPT（固定，重启后生效）");
    console.log(`内容预览：${fromEnv.slice(0, 80)}${fromEnv.length > 80 ? "…" : ""}\n`);
    return;
  }
  const preset = PRESET_PROMPTS[activePresetId];
  console.log(`\n当前：\\${activePresetId}（${preset.label}）`);
  console.log(`内容预览：${preset.content.slice(0, 80)}…\n`);
}

function printHelp(): void {
  console.log(`
反斜杠命令（不会发送给大模型）：
  \\help        显示此帮助
  \\list        列出 preset（同 \\prompts）
  \\current     查看当前 preset
  \\default     通用助手
  \\code        编程助教
  \\translate   翻译官
  \\concise     简洁模式

仍可用 /quit、/exit、/q 退出。
`);
}

/**
 * 处理以 \\ 开头的 REPL 命令。返回 true 表示已处理，不应再发给 LLM。
 */
export function tryHandlePromptCommand(
  line: string,
  history: ChatMessage[],
): boolean {
  if (!line.startsWith("\\")) return false;

  const cmd = line.slice(1).trim().toLowerCase();

  if (cmd === "" || cmd === "help" || cmd === "?") {
    printHelp();
    return true;
  }

  if (cmd === "list" || cmd === "prompts") {
    printPresetList();
    return true;
  }

  if (cmd === "current") {
    printCurrentPreset();
    return true;
  }

  if (loadEnv().SYSTEM_PROMPT?.trim()) {
    console.log(
      "\n已在 .env 设置 SYSTEM_PROMPT，运行时 preset 切换被禁用。请删除或注释后重试。\n",
    );
    return true;
  }

  if (cmd in PRESET_PROMPTS) {
    const id = cmd as PresetPromptId;
    switchPreset(history, id);
    console.log(`\n已切换为 \\${id}（${PRESET_PROMPTS[id].label}），对话已清空。\n`);
    return true;
  }

  console.log(`\n未知命令 \\${cmd}。输入 \\help 或 \\list 查看可用 preset。\n`);
  return true;
}
