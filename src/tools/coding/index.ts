import type { ToolRegistry } from "../registry";
import { RUN_TERMINAL_CMD_TOOL_SPEC } from "./bash";
import { EDIT_FILE_TOOL_SPEC } from "./edit-file";
import { GREP_TOOL_SPEC } from "./grep";
import { LIST_DIR_TOOL_SPEC } from "./list-dir";
import { READ_FILE_TOOL_SPEC } from "./read-file";
import { WRITE_FILE_TOOL_SPEC } from "./write-file";

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
	registry.registerLocal(LIST_DIR_TOOL_SPEC);
	registry.registerLocal(WRITE_FILE_TOOL_SPEC);
	registry.registerLocal(EDIT_FILE_TOOL_SPEC);
	registry.registerLocal(RUN_TERMINAL_CMD_TOOL_SPEC);
}
