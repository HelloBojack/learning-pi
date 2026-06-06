import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { clearStubEnv, stubRequiredEnv } from "../test/helpers";
import { chat, type ChatOptions, LlmApiError, LlmNetworkError } from "./chat";

const originalFetch = globalThis.fetch;

/** 跳过重试退避，避免测试/CI 等待真实 delay。 */
const instantRetry: ChatOptions = {
  retryBackoff: async () => {},
};

function okChatResponse(content = "hello"): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("chat fetch retry", () => {
  beforeEach(() => {
    stubRequiredEnv();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearStubEnv();
  });

  test("does not retry on 401 client error", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response('{"error":"unauthorized"}', { status: 401 });
    };

    const err = await chat([{ role: "user", content: "hi" }], instantRetry).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(LlmApiError);
    expect((err as LlmApiError).status).toBe(401);
    expect((err as LlmApiError).isClientError()).toBe(true);
    expect(calls).toBe(1);
  });

  test("retries once on 502 then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("bad gateway", { status: 502 });
      }
      return okChatResponse("recovered");
    };

    const reply = await chat([{ role: "user", content: "hi" }], instantRetry);
    expect(calls).toBe(2);
    expect(reply).toBe("recovered");
  });

  test("retries on network error then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("ECONNRESET");
      }
      return okChatResponse("online");
    };

    const reply = await chat([{ role: "user", content: "hi" }], instantRetry);
    expect(calls).toBe(2);
    expect(reply).toBe("online");
  });

  test("throws LlmNetworkError after repeated network failures", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("ECONNRESET");
    };

    await expect(
      chat([{ role: "user", content: "hi" }], instantRetry),
    ).rejects.toBeInstanceOf(LlmNetworkError);
    expect(calls).toBe(3);
  });
});
