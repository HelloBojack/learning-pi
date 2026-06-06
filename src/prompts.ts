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

export function isEnvPromptLocked(): boolean {
  const fromEnv = loadEnv().SYSTEM_PROMPT?.trim();
  return Boolean(fromEnv && fromEnv.length > 0);
}

export function getSystemPrompt(): string {
  if (isEnvPromptLocked()) return loadEnv().SYSTEM_PROMPT!.trim();
  return getPresetPrompt(activePresetId);
}

export function systemMessageForPreset(id: PresetPromptId): ChatMessage {
  return { role: "system", content: getPresetPrompt(id) };
}

export function switchActivePreset(id: PresetPromptId): ChatMessage[] {
  activePresetId = id;
  return [systemMessageForPreset(id)];
}

export function withSystemPrompt(messages: ChatMessage[]): ChatMessage[] {
  if (messages.some((m) => m.role === "system")) {
    return messages;
  }
  return [{ role: "system", content: getSystemPrompt() }, ...messages];
}
