import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  ChatMessageSchema,
  type ChatMessage,
} from "../schemas/chat";
import {
  getActivePresetId,
  isEnvPromptLocked,
  PRESET_PROMPTS,
  setActivePresetId,
  type PresetPromptId,
} from "../prompts";
import { createInitialHistory } from "./conversation";

const SESSION_VERSION = 1;
const SESSIONS_DIR = "sessions";
const LATEST_SESSION_FILE = "latest.json";

const PresetPromptIdSchema = z.enum(
  Object.keys(PRESET_PROMPTS) as [PresetPromptId, ...PresetPromptId[]],
);

const SessionFileSchema = z.object({
  version: z.literal(SESSION_VERSION),
  updatedAt: z.string(),
  presetId: PresetPromptIdSchema.optional(),
  messages: z.array(ChatMessageSchema).min(1),
});

function sessionsDir(): string {
  return join(process.cwd(), SESSIONS_DIR);
}

function latestSessionPath(): string {
  return join(sessionsDir(), LATEST_SESSION_FILE);
}

function normalizeRestoredMessages(
  messages: ChatMessage[],
  presetId?: PresetPromptId,
): ChatMessage[] {
  if (isEnvPromptLocked()) {
    const turns = messages.filter((m) => m.role !== "system");
    return [...createInitialHistory(), ...turns];
  }

  if (presetId) {
    setActivePresetId(presetId);
  }

  return messages;
}

/** 读取上次保存的对话；不存在或损坏时返回 null。 */
export async function loadLatestSession(): Promise<ChatMessage[] | null> {
  try {
    const raw = await readFile(latestSessionPath(), "utf-8");
    const parsed = SessionFileSchema.parse(JSON.parse(raw));
    return normalizeRestoredMessages(parsed.messages, parsed.presetId);
  } catch {
    return null;
  }
}

export function countConversationTurns(history: ChatMessage[]): number {
  return history.filter((m) => m.role !== "system").length;
}

/** 退出时将 history 写入 sessions/latest.json。 */
export async function saveLatestSession(history: ChatMessage[]): Promise<void> {
  if (history.length === 0) return;

  await mkdir(sessionsDir(), { recursive: true });

  const payload = {
    version: SESSION_VERSION as const,
    updatedAt: new Date().toISOString(),
    presetId: isEnvPromptLocked() ? undefined : getActivePresetId(),
    messages: history,
  };

  await writeFile(
    latestSessionPath(),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf-8",
  );
}
