# Story Manager

一个基于 `Node.js + Nuxt + Koa2` 的游戏网状剧情事件编辑器。

## 结构

- `apps/web`：Nuxt 编辑器前端
- `apps/api`：Koa2 API
- `packages/core`：领域类型、Schema、校验
- `packages/file-store`：JSON5 文件读写
- `packages/compiler`：导出运行时 JSON
- `packages/shared`：前后端共享 API 类型
- `data/stories`：故事数据

## 快速开始

```bash
pnpm install
pnpm dev
```

- 前端：`http://localhost:3000`
- API：`http://localhost:4000/api`

## 数据约定

- `story.json5`：故事元信息
- `vals.json5`：全局变量
- `scene.json5`：场景信息
- `roles.json5`：角色信息
- `event_location.json5`：事件场所
- `events/events.json5`：网状剧情事件
- `events/once_events.json5`：一次性事件
- `events/loop_events.json5`：循环事件
