import { stat } from "node:fs/promises";
import { defineLocalTool } from "../registry";
import type { LocalToolSpec } from "../types";
import {
	getWorkspaceRoot,
	PathSandboxError,
	resolveSafePath,
	toWorkspaceRelative,
} from "./path";

export const DEFAULT_GREP_MAX_RESULTS = 50;
export const MAX_GREP_MAX_RESULTS = 200;

export type GrepMatch = {
	path: string;
	line: number;
	text: string;
};

export type GrepArgs = {
	pattern?: unknown;
	path?: unknown;
	glob?: unknown;
	max_results?: unknown;
};

let rgAvailable: boolean | null = null;

async function detectRg(): Promise<boolean> {
	if (rgAvailable !== null) return rgAvailable;
	const proc = Bun.spawn(["rg", "--version"], {
		stdout: "ignore",
		stderr: "ignore",
	});
	rgAvailable = (await proc.exited) === 0;
	return rgAvailable;
}

function parseMaxResults(value: unknown): number {
	if (value === undefined || value === null) {
		return DEFAULT_GREP_MAX_RESULTS;
	}
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error("max_results must be a positive integer");
	}
	return Math.min(value, MAX_GREP_MAX_RESULTS);
}

function parseRgLine(line: string, workspaceRoot: string): GrepMatch | null {
	const match = line.match(/^(.+?):(\d+):(.*)$/);
	if (!match) return null;
	const [, filePath, lineNo, text] = match;
	if (!filePath || !lineNo) return null;
	return {
		path: toWorkspaceRelative(filePath, workspaceRoot),
		line: Number(lineNo),
		text: text ?? "",
	};
}

async function grepWithRg(
	pattern: string,
	searchPath: string,
	glob: string | null,
	maxResults: number,
	workspaceRoot: string,
): Promise<GrepMatch[]> {
	const args = [
		"-n",
		"--no-heading",
		"--color=never",
		"-m",
		String(maxResults),
	];
	if (glob) {
		args.push("-g", glob);
	}
	args.push(pattern, searchPath);

	const proc = Bun.spawn(["rg", ...args], {
		stdout: "pipe",
		stderr: "pipe",
		cwd: workspaceRoot,
	});

	const [stdout, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);

	if (exitCode !== 0 && exitCode !== 1) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(stderr.trim() || `rg exited with code ${exitCode}`);
	}

	return stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => parseRgLine(line, workspaceRoot))
		.filter((item): item is GrepMatch => item !== null)
		.slice(0, maxResults);
}

async function grepWithBuiltin(
	pattern: string,
	searchPath: string,
	maxResults: number,
	workspaceRoot: string,
): Promise<GrepMatch[]> {
	let regex: RegExp;
	try {
		regex = new RegExp(pattern);
	} catch {
		regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	}

	const proc = Bun.spawn(["grep", "-rn", pattern, searchPath], {
		stdout: "pipe",
		stderr: "pipe",
		cwd: workspaceRoot,
	});

	const [stdout, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);

	if (exitCode !== 0 && exitCode !== 1) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(stderr.trim() || `grep exited with code ${exitCode}`);
	}

	const matches: GrepMatch[] = [];
	for (const line of stdout.split("\n")) {
		if (!line) continue;
		const parsed = parseRgLine(line, workspaceRoot);
		if (!parsed) continue;
		if (!regex.test(parsed.text)) continue;
		matches.push(parsed);
		if (matches.length >= maxResults) break;
	}
	return matches;
}

export async function executeGrep(args: GrepArgs): Promise<string> {
	const pattern = args.pattern;
	if (typeof pattern !== "string" || !pattern.trim()) {
		return JSON.stringify({ error: "pattern must be a non-empty string" });
	}

	const pathInput =
		typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";

	let maxResults: number;
	try {
		maxResults = parseMaxResults(args.max_results);
	} catch (err) {
		const message = err instanceof Error ? err.message : "invalid max_results";
		return JSON.stringify({ error: message });
	}

	const glob =
		typeof args.glob === "string" && args.glob.trim() ? args.glob.trim() : null;

	const workspaceRoot = getWorkspaceRoot();
	let searchPath: string;
	try {
		searchPath = resolveSafePath(pathInput, workspaceRoot);
		const info = await stat(searchPath);
		if (!info.isFile() && !info.isDirectory()) {
			return JSON.stringify({ error: "path is not a file or directory" });
		}
	} catch (err) {
		if (err instanceof PathSandboxError) {
			return JSON.stringify({ error: err.message });
		}
		const message = err instanceof Error ? err.message : "invalid path";
		return JSON.stringify({ error: message, path: pathInput });
	}

	try {
		const useRg = await detectRg();
		const matches = useRg
			? await grepWithRg(
					pattern.trim(),
					searchPath,
					glob,
					maxResults,
					workspaceRoot,
				)
			: await grepWithBuiltin(
					pattern.trim(),
					searchPath,
					maxResults,
					workspaceRoot,
				);

		return JSON.stringify({
			pattern: pattern.trim(),
			path: toWorkspaceRelative(searchPath, workspaceRoot),
			engine: useRg ? "rg" : "grep",
			matchCount: matches.length,
			truncated: matches.length >= maxResults,
			matches,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "grep failed";
		return JSON.stringify({ error: message });
	}
}

export const GREP_TOOL_SPEC: LocalToolSpec = defineLocalTool({
	name: "grep",
	description:
		"在工作区内按正则搜索文件内容，返回匹配行（优先 ripgrep，否则系统 grep）",
	parameters: {
		type: "object",
		properties: {
			pattern: {
				type: "string",
				description: "搜索正则或关键字",
			},
			path: {
				type: "string",
				description: "文件或目录路径，默认 .（工作区根）",
			},
			glob: {
				type: "string",
				description: "glob 过滤，如 *.ts（仅 ripgrep 可用）",
			},
			max_results: {
				type: "number",
				description: `最多返回匹配数，默认 ${DEFAULT_GREP_MAX_RESULTS}`,
			},
		},
		required: ["pattern"],
	},
	execute: async (args) => executeGrep(args as GrepArgs),
});
