import { existsSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";

export class PathSandboxError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PathSandboxError";
	}
}

const DEFAULT_WORKSPACE_ROOT = process.cwd();

/** 工作区根目录；可通过 WORKSPACE_ROOT 覆盖。 */
export function getWorkspaceRoot(): string {
	const raw = process.env.WORKSPACE_ROOT?.trim();
	const resolved = resolve(
		raw && raw.length > 0 ? raw : DEFAULT_WORKSPACE_ROOT,
	);
	try {
		return realpathSync(resolved);
	} catch {
		return resolved;
	}
}

function isPathInsideRoot(resolvedPath: string, resolvedRoot: string): boolean {
	const rel = relative(resolvedRoot, resolvedPath);
	return (
		rel === "" || (!rel.startsWith("..") && !resolve(rel).startsWith(".."))
	);
}

/**
 * 将用户路径解析为工作区内的绝对路径；拒绝 `..` 逃逸出 root。
 * 若目标已存在，跟随 realpath 并再次校验（降低 symlink 绕过风险）。
 */
export function resolveSafePath(
	input: string,
	root = getWorkspaceRoot(),
): string {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new PathSandboxError("path must not be empty");
	}

	const resolvedRoot = resolve(root);
	const resolvedTarget = resolve(resolvedRoot, trimmed);

	if (!isPathInsideRoot(resolvedTarget, resolvedRoot)) {
		throw new PathSandboxError("path escapes workspace");
	}

	const realRoot = realpathSync(resolvedRoot);

	if (existsSync(resolvedTarget)) {
		const realTarget = realpathSync(resolvedTarget);
		if (!isPathInsideRoot(realTarget, realRoot)) {
			throw new PathSandboxError("path escapes workspace");
		}
		return realTarget;
	}

	return resolvedTarget;
}

/** 工作区内的相对路径（用于工具返回）。 */
export function toWorkspaceRelative(
	absolutePath: string,
	root = getWorkspaceRoot(),
): string {
	const resolvedRoot = resolve(root);
	const realRoot = existsSync(resolvedRoot)
		? realpathSync(resolvedRoot)
		: resolvedRoot;

	let resolvedTarget = resolve(absolutePath);
	if (existsSync(resolvedTarget)) {
		resolvedTarget = realpathSync(resolvedTarget);
	}

	const rel = relative(realRoot, resolvedTarget);
	return rel || ".";
}
