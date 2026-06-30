import type { ChatMessage, ToolDefinition } from "../schemas/chat";

const CODING_TOOL_HINTS: Record<string, string> = {
	read_file: "读取工作区内的文本文件（返回 mtime_ms 供 edit_file 使用）",
	grep: "在工作区内按 pattern 搜索文件内容",
	list_dir: "列出工作区目录下的文件和子目录",
	write_file: "创建或覆盖文件（REPL 会弹出 [y/N] 确认）",
	edit_file: "用 old_string → new_string 精确编辑文件（REPL 会确认）",
	run_terminal_cmd: "执行 shell 命令（REPL 会弹出 [y/N] 确认）",
};

export function buildCodingToolHint(
	toolNames: readonly string[],
): string | null {
	const relevant = toolNames.filter((name) => name in CODING_TOOL_HINTS);
	if (relevant.length === 0) return null;

	const lines = relevant.map((name) => `- ${name}: ${CODING_TOOL_HINTS[name]}`);
	return [
		"你可以通过 function calling 使用以下工具完成任务，不要仅用文字声称「无法执行」：",
		...lines,
		"读文件用 read_file，列目录用 list_dir，搜代码用 grep，改文件优先 edit_file（先 read 拿 mtime_ms），新建/整文件覆盖用 write_file，执行命令用 run_terminal_cmd。",
	].join("\n");
}

/** 在发给 LLM 的副本上追加编码工具说明，不修改持久化 history。 */
export function withCodingToolHints(
	messages: ChatMessage[],
	tools: ToolDefinition[],
): ChatMessage[] {
	const hint = buildCodingToolHint(tools.map((tool) => tool.function.name));
	if (!hint) return messages;

	const copy = messages.map((message) => ({ ...message }));
	const systemIndex = copy.findIndex((message) => message.role === "system");
	if (systemIndex >= 0) {
		const system = copy[systemIndex];
		if (!system) return copy;
		copy[systemIndex] = {
			...system,
			content: `${system.content}\n\n${hint}`,
		};
		return copy;
	}

	return [{ role: "system", content: hint }, ...copy];
}
