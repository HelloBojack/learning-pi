import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const McpServerStdioSchema = z.object({
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
	cwd: z.string().optional(),
});

const McpServerHttpSchema = z.object({
	url: z.string().url(),
	headers: z.record(z.string(), z.string()).optional(),
	/** 启用 MCP OAuth（浏览器登录）。HTTP MCP 默认开启。 */
	oauth: z.boolean().optional().default(true),
});

export const McpServerConfigSchema = z.union([
	McpServerStdioSchema,
	McpServerHttpSchema,
]);

export const McpConfigSchema = z.object({
	mcpServers: z.record(z.string(), McpServerConfigSchema),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;

export function isStdioMcpServer(
	config: McpServerConfig,
): config is z.infer<typeof McpServerStdioSchema> {
	return "command" in config;
}

export function isHttpMcpServer(
	config: McpServerConfig,
): config is z.infer<typeof McpServerHttpSchema> {
	return "url" in config;
}

export function resolveMcpConfigPath(explicitPath?: string): string | null {
	const candidate =
		explicitPath?.trim() ||
		process.env.MCP_CONFIG_PATH?.trim() ||
		resolve(process.cwd(), "mcp.json");

	if (!existsSync(candidate)) {
		return null;
	}
	return candidate;
}

export async function loadMcpConfig(
	explicitPath?: string,
): Promise<McpConfig | null> {
	const path = resolveMcpConfigPath(explicitPath);
	if (!path) {
		return null;
	}

	const raw = await readFile(path, "utf8");
	const parsed = JSON.parse(raw) as unknown;
	return McpConfigSchema.parse(parsed);
}
