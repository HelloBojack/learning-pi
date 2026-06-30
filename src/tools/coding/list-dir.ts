import { readdir, stat } from "node:fs/promises";
import { defineLocalTool } from "../registry";
import type { LocalToolSpec } from "../types";
import {
	getWorkspaceRoot,
	PathSandboxError,
	resolveSafePath,
	toWorkspaceRelative,
} from "./path";

export const DEFAULT_LIST_DIR_MAX_ENTRIES = 200;
export const MAX_LIST_DIR_MAX_ENTRIES = 500;

export type ListDirEntry = {
	name: string;
	kind: "file" | "directory" | "other";
};

export type ListDirArgs = {
	path?: unknown;
	max_entries?: unknown;
};

function parseMaxEntries(value: unknown): number {
	if (value === undefined || value === null) {
		return DEFAULT_LIST_DIR_MAX_ENTRIES;
	}
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error("max_entries must be a positive integer");
	}
	return Math.min(value, MAX_LIST_DIR_MAX_ENTRIES);
}

function entryKind(
	isDirectory: boolean,
	isFile: boolean,
): ListDirEntry["kind"] {
	if (isDirectory) return "directory";
	if (isFile) return "file";
	return "other";
}

export async function executeListDir(args: ListDirArgs): Promise<string> {
	const pathInput =
		typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";

	let maxEntries: number;
	try {
		maxEntries = parseMaxEntries(args.max_entries);
	} catch (err) {
		const message = err instanceof Error ? err.message : "invalid max_entries";
		return JSON.stringify({ error: message });
	}

	let absolutePath: string;
	try {
		absolutePath = resolveSafePath(pathInput);
	} catch (err) {
		const message =
			err instanceof PathSandboxError ? err.message : "invalid path";
		return JSON.stringify({ error: message });
	}

	try {
		const info = await stat(absolutePath);
		if (!info.isDirectory()) {
			return JSON.stringify({ error: "path is not a directory" });
		}

		const names = await readdir(absolutePath);
		names.sort((a, b) => a.localeCompare(b));

		const entries: ListDirEntry[] = [];
		for (const name of names) {
			if (entries.length >= maxEntries) break;
			const childPath = `${absolutePath}/${name}`;
			try {
				const childInfo = await stat(childPath);
				entries.push({
					name,
					kind: entryKind(childInfo.isDirectory(), childInfo.isFile()),
				});
			} catch {
				entries.push({ name, kind: "other" });
			}
		}

		return JSON.stringify({
			path: toWorkspaceRelative(absolutePath, getWorkspaceRoot()),
			entryCount: entries.length,
			truncated: names.length > maxEntries,
			entries,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "list failed";
		if (message.includes("ENOENT")) {
			return JSON.stringify({ error: "directory not found", path: pathInput });
		}
		return JSON.stringify({ error: message, path: pathInput });
	}
}

export const LIST_DIR_TOOL_SPEC: LocalToolSpec = defineLocalTool({
	name: "list_dir",
	description: "列出工作区内目录下的文件和子目录",
	parameters: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "目录路径，默认 .（工作区根）",
			},
			max_entries: {
				type: "number",
				description: `最多返回条目数，默认 ${DEFAULT_LIST_DIR_MAX_ENTRIES}`,
			},
		},
		required: [],
	},
	execute: async (args) => executeListDir(args as ListDirArgs),
});
