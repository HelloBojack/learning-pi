/** 任意权限模式下都硬拒绝的危险 shell 模式。 */
export const DANGEROUS_BASH_PATTERNS: RegExp[] = [
	/\brm\s+(-[^\s]*\s+)*-[^\s]*r[^\s]*f|\brm\s+-[^\s]*rf/i,
	/\brm\s+(-[^\s]*\s+)*\/(\s|$)/,
	/\bmkfs\b/,
	/\bdd\s+if=.*\s+of=\/dev\//i,
	/\bcurl\s+.+?\|\s*(ba)?sh\b/i,
	/\bwget\s+.+?\|\s*(ba)?sh\b/i,
	/>\s*\/dev\/sd[a-z]/i,
	/\bchmod\s+(-[^\s]*\s+)*777\b/i,
	/\bsudo\s+rm\b/i,
];

export function matchesDangerousBashCommand(command: string): boolean {
	const normalized = command.trim();
	if (!normalized) return false;
	return DANGEROUS_BASH_PATTERNS.some((pattern) => pattern.test(normalized));
}
