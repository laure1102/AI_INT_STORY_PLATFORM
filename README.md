# Story Manager

一个基于 `Node.js + Nuxt + Koa2` 的游戏网状剧情事件编辑器骨架工程。

## 当前结构

- `apps/web`：Nuxt 编辑器前端
- `apps/api`：Koa2 文件 API
- `packages/core`：领域类型、Schema、校验逻辑
- `packages/file-store`：JSON5 文件读写
- `packages/compiler`：编辑态数据导出为运行态 JSON
- `packages/shared`：前后端共享的 API 类型
- `data/stories`：故事源文件

## 快速开始

```bash
pnpm install
pnpm dev
```

- 前端默认地址：`http://localhost:3000`
- API 默认地址：`http://localhost:4000/api`

## 数据约定

- `story.json5`：故事级元信息
- `events/*.json5`：每个剧情事件一个文件
- `views/*.json5`：编辑器视图布局

当前事件结构还是临时通用形态，后续可以在此基础上细化剧情 DSL。
