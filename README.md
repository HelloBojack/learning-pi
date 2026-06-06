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

This project uses [Bun](https://bun.com) v1.3.14.
