# Command Client

这个目录用于承载本地 `Node.js` 命令行客户端。

它的主要目标不是做一个临时试玩器，而是先验证：

- 运行时变量系统
- `calc_rule`
- `trigger_expr`
- 事件脚本
- 事件推进与分支逻辑

后续建议：

1. 先把 `packages/runtime` 作为共享运行时核心
2. 先在这里跑通命令行故事执行
3. 再让 `apps/cocos-client` 复用同一套运行时
