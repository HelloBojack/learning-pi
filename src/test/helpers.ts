/** 测试用最小 env，避免依赖本地 .env 文件。 */
export function stubRequiredEnv(): void {
  process.env.API_URL = "https://example.com/v1/chat/completions";
  process.env.API_KEY = "test-key";
}

export function clearStubEnv(): void {
  delete process.env.API_URL;
  delete process.env.API_KEY;
  delete process.env.SYSTEM_PROMPT;
}
