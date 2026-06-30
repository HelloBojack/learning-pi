import { connectMcpServer } from "../mcp/client";
import { loadMcpConfig, type McpConfig } from "../mcp/config";
import { createLocalToolRegistry, registerLocalTools } from "../tools/local";
import { ToolRegistry } from "../tools/registry";

export type CreateToolRegistryOptions = {
	mcpConfigPath?: string;
	mcpConfig?: McpConfig | null;
};

export type ToolRegistryInitResult = {
	registry: ToolRegistry;
	mcp: {
		configPath: string | null;
		servers: Array<{
			name: string;
			toolCount: number;
			error?: string;
		}>;
	};
};

export async function createToolRegistry(
	options: CreateToolRegistryOptions = {},
): Promise<ToolRegistryInitResult> {
	const registry = createLocalToolRegistry();
	const config =
		options.mcpConfig !== undefined
			? options.mcpConfig
			: await loadMcpConfig(options.mcpConfigPath);

	if (!config) {
		return {
			registry,
			mcp: { configPath: null, servers: [] },
		};
	}

	const configPath =
		options.mcpConfigPath ??
		process.env.MCP_CONFIG_PATH?.trim() ??
		`${process.cwd()}/mcp.json`;

	const servers: ToolRegistryInitResult["mcp"]["servers"] = [];

	for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
		try {
			const connection = await connectMcpServer(name, serverConfig, {
				onStatus: (message) => console.log(message),
			});
			const toolCount = await registry.registerMcpServer(
				name,
				connection.client,
			);
			registry.trackMcpConnection(name, connection.client, connection.close);
			servers.push({ name, toolCount });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			servers.push({ name, toolCount: 0, error: message });
		}
	}

	return {
		registry,
		mcp: { configPath, servers },
	};
}

let defaultRegistry: ToolRegistry | null = null;

/** 仅含本地内置工具的同步 registry（测试与无 MCP 场景）。 */
export function getLocalToolRegistry(): ToolRegistry {
	if (!defaultRegistry) {
		defaultRegistry = new ToolRegistry();
		registerLocalTools(defaultRegistry);
	}
	return defaultRegistry;
}

export function formatToolRegistrySummary(
	result: ToolRegistryInitResult,
): string {
	const { local, mcp } = result.registry.listBySource();
	const lines = [`本地工具 ${local.length} 个`];

	if (result.mcp.servers.length === 0) {
		return lines.join("，");
	}

	for (const server of result.mcp.servers) {
		if (server.error) {
			const hint =
				/Unauthorized|401|OAuth/i.test(server.error) &&
				!server.error.includes("browser login")
					? "（HTTP MCP 通常需要 OAuth 登录，请确认浏览器授权已完成）"
					: "";
			lines.push(`MCP ${server.name}: 连接失败 (${server.error})${hint}`);
		} else {
			lines.push(`MCP ${server.name}: ${server.toolCount} 个工具`);
		}
	}

	lines.push(`MCP 合计 ${mcp.length} 个`);
	return lines.join("；");
}
