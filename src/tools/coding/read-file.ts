import { readFile, stat } from "node:fs/promises";
import { defineLocalTool } from "../registry";
import type { LocalToolSpec } from "../types";
import {
	getWorkspaceRoot,
	PathSandboxError,
	resolveSafePath,
	toWorkspaceRelative,
} from "./path";

export const MAX_READ_FILE_BYTES = 256 * 1024;

export type ReadFileArgs = {
	path?: unknown;
	offset?: unknown;
	limit?: unknown;
};

export type ReadFileResult = {
	path: string;
	content: string;
	startLine: number;
	endLine: number;
	totalLines: number;
	truncated: boolean;
	bytesRead: number;
	mtime_ms: number;
};

function parsePositiveInt(value: unknown, field: string): number | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`${field} must be a positive integer`);
	}
	return value;
}

function splitLines(text: string): string[] {
	const normalized = text.replace(/\r\n/g, "\n");
	if (normalized.length === 0) return [];
	if (normalized.endsWith("\n")) {
		return normalized.slice(0, -1).split("\n");
	}
	return normalized.split("\n");
}

function selectLines(
	lines: string[],
	offset: number | null,
	limit: number | null,
): { content: string; startLine: number; endLine: number; totalLines: number } {
	const totalLines = lines.length === 1 && lines[0] === "" ? 0 : lines.length;
	const startLine = offset ?? 1;

	if (startLine > totalLines && totalLines > 0) {
		return { content: "", startLine, endLine: startLine - 1, totalLines };
	}

	const startIdx = Math.max(0, startLine - 1);
	const endIdx =
		limit === null ? totalLines : Math.min(totalLines, startIdx + limit);
	const slice = lines.slice(startIdx, endIdx);

	return {
		content: slice.join("\n"),
		startLine: totalLines === 0 ? 1 : startLine,
		endLine: totalLines === 0 ? 0 : startIdx + slice.length,
		totalLines,
	};
}

export async function executeReadFile(args: ReadFileArgs): Promise<string> {
	const filePath = args.path;
	if (typeof filePath !== "string" || !filePath.trim()) {
		return JSON.stringify({ error: "path must be a non-empty string" });
	}

	let offset: number | null;
	let limit: number | null;
	try {
		offset = parsePositiveInt(args.offset, "offset");
		limit = parsePositiveInt(args.limit, "limit");
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "invalid offset or limit";
		return JSON.stringify({ error: message });
	}

	let absolutePath: string;
	try {
		absolutePath = resolveSafePath(filePath);
	} catch (err) {
		const message =
			err instanceof PathSandboxError ? err.message : "invalid path";
		return JSON.stringify({ error: message });
	}

	try {
		const info = await stat(absolutePath);
		if (!info.isFile()) {
			return JSON.stringify({ error: "path is not a file" });
		}
		if (info.size > MAX_READ_FILE_BYTES) {
			const file = Bun.file(absolutePath);
			const slice = file.slice(0, MAX_READ_FILE_BYTES);
			const bytes = await slice.arrayBuffer();
			const text = Buffer.from(bytes).toString("utf-8");
			const lines = splitLines(text);
			const selected = selectLines(lines, offset, limit);
			const result: ReadFileResult = {
				path: toWorkspaceRelative(absolutePath),
				content: selected.content,
				startLine: selected.startLine,
				endLine: selected.endLine,
				totalLines: selected.totalLines,
				truncated: true,
				bytesRead: MAX_READ_FILE_BYTES,
				mtime_ms: Math.floor(info.mtimeMs),
			};
			return JSON.stringify(result);
		}

		const raw = await readFile(absolutePath, "utf-8");
		const lines = splitLines(raw);
		const selected = selectLines(lines, offset, limit);
		const result: ReadFileResult = {
			path: toWorkspaceRelative(absolutePath),
			content: selected.content,
			startLine: selected.startLine,
			endLine: selected.endLine,
			totalLines: selected.totalLines,
			truncated: false,
			bytesRead: Buffer.byteLength(raw, "utf-8"),
			mtime_ms: Math.floor(info.mtimeMs),
		};
		return JSON.stringify(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : "read failed";
		if (message.includes("ENOENT")) {
			return JSON.stringify({ error: "file not found", path: filePath.trim() });
		}
		return JSON.stringify({ error: message, path: filePath.trim() });
	}
}

export const READ_FILE_TOOL_SPEC: LocalToolSpec = defineLocalTool({
	name: "read_file",
	description:
		"读取工作区内的文本文件内容，支持 offset/limit 按行截取（1-based）",
	parameters: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "相对或绝对路径（须在工作区内）",
			},
			offset: {
				type: "number",
				description: "起始行号（从 1 开始，默认 1）",
			},
			limit: {
				type: "number",
				description: "最多读取的行数（默认读到文件末尾）",
			},
		},
		required: ["path"],
	},
	execute: async (args) => executeReadFile(args as ReadFileArgs),
});

export function getReadFileWorkspaceRoot(): string {
	return getWorkspaceRoot();
}
