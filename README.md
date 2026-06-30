# learning-pi

![CI](https://github.com/HelloBojack/learning-pi/actions/workflows/ci.yml/badge.svg)

OpenAI 兼容网关上的 Bun + TypeScript 对话 CLI（流式 REPL、preset、会话持久化）。

## 安装

```bash
bun install
cp .env.example .env   # 填入 API_URL、API_KEY
```

## 运行

```bash
bun run dev              # 交互 REPL
bun run dev "你好"       # 单次提问
bun run build && bun start
```

## 开发

```bash
bun run lint             # Biome：格式 + lint（CI 同款）
bun run lint:fix         # 自动修复可修复项
bun run typecheck        # tsc --noEmit
bun test                 # 单元测试
bun run test:watch
```

## Coding Tools

本项目可用的编码工具：

- `read_file`：读取工作区内的文本文件
- `grep`：在工作区内搜索文件内容
- `list_dir`：列出目录下的文件和子目录
- `write_file`：创建或覆盖文件
- `edit_file`：对文件进行精确替换编辑
- `run_terminal_cmd`：在工作区内执行终端命令

### Permission Mode

`PERMISSION_MODE` 用于控制某些写入/执行类操作是否需要额外确认：

- `accept-edits`：允许编辑类操作直接执行
- `yolo`：允许写入/执行类操作尽量直接执行

未设置时，默认需要交互确认。

This project uses [Bun](https://bun.com) v1.3.14.
