import { readFile, stat, writeFile } from "node:fs/promises";
import { defineLocalTool } from "../registry";
import type { LocalToolSpec } from "../types";
import {
	getWorkspaceRoot,
	PathSandboxError,
	resolveSafePath,
	toWorkspaceRelative,
} from "./path";

export type EditFileArgs = {
	path?: unknown;
	old_string?: unknown;
	new_string?: unknown;
	replace_all?: unknown;
	expected_mtime_ms?: unknown;
};

function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let index = 0;
	while (true) {
		const found = haystack.indexOf(needle, index);
		if (found === -1) break;
		count += 1;
		index = found + needle.length;
	}
	return count;
}

export async function executeEditFile(args: EditFileArgs): Promise<string> {
	const filePath = args.path;
	if (typeof filePath !== "string" || !filePath.trim()) {
		return JSON.stringify({ error: "path must be a non-empty string" });
	}

	const oldString = args.old_string;
	if (typeof oldString !== "string" || oldString.length === 0) {
		return JSON.stringify({ error: "old_string must be a non-empty string" });
	}

	const newString = args.new_string;
	if (typeof newString !== "string") {
		return JSON.stringify({ error: "new_string must be a string" });
	}

	const replaceAll = args.replace_all === true;
	const expectedMtimeMs =
		typeof args.expected_mtime_ms === "number" &&
		Number.isFinite(args.expected_mtime_ms)
			? Math.floor(args.expected_mtime_ms)
			: null;

	let absolutePath: string;
	try {
		absolutePath = resolveSafePath(filePath.trim());
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

		if (
			expectedMtimeMs !== null &&
			Math.floor(info.mtimeMs) !== expectedMtimeMs
		) {
			return JSON.stringify({
				error: "file changed since read (mtime mismatch)",
				path: filePath.trim(),
				expected_mtime_ms: expectedMtimeMs,
				actual_mtime_ms: Math.floor(info.mtimeMs),
			});
		}

		const original = await readFile(absolutePath, "utf-8");
		const occurrences = countOccurrences(original, oldString);

		if (occurrences === 0) {
			return JSON.stringify({
				error: "old_string not found in file",
				path: filePath.trim(),
			});
		}

		if (occurrences > 1 && !replaceAll) {
			return JSON.stringify({
				error: `old_string matches ${occurrences} times; add context or set replace_all=true`,
				path: filePath.trim(),
				matchCount: occurrences,
			});
		}

		const updated = replaceAll
			? original.split(oldString).join(newString)
			: original.replace(oldString, newString);

		await writeFile(absolutePath, updated, "utf-8");
		const afterStat = await stat(absolutePath);

		return JSON.stringify({
			path: toWorkspaceRelative(absolutePath, getWorkspaceRoot()),
			replacements: replaceAll ? occurrences : 1,
			bytesWritten: Buffer.byteLength(updated, "utf-8"),
			mtime_ms: Math.floor(afterStat.mtimeMs),
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "edit failed";
		if (message.includes("ENOENT")) {
			return JSON.stringify({ error: "file not found", path: filePath.trim() });
		}
		return JSON.stringify({ error: message, path: filePath.trim() });
	}
}

export const EDIT_FILE_TOOL_SPEC: LocalToolSpec = defineLocalTool({
	name: "edit_file",
	description:
		"在工作区内用 old_string → new_string 编辑文件；可传 read_file 返回的 mtime_ms 防并发覆盖",
	parameters: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "相对或绝对路径（须在工作区内）",
			},
			old_string: {
				type: "string",
				description: "要替换的原文（须精确匹配，含空白）",
			},
			new_string: {
				type: "string",
				description: "替换后的文本",
			},
			replace_all: {
				type: "boolean",
				description: "是否替换所有匹配（默认 false，仅允许唯一匹配）",
			},
			expected_mtime_ms: {
				type: "number",
				description: "read_file 返回的 mtime_ms，用于检测文件是否已被修改",
			},
		},
		required: ["path", "old_string", "new_string"],
	},
	execute: async (args) => executeEditFile(args as EditFileArgs),
});
