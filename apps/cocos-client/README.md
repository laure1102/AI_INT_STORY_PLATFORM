# Cocos Client

这个目录先作为未来 `Cocos` 游戏客户端的占位应用。

当前目标不是马上接入 `Cocos Creator` 工程，而是先在 monorepo 中预留客户端位置，方便后续逐步接入：

- 共用 `packages/runtime`
- 共用运行时
- 剧情包下载与缓存
- 剧情流程驱动
- UI 展示层

建议后续演进顺序：

1. 先抽离共享运行时包
2. 先做 `Node.js` 命令行客户端验证运行时
3. 再把 `cocos-client` 接到同一套运行时上

当前这个目录只保证：

- 已纳入 `pnpm workspace`
- 可以参与 `typecheck`
- 后续可以平滑扩展
