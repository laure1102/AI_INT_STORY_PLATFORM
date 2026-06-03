# Runtime

这个包用于承载故事运行时共享能力。

当前第一步已经放入：

- 变量值解析
- `calc_rule` 计算
- `trigger_expr` 布尔表达式计算
- 事件脚本执行与校验

这部分逻辑后续会被：

- `apps/tui-client`
- `apps/cocos-client`
- `packages/core` 的校验层

共同复用。

当前说明：

- 这是第一步抽离
- 数据契约类型暂时保持最小化，后续再继续与 `core` 进一步收敛
