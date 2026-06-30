import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { FileOAuthProvider } from "../mcp/oauth";

const TEST_DIR = join(import.meta.dir, ".oauth-test");

afterEach(async () => {
	await rm(TEST_DIR, { recursive: true, force: true });
});

describe("FileOAuthProvider", () => {
	test("persists client information and tokens", async () => {
		await mkdir(TEST_DIR, { recursive: true });
		const provider = new FileOAuthProvider({
			serverName: "demo-server",
			storageDir: TEST_DIR,
		});
		await provider.saveClientInformation({ client_id: "demo-client" });
		await provider.saveTokens({
			access_token: "token-123",
			token_type: "Bearer",
		});

		const reloaded = new FileOAuthProvider({
			serverName: "demo-server",
			storageDir: TEST_DIR,
		});
		expect(await reloaded.clientInformation()).toEqual({
			client_id: "demo-client",
		});
		expect(await reloaded.tokens()).toEqual({
			access_token: "token-123",
			token_type: "Bearer",
		});

		const storePath = join(TEST_DIR, "demo-server.json");
		const raw = await readFile(storePath, "utf8");
		expect(JSON.parse(raw)).toMatchObject({
			clientInformation: { client_id: "demo-client" },
			tokens: { access_token: "token-123", token_type: "Bearer" },
		});
	});

	test("consumeAuthorizationCode returns undefined when empty", () => {
		const provider = new FileOAuthProvider({ serverName: "demo-server" });
		expect(provider.consumeAuthorizationCode()).toBeUndefined();
	});
});
