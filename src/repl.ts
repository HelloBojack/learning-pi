import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chatStreamToStdout, LlmApiError } from "./llm/chat";
import type { ChatMessage } from "./schemas/chat";

const EXIT_COMMANDS = new Set(["/quit", "/exit", "/q"]);

export async function runRepl(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const history: ChatMessage[] = [];

  console.log("learning-pi 对话已启动（流式输出）");
  console.log("输入消息后回车发送，/quit 或 Ctrl+C 退出\n");

  try {
    while (true) {
      const line = (await rl.question("you> ")).trim();
      if (!line) continue;
      if (EXIT_COMMANDS.has(line.toLowerCase())) break;

      history.push({ role: "user", content: line });

      try {
        const reply = await chatStreamToStdout(history, {}, {
          prefix: "assistant> ",
        });
        console.log("\n");
        history.push({ role: "assistant", content: reply });
      } catch (err) {
        history.pop();
        if (err instanceof LlmApiError) {
          console.error(`\n[错误 ${err.status}] ${err.message}`);
          if (err.body) console.error(err.body);
        } else if (err instanceof Error) {
          console.error(`\n[错误] ${err.message}`);
        } else {
          console.error("\n[错误] 未知错误");
        }
        console.log();
      }
    }
  } finally {
    rl.close();
  }
}

export async function runOnce(prompt: string): Promise<void> {
  await chatStreamToStdout([{ role: "user", content: prompt }]);
  console.log();
}
