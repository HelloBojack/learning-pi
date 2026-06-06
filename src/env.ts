import { z } from "zod";

const EnvSchema = z.object({
  API_URL: z.string().url(),
  API_KEY: z.string().min(1),
  API_CHAT_PATH: z.string().optional(),
  API_MODEL: z.string().optional(),
  SYSTEM_PROMPT: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse({
    API_URL: process.env.API_URL,
    API_KEY: process.env.API_KEY,
    API_CHAT_PATH: process.env.API_CHAT_PATH,
    API_MODEL: process.env.API_MODEL,
    SYSTEM_PROMPT: process.env.SYSTEM_PROMPT,
  });

  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `Missing or invalid env. Set API_URL and API_KEY in .env (${missing})`,
    );
  }

  return parsed.data;
}

export function resolveChatEndpoint(env: Env): string {
  const base = new URL(env.API_URL);
  const hasCustomPath =
    base.pathname !== "/" && base.pathname !== "";

  if (hasCustomPath) {
    return base.toString();
  }

  const path = env.API_CHAT_PATH ?? "/v1/chat/completions";
  return new URL(path, base).toString();
}
