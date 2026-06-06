/** 每写完一段就让出事件循环，避免网关缓冲导致终端一次性刷出 */
export async function writeChunkToStdout(text: string): Promise<void> {
	if (!text) return;
	process.stdout.write(text);

	const delayMs = Number(process.env.STREAM_DELAY_MS ?? 0);
	if (Number.isFinite(delayMs) && delayMs > 0) {
		await Bun.sleep(delayMs);
		return;
	}

	await new Promise<void>((resolve) => setImmediate(resolve));
}
