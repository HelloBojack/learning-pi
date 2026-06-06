import * as readline from "node:readline";
import { stdin, stdout } from "node:process";
import {
  COMMAND_PREFIX,
  formatCommand,
  getReplCommands,
  type ReplCommand,
} from "./commands";

const MAX_SUGGESTIONS = 8;

/** Ctrl+C 中断输入时抛出，由 REPL 捕获后正常退出。 */
export class ReplInterrupt extends Error {
  constructor() {
    super("REPL interrupted");
    this.name = "ReplInterrupt";
  }
}

export type SuggestingInterface = {
  question(prompt: string): Promise<string>;
  close(): void;
};

function isCommandInput(line: string): boolean {
  return line.startsWith(COMMAND_PREFIX);
}

function commandFragment(line: string): string {
  if (line.startsWith(COMMAND_PREFIX)) return line.slice(COMMAND_PREFIX.length);
  return "";
}

function filterByFragment(
  fragment: string,
  commands: ReplCommand[],
): ReplCommand[] {
  const q = fragment.toLowerCase();
  return commands.filter((item) => item.id.startsWith(q));
}

function visibleWindow<T>(items: T[], selectedIndex: number, size: number): {
  items: T[];
  start: number;
} {
  if (items.length <= size) {
    return { items, start: 0 };
  }
  let start = selectedIndex - Math.floor(size / 2);
  start = Math.max(0, start);
  start = Math.min(start, items.length - size);
  return { items: items.slice(start, start + size), start };
}

/**
 * 带 / 命令提示的输入：
 * - 输入 / 后下方显示候选
 * - ↑ / ↓ 切换选中项，Enter 确认，Tab 补全当前选中项
 */
export function createSuggestingInterface(): SuggestingInterface {
  const commands = getReplCommands();
  let closed = false;
  let asking = false;
  let resolveQuestion: ((value: string) => void) | null = null;
  let rejectQuestion: ((reason: ReplInterrupt) => void) | null = null;

  let promptText = "you> ";
  let line = "";
  /** 仅随用户键入更新，用于筛选；方向键切换时不改，避免列表缩成一项 */
  let filterFragment = "";
  let selectedIndex = 0;
  let matches: ReplCommand[] = [];
  let panelOpen = false;

  readline.emitKeypressEvents(stdin);
  const wasRaw = stdin.isRaw ?? false;
  let inputActive = false;
  let released = false;

  function beginInput(): void {
    if (inputActive) return;
    inputActive = true;
    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();
  }

  function endInput(): void {
    if (!inputActive) return;
    inputActive = false;
    clearPanel();
    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(wasRaw);
    }
    stdin.pause();
  }

  function releaseTerminal(): void {
    if (released) return;
    released = true;
    endInput();
    stdin.off("keypress", onKeypress);
    stdin.unref?.();
  }

  function syncMatches(): void {
    if (!isCommandInput(line)) {
      matches = [];
      return;
    }
    matches = filterByFragment(filterFragment, commands);
    if (matches.length === 0) {
      selectedIndex = 0;
      return;
    }
    selectedIndex = Math.min(selectedIndex, matches.length - 1);
  }

  function clearPanel(): void {
    if (!panelOpen) return;
    stdout.write("\x1B[u");
    stdout.write("\x1B[J");
    panelOpen = false;
  }

  function drawPanel(): void {
    if (!isCommandInput(line) || matches.length === 0) {
      clearPanel();
      return;
    }

    stdout.write("\x1B[s");

    const { items: shown, start } = visibleWindow(
      matches,
      selectedIndex,
      MAX_SUGGESTIONS,
    );

    stdout.write("\n");
    for (let i = 0; i < shown.length; i += 1) {
      const item = shown[i]!;
      const absoluteIndex = start + i;
      const selected = absoluteIndex === selectedIndex;
      const color = selected ? "\x1b[36m\x1b[1m" : "\x1b[90m";
      const marker = selected ? "› " : "  ";
      stdout.write(
        `${marker}${color}${formatCommand(item.id)}\x1b[0m  ${item.label}\n`,
      );
    }

    const hint =
      matches.length > MAX_SUGGESTIONS
        ? `↑↓ 选择 · ${selectedIndex + 1}/${matches.length} · Enter 确认`
        : "↑↓ 选择 · Enter 确认 · Tab 补全";
    stdout.write(`  \x1b[90m${hint}\x1b[0m\n`);

    stdout.write("\x1B[u");
    readline.cursorTo(stdout, promptText.length + line.length);
    panelOpen = true;
  }

  function redraw(): void {
    clearPanel();

    readline.cursorTo(stdout, 0);
    readline.clearLine(stdout, 0);
    stdout.write(promptText + line);

    syncMatches();
    drawPanel();
  }

  function applySelectedToLine(): void {
    const item = matches[selectedIndex];
    if (!item) return;
    line = formatCommand(item.id);
    // filterFragment 仅随用户键入更新；方向键不改，避免列表缩成一项
  }

  function finishQuestion(answer: string): void {
    endInput();
    stdout.write("\n");
    asking = false;
    const resolve = resolveQuestion;
    resolveQuestion = null;
    rejectQuestion = null;
    line = "";
    filterFragment = "";
    selectedIndex = 0;
    matches = [];
    resolve?.(answer);
  }

  function onKeypress(str: string | undefined, key: readline.Key): void {
    if (!asking || closed) return;

    if (key.ctrl && key.name === "c") {
      endInput();
      stdout.write("\n");
      asking = false;
      const reject = rejectQuestion;
      resolveQuestion = null;
      rejectQuestion = null;
      reject?.(new ReplInterrupt());
      return;
    }

    if (key.name === "return" || key.name === "enter") {
      finishQuestion(line.trim());
      return;
    }

    const menuOpen = isCommandInput(line) && matches.length > 0;

    if (menuOpen && key.name === "up") {
      selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
      applySelectedToLine();
      redraw();
      return;
    }

    if (menuOpen && key.name === "down") {
      selectedIndex = (selectedIndex + 1) % matches.length;
      applySelectedToLine();
      redraw();
      return;
    }

    if (menuOpen && key.name === "tab") {
      applySelectedToLine();
      redraw();
      return;
    }

    if (key.name === "backspace") {
      line = line.slice(0, -1);
      filterFragment = isCommandInput(line)
        ? commandFragment(line).toLowerCase()
        : "";
      selectedIndex = 0;
      redraw();
      return;
    }

    if (str && !key.ctrl && !key.meta) {
      line += str;
      filterFragment = isCommandInput(line)
        ? commandFragment(line).toLowerCase()
        : "";
      selectedIndex = 0;
      redraw();
    }
  }

  stdin.on("keypress", onKeypress);

  return {
    question(prompt: string): Promise<string> {
      if (asking) {
        return Promise.reject(new Error("Already waiting for input"));
      }
      asking = true;
      promptText = prompt;
      line = "";
      filterFragment = "";
      selectedIndex = 0;
      matches = [];
      panelOpen = false;
      stdout.write(prompt);
      beginInput();
      return new Promise((resolve, reject) => {
        resolveQuestion = resolve;
        rejectQuestion = reject;
      });
    },
    close() {
      if (closed) return;
      closed = true;
      if (asking) {
        asking = false;
        resolveQuestion = null;
        rejectQuestion = null;
      }
      releaseTerminal();
    },
  };
}
