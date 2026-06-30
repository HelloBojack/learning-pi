import { describe, expect, test } from "bun:test";
import { mcpResultToString, mcpToolToDefinition } from "../mcp/adapter";
import { createLocalToolRegistry } from "../tools/local";
import { ToolRegistry } from "../tools/registry";

describe("ToolRegistry", () => {
	test("registers local tools with unified definition + execute", () => {
		const registry = createLocalToolRegistry();
		const defs = registry.getDefinitions();
		expect(defs.map((d) => d.function.name)).toEqual([
			"get_current_time",
			"calculate",
			"get_context_usage",
			"fetch_url",
			"read_file",
			"grep",
			"run_terminal_cmd",
		]);
	});

	test("executes local tool through registry", async () => {
		const registry = createLocalToolRegistry();
		const result = await registry.execute("calculate", '{"expression":"1+2"}');
		expect(JSON.parse(result)).toEqual({ expression: "1+2", result: 3 });
	});

	test("denies run_terminal_cmd without confirm in default mode", async () => {
		const registry = createLocalToolRegistry();
		const result = await registry.execute(
			"run_terminal_cmd",
			'{"command":"echo hi"}',
			{ permissionMode: "default" },
		);
		const parsed = JSON.parse(result) as { error: string; reason: string };
		expect(parsed.error).toBe("permission denied");
		expect(parsed.reason).toContain("non-interactive");
	});

	test("allows grep without confirmation", async () => {
		const registry = createLocalToolRegistry();
		const result = await registry.execute(
			"grep",
			'{"pattern":"grep","path":"package.json","max_results":1}',
			{ permissionMode: "default" },
		);
		const parsed = JSON.parse(result) as {
			matchCount?: number;
			error?: string;
			reason?: string;
		};
		expect(parsed.error).not.toBe("permission denied");
		expect(typeof parsed.matchCount).toBe("number");
	});

	test("prefixes MCP tool name on collision", async () => {
		const registry = new ToolRegistry();
		registry.registerLocal({
			name: "read_file",
			description: "local",
			parameters: { type: "object", properties: {} },
			execute: async () => "{}",
		});

		const mockClient = {
			listTools: async () => ({
				tools: [
					{
						name: "read_file",
						description: "remote",
						inputSchema: { type: "object", properties: {} },
					},
				],
			}),
			callTool: async () => ({
				content: [{ type: "text", text: "remote ok" }],
			}),
		};

		const count = await registry.registerMcpServer("fs", mockClient as never);
		expect(count).toBe(1);
		expect(registry.has("fs__read_file")).toBe(true);
		expect(registry.has("read_file")).toBe(true);
	});
});

describe("mcp adapter", () => {
	test("mcpToolToDefinition maps inputSchema to OpenAI parameters", () => {
		const def = mcpToolToDefinition({
			name: "search",
			description: "search docs",
			inputSchema: {
				type: "object",
				properties: { q: { type: "string" } },
				required: ["q"],
			},
		});

		expect(def.function.name).toBe("search");
		expect(def.function.parameters).toEqual({
			type: "object",
			properties: { q: { type: "string" } },
			required: ["q"],
		});
	});

	test("mcpResultToString prefers structuredContent", () => {
		const text = mcpResultToString({
			content: [{ type: "text", text: "ignored" }],
			structuredContent: { ok: true },
		});
		expect(JSON.parse(text)).toEqual({ ok: true });
	});

	test("mcpResultToString returns single text part directly", () => {
		expect(
			mcpResultToString({
				content: [{ type: "text", text: "hello" }],
			}),
		).toBe("hello");
	});
});
