import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	OAuthClientProvider,
	OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const DEFAULT_REDIRECT_URL = "http://127.0.0.1:8787/callback";
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

type OAuthStore = {
	clientInformation?: OAuthClientInformationMixed;
	tokens?: OAuthTokens;
	codeVerifier?: string;
	discoveryState?: OAuthDiscoveryState;
};

export type FileOAuthProviderOptions = {
	serverName: string;
	redirectUrl?: string | URL;
	onStatus?: (message: string) => void;
	storageDir?: string;
};

function sanitizeServerName(serverName: string): string {
	return serverName.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function resolveOAuthDir(storageDir?: string): string {
	return storageDir ?? join(homedir(), ".learning-pi", "mcp-oauth");
}

function openBrowser(url: string): void {
	const platform = process.platform;
	const command =
		platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
	const args = platform === "win32" ? ["/c", "start", "", url] : [url];
	spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

async function waitForOAuthCallback(
	redirectUrl: string | URL,
	timeoutMs = OAUTH_TIMEOUT_MS,
): Promise<string> {
	const target = new URL(redirectUrl);
	const port = target.port
		? Number(target.port)
		: target.protocol === "https:"
			? 443
			: 80;
	const hostname = target.hostname;
	const pathname = target.pathname || "/";

	return await new Promise((resolve, reject) => {
		const server = Bun.serve({
			hostname,
			port,
			fetch(request) {
				const requestUrl = new URL(request.url);
				if (requestUrl.pathname !== pathname) {
					return new Response("Not found", { status: 404 });
				}

				const error = requestUrl.searchParams.get("error");
				if (error) {
					const description =
						requestUrl.searchParams.get("error_description") ?? error;
					server.stop();
					reject(new Error(`OAuth authorization failed: ${description}`));
					return new Response("Authorization failed", { status: 400 });
				}

				const code = requestUrl.searchParams.get("code");
				if (!code) {
					return new Response("Missing authorization code", { status: 400 });
				}

				server.stop();
				clearTimeout(timeout);
				resolve(code);
				return new Response(
					"<html><body><h1>Authorization successful</h1><p>You can close this window and return to learning-pi.</p></body></html>",
					{ headers: { "Content-Type": "text/html; charset=utf-8" } },
				);
			},
		});

		const timeout = setTimeout(() => {
			server.stop();
			reject(
				new Error(
					`OAuth authorization timed out after ${Math.round(timeoutMs / 1000)}s`,
				),
			);
		}, timeoutMs);
	});
}

export class FileOAuthProvider implements OAuthClientProvider {
	private readonly storePath: string;
	private readonly oauthDir: string;
	private readonly redirect: URL;
	private pendingAuthorizationCode?: string;
	private memoryStore: OAuthStore = {};

	constructor(private readonly options: FileOAuthProviderOptions) {
		this.oauthDir = resolveOAuthDir(options.storageDir);
		this.storePath = join(
			this.oauthDir,
			`${sanitizeServerName(options.serverName)}.json`,
		);
		this.redirect = new URL(options.redirectUrl ?? DEFAULT_REDIRECT_URL);
	}

	get redirectUrl(): URL {
		return this.redirect;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: "learning-pi",
			redirect_uris: [this.redirect.toString()],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		};
	}

	private async readStore(): Promise<OAuthStore> {
		if (Object.keys(this.memoryStore).length > 0) {
			return this.memoryStore;
		}
		try {
			const raw = await readFile(this.storePath, "utf8");
			this.memoryStore = JSON.parse(raw) as OAuthStore;
		} catch {
			this.memoryStore = {};
		}
		return this.memoryStore;
	}

	private async writeStore(store: OAuthStore): Promise<void> {
		this.memoryStore = store;
		await mkdir(this.oauthDir, { recursive: true });
		await writeFile(
			this.storePath,
			`${JSON.stringify(store, null, 2)}\n`,
			"utf8",
		);
	}

	clientInformation():
		| OAuthClientInformationMixed
		| undefined
		| Promise<OAuthClientInformationMixed | undefined> {
		return this.readStore().then((store) => store.clientInformation);
	}

	async saveClientInformation(
		clientInformation: OAuthClientInformationMixed,
	): Promise<void> {
		const store = await this.readStore();
		store.clientInformation = clientInformation;
		await this.writeStore(store);
	}

	tokens(): OAuthTokens | undefined | Promise<OAuthTokens | undefined> {
		return this.readStore().then((store) => store.tokens);
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		const store = await this.readStore();
		store.tokens = tokens;
		delete store.codeVerifier;
		await this.writeStore(store);
	}

	async saveCodeVerifier(codeVerifier: string): Promise<void> {
		const store = await this.readStore();
		store.codeVerifier = codeVerifier;
		await this.writeStore(store);
	}

	async codeVerifier(): Promise<string> {
		const store = await this.readStore();
		if (!store.codeVerifier) {
			throw new Error("OAuth code verifier missing");
		}
		return store.codeVerifier;
	}

	async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
		const store = await this.readStore();
		store.discoveryState = state;
		await this.writeStore(store);
	}

	discoveryState():
		| OAuthDiscoveryState
		| undefined
		| Promise<OAuthDiscoveryState | undefined> {
		return this.readStore().then((store) => store.discoveryState);
	}

	async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
		this.options.onStatus?.(
			`MCP ${this.options.serverName} 需要登录，正在打开浏览器…`,
		);
		openBrowser(authorizationUrl.toString());
		this.pendingAuthorizationCode = await waitForOAuthCallback(this.redirect);
	}

	consumeAuthorizationCode(): string | undefined {
		const code = this.pendingAuthorizationCode;
		this.pendingAuthorizationCode = undefined;
		return code;
	}

	async invalidateCredentials(
		scope: "all" | "client" | "tokens" | "verifier" | "discovery",
	): Promise<void> {
		const store = await this.readStore();
		if (scope === "all" || scope === "tokens") {
			delete store.tokens;
		}
		if (scope === "all" || scope === "client") {
			delete store.clientInformation;
		}
		if (scope === "all" || scope === "verifier") {
			delete store.codeVerifier;
		}
		if (scope === "all" || scope === "discovery") {
			delete store.discoveryState;
		}
		await this.writeStore(store);
	}
}

export function createFileOAuthProvider(
	options: FileOAuthProviderOptions,
): FileOAuthProvider {
	return new FileOAuthProvider(options);
}
