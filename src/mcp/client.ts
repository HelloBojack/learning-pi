import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
	isHttpMcpServer,
	isStdioMcpServer,
	type McpServerConfig,
} from "./config";
import { createFileOAuthProvider, type FileOAuthProvider } from "./oauth";

export type McpConnection = {
	serverName: string;
	client: Client;
	close: () => Promise<void>;
};

export type ConnectMcpServerOptions = {
	onStatus?: (message: string) => void;
};

function createTransport(
	config: McpServerConfig,
	serverName: string,
	options: ConnectMcpServerOptions,
): {
	transport: StdioClientTransport | StreamableHTTPClientTransport;
	authProvider?: FileOAuthProvider;
} {
	if (isStdioMcpServer(config)) {
		return {
			transport: new StdioClientTransport({
				command: config.command,
				args: config.args,
				env: config.env,
				cwd: config.cwd,
			}),
		};
	}

	if (isHttpMcpServer(config)) {
		const authProvider = config.oauth
			? createFileOAuthProvider({
					serverName,
					onStatus: options.onStatus,
				})
			: undefined;

		return {
			transport: new StreamableHTTPClientTransport(new URL(config.url), {
				requestInit: config.headers ? { headers: config.headers } : undefined,
				authProvider,
			}),
			authProvider,
		};
	}

	throw new Error("unsupported MCP server config");
}

async function connectClient(
	client: Client,
	transport: StdioClientTransport | StreamableHTTPClientTransport,
	authProvider?: FileOAuthProvider,
	options: ConnectMcpServerOptions = {},
): Promise<void> {
	try {
		await client.connect(transport);
	} catch (err) {
		if (
			!(err instanceof UnauthorizedError) ||
			!(transport instanceof StreamableHTTPClientTransport) ||
			!authProvider
		) {
			throw err;
		}

		const authorizationCode = authProvider.consumeAuthorizationCode();
		if (!authorizationCode) {
			throw new Error(
				"MCP OAuth authorization was not completed. Complete the browser login and retry.",
			);
		}

		options.onStatus?.("MCP OAuth 授权完成，正在重新连接…");
		await transport.finishAuth(authorizationCode);
		await client.connect(transport);
	}
}

export async function connectMcpServer(
	serverName: string,
	config: McpServerConfig,
	options: ConnectMcpServerOptions = {},
): Promise<McpConnection> {
	const client = new Client(
		{ name: "learning-pi", version: "0.1.0" },
		{ capabilities: {} },
	);
	const { transport, authProvider } = createTransport(
		config,
		serverName,
		options,
	);
	await connectClient(client, transport, authProvider, options);

	return {
		serverName,
		client,
		close: async () => {
			await client.close();
		},
	};
}
