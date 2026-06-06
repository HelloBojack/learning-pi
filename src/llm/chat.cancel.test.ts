import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearStubEnv, stubRequiredEnv } from "../test/helpers";
import { type ChatOptions, chatStream, LlmCancelledError } from "./chat";

const originalFetch = globalThis.fetch;

function mockFetch(
	impl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): void {
	globalThis.fetch = impl as typeof fetch;
}

const instantRetry: ChatOptions = {
	retryBackoff: async () => {},
};

function sseResponse(lines: string[]): Response {
	const body = `${lines.join("\n")}\n`;
	return new Response(body, {
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
	});
}

describe("chat stream cancel", () => {
	beforeEach(() => {
		stubRequiredEnv();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		clearStubEnv();
	});

	test("throws LlmCancelledError with partial content when cancelSignal aborts mid-stream", async () => {
		mockFetch(async () =>
			sseResponse([
				'data: {"choices":[{"delta":{"content":"你"}}]}',
				'data: {"choices":[{"delta":{"content":"好"}}]}',
				"data: [DONE]",
			]),
		);

		const cancel = new AbortController();
		const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(5_000)]);

		const collected: string[] = [];
		const task = (async () => {
			for await (const chunk of chatStream([{ role: "user", content: "hi" }], {
				signal,
				cancelSignal: cancel.signal,
				...instantRetry,
			})) {
				collected.push(chunk);
				if (collected.join("") === "你") {
					cancel.abort();
				}
			}
		})();

		const err = await task.catch((e) => e);
		expect(err).toBeInstanceOf(LlmCancelledError);
		expect((err as LlmCancelledError).partialContent).toBe("你");
		expect(collected).toEqual(["你"]);
	});

	test("throws LlmCancelledError with empty partial when cancelled before response", async () => {
		let releaseFetch!: () => void;
		const fetchGate = new Promise<void>((resolve) => {
			releaseFetch = resolve;
		});

		mockFetch(async () => {
			await fetchGate;
			return sseResponse(['data: {"choices":[{"delta":{"content":"late"}}]}']);
		});

		const cancel = new AbortController();
		const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(5_000)]);

		const task = chatStream([{ role: "user", content: "hi" }], {
			signal,
			cancelSignal: cancel.signal,
			...instantRetry,
		});

		const consume = (async () => {
			for await (const _chunk of task) {
				// no chunks expected
			}
		})();

		await Bun.sleep(10);
		cancel.abort();
		releaseFetch();

		const err = await consume.catch((e) => e);
		expect(err).toBeInstanceOf(LlmCancelledError);
		expect((err as LlmCancelledError).partialContent).toBe("");
	});
});
