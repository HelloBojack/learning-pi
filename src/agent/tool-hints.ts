import type { ChatMessage, ToolDefinition } from "../schemas/chat";

const CODING_TOOL_HINTS: Record<string, string> = {
	read_file: "读取工作区内的文本文件",
	grep: "在工作区内按 pattern 搜索文件内容",
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
		"当用户输入 shell 命令或要求执行命令时，应调用 run_terminal_cmd；读文件用 read_file；搜代码用 grep。",
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
