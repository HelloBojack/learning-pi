import type { ToolRegistry } from "../registry";
import { RUN_TERMINAL_CMD_TOOL_SPEC } from "./bash";
import { GREP_TOOL_SPEC } from "./grep";
import { READ_FILE_TOOL_SPEC } from "./read-file";

export {
	getWorkspaceRoot,
	PathSandboxError,
	resolveSafePath,
	toWorkspaceRelative,
} from "./path";
export {
	executeReadFile,
	MAX_READ_FILE_BYTES,
	READ_FILE_TOOL_SPEC,
} from "./read-file";

export function registerCodingTools(registry: ToolRegistry): void {
	registry.registerLocal(READ_FILE_TOOL_SPEC);
	registry.registerLocal(GREP_TOOL_SPEC);
	registry.registerLocal(RUN_TERMINAL_CMD_TOOL_SPEC);
}
