import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defineLocalTool } from "../registry";
import type { LocalToolSpec } from "../types";
import {
	getWorkspaceRoot,
	PathSandboxError,
	resolveSafePath,
	toWorkspaceRelative,
} from "./path";

export const MAX_WRITE_FILE_BYTES = 512 * 1024;

export type WriteFileArgs = {
	path?: unknown;
	content?: unknown;
};

export async function executeWriteFile(args: WriteFileArgs): Promise<string> {
	const filePath = args.path;
	if (typeof filePath !== "string" || !filePath.trim()) {
		return JSON.stringify({ error: "path must be a non-empty string" });
	}

	const content = args.content;
	if (typeof content !== "string") {
		return JSON.stringify({ error: "content must be a string" });
	}

	if (Buffer.byteLength(content, "utf-8") > MAX_WRITE_FILE_BYTES) {
		return JSON.stringify({
			error: `content exceeds ${MAX_WRITE_FILE_BYTES} byte limit`,
		});
	}

	let absolutePath: string;
	try {
		absolutePath = resolveSafePath(filePath.trim());
	} catch (err) {
		const message =
			err instanceof PathSandboxError ? err.message : "invalid path";
		return JSON.stringify({ error: message });
	}

	try {
		await mkdir(dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, content, "utf-8");
		const relativePath = toWorkspaceRelative(absolutePath, getWorkspaceRoot());

		return JSON.stringify({
			path: relativePath,
			bytesWritten: Buffer.byteLength(content, "utf-8"),
			createdOrUpdated: true,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "write failed";
		return JSON.stringify({ error: message, path: filePath.trim() });
	}
}

export const WRITE_FILE_TOOL_SPEC: LocalToolSpec = defineLocalTool({
	name: "write_file",
	description:
		"在工作区内创建或覆盖文本文件（需用户确认，除非 PERMISSION_MODE=accept-edits 或 yolo）",
	parameters: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "相对或绝对路径（须在工作区内）",
			},
			content: {
				type: "string",
				description: "写入的完整文件内容",
			},
		},
		required: ["path", "content"],
	},
	execute: async (args) => executeWriteFile(args as WriteFileArgs),
});
