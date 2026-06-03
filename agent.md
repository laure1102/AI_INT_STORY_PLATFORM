# Story Manager Agent Guide

最后更新：`2026-06-03`

这份文档是给后续协作 Agent / 开发者看的“当前真实状态说明”。
如果文档和代码冲突，以这些文件为准：

- `packages/core/src/types.ts`
- `packages/core/src/schema.ts`
- `packages/core/src/validate.ts`
- `packages/runtime/src/vals.ts`
- `packages/file-store/src/index.ts`
- `apps/api/src/routes/stories.ts`

## 1. 项目定位

这是一个用 `Node.js + Nuxt 3 + Koa2 + JSON5` 开发的剧情编辑器与剧情运行时原型工程。

当前项目已经不再只是“编辑器”：

- 编辑器负责创作、校验、资源管理、导出
- 运行时负责变量计算、脚本执行、事件推进
- 后续会有多个客户端复用同一套运行时

当前明确方向：

- 先用故事编辑器完成内容生产
- 先用 `Node.js` 命令行客户端验证运行时逻辑
- 后续再接 `Cocos` 客户端

## 2. 技术栈

- 前端：`Nuxt 3` + `Vue 3` + `TypeScript`
- 后端：`Koa2` + `TypeScript`
- 校验：`zod`
- 存储：`JSON5`
- 图片处理：`sharp`
- 工作区：`pnpm workspace`

## 3. 当前仓库分层

### 3.1 `apps`

- `apps/web`：故事编辑器前端
- `apps/api`：文件读写、导出、图片与 AI 接口
- `apps/command-client`：命令行客户端占位目录，后续用于验证运行时逻辑
- `apps/cocos-client`：Cocos 客户端占位目录，后续复用共享运行时

### 3.2 `packages`

- `packages/core`：数据类型、schema、静态校验、编辑期契约
- `packages/runtime`：运行时共享能力
- `packages/compiler`：把故事文档编译成运行时 JSON
- `packages/file-store`：JSON5 读写、资源落盘、图片压缩、资源清理
- `packages/shared`：前后端共享请求/响应类型

### 3.3 当前分层原则

`core` 负责：

- 数据结构
- schema
- 静态校验入口
- 给编辑器 / API / compiler 提供统一类型契约

`runtime` 负责：

- `calc_rule`
- `trigger_expr`
- 事件脚本执行
- 脚本校验
- 变量输入值解析

这一步已经开始落地。

当前状态：

- `packages/runtime` 已创建
- `packages/core/src/vals.ts` 现在作为对 `runtime` 的兼容转发层
- 现有编辑器和校验逻辑还可以继续通过 `@story-mgr/core` 使用这些能力

## 4. 当前故事目录结构

每个故事目录位于 `data/stories/<storyId>/`。

### 4.1 故事级文件

- `story.json5`
- `vals.json5`
- `system_vals.json5`
- `scene.json5`
- `nomal_roles.json5`
- `import_roles.json5`
- `event_location.json5`

注意：

- 当前文件名就是 `nomal_roles.json5` 和 `import_roles.json5`，虽然拼写不标准，但这是现行契约，不要擅自改名。
- `roles.json5`、`roles_setting.json5` 属于旧结构，不要恢复。

### 4.2 事件级文件

- `events/events.json5`：普通剧情推进事件画布数据，内部同时包含 `event` 节点和 `action` 节点
- `events/big_once_events.json5`：一次性大事件
- `events/loop_events.json5`：循环事件

### 4.3 资产目录

- `assets/background`
- `assets/background/raw`
- `assets/roles`
- `assets/roles/raw`
- `assets/event_location`
- `assets/event_location/raw`

## 5. 当前核心数据结构

### 5.1 `story.json5`

至少包含：

- `id`
- `title`
- `description`
- `startEventId`
- `tags`

规则：

- `startEventId` 必须指向普通剧情图里的一个事件节点，不能指向操作节点。

### 5.2 `vals.json5`

结构：

```json5
{
  variables: [
    {
      name: "county",
      description: "县域",
      vals: [
        {
          name: "level",
          description: "县域等级",
          value_type: "value",
          value: 1,
          calc_rule: ""
        }
      ]
    }
  ]
}
```

### 5.3 `system_vals.json5`

系统变量与全局变量使用同一套结构：

```json5
{
  variables: []
}
```

当前状态：

- 已有独立文件：`system_vals.json5`
- 编辑入口在“全局变量”按钮右侧
- 已支持读取、保存、校验、导出
- 当前还没有正式并入事件脚本 / 触发条件 / 对白引用与补全体系

### 5.4 `scene.json5`

结构：

```json5
{
  ai: {
    compress_quality: 60
  },
  scenes: [
    {
      level: 1,
      description: "",
      music: "",
      day_img: "",
      night_img: ""
    }
  ]
}
```

### 5.5 `nomal_roles.json5`

结构：

```json5
{
  ai: {
    width: 1024,
    height: 1024,
    global_prompt: "",
    compress_quality_1: 10,
    compress_quality_2: 40
  },
  roles: [
    {
      name: "start_suanming",
      zhiye: "算命先生",
      descr: "",
      prompt: "",
      img_raw: "",
      img_compress_1: "",
      img_compress_2: ""
    }
  ]
}
```

说明：

- 普通角色不区分性别
- `zhiye` 只是标记字段，不参与提示词生成和生图逻辑

### 5.6 `import_roles.json5`

结构：

```json5
{
  ai: {
    width: 1024,
    height: 1024,
    global_prompt: "",
    compress_quality_1: 10,
    compress_quality_2: 40
  },
  roles: [
    {
      name: "zhuli",
      zhiye: "助理",
      xingge: "",
      qufen_xingbie: true,
      descr: "",
      descr_male: "",
      descr_female: "",
      prompt: "",
      prompt_male: "",
      prompt_female: "",
      img_raw: "",
      img_compress_1: "",
      img_compress_2: "",
      img_male_raw: "",
      img_male_compress_1: "",
      img_male_compress_2: "",
      img_female_raw: "",
      img_female_compress_1: "",
      img_female_compress_2: ""
    }
  ]
}
```

### 5.7 `event_location.json5`

结构：

```json5
{
  ai: {
    width: 1024,
    height: 1024,
    global_prompt: "",
    compress_quality_1: 10,
    compress_quality_2: 40
  },
  assignments: [
    {
      name: "office_small",
      descr: "",
      prompt: "",
      img_raw: "",
      img_compress_1: "",
      img_compress_2: ""
    }
  ]
}
```

### 5.8 普通剧情事件 `events/events.json5`

这里是一个数组，元素有两种：

#### 事件节点 `event`

```json5
{
  node_type: "event",
  id: "back_county",
  title: "回到县城",
  trigger_expr: "",
  init_script: "",
  end_script: "",
  object_keys: ["player", "normal:xitong"],
  dialogues: [],
  location: "",
  next: []
}
```

#### 操作节点 `action`

```json5
{
  node_type: "action",
  id: "back_county-action-1",
  title: "询问系统",
  vars: [
    {
      name: "mood",
      descr: "分支心情",
      initial_value: "calm"
    }
  ],
  exec_script: "",
  next: []
}
```

### 5.9 一次性大事件 `events/big_once_events.json5`

结构：

```json5
{
  id: "test1",
  title: "测试大事件",
  trigger_expr: "",
  init_script: "",
  object_keys: [],
  dialogues: [],
  location: "",
  bgm: "",
  end_script: ""
}
```

### 5.10 循环事件 `events/loop_events.json5`

在一次性大事件基础上增加：

```json5
{
  loop: {
    mode: "daily" | "weekly" | "monthly" | "interval_days",
    weekday?: 1..7,
    month_day?: 1..31,
    interval_days?: >= 1
  }
}
```

## 6. 变量、表达式、脚本、补全规则

这一节很重要，后续改动必须与 `packages/runtime/src/vals.ts` 保持一致。

### 6.1 全局变量 `calc_rule`

用途：

- 用于 `vals.json5` 或 `system_vals.json5` 中 `value_type = "calc"` 的变量

规则：

- 支持同组引用：`{rowName}`
- 支持跨组引用：`{group.row}`
- 结果必须返回有限数字
- 支持递归计算，最大嵌套深度是 `5`
- 支持常见 `Math` 函数与常量

### 6.2 事件触发条件 `trigger_expr`

适用字段：

- 普通剧情事件 `trigger_expr`
- 一次性大事件 `trigger_expr`
- 循环事件 `trigger_expr`

规则：

- 引用格式：`{group.row}`
- 如果引用到 `calc` 变量，会先计算再参与表达式
- 结果必须返回 `boolean`
- 空字符串视为 `true`

### 6.3 事件脚本 `init_script / end_script`

适用字段：

- 普通剧情事件：`init_script`、`end_script`
- 一次性大事件：`init_script`、`end_script`
- 循环事件：`init_script`、`end_script`

当前支持：

```txt
let temp = expression
temp = expression
temp += expression
temp -= expression
temp *= expression
temp /= expression
temp %= expression
{group.row} = expression
{group.row} += expression
{group.row} -= expression
{group.row} *= expression
{group.row} /= expression
{group.row} %= expression
```

限制：

- 不能给 `calc` 变量赋值
- 不能使用 `if / else / for / while / function`
- 临时变量必须先 `let`

### 6.4 操作节点脚本 `exec_script`

当前状态：

- 数据结构已支持 `vars` 与 `exec_script`
- UI 已支持连接变量编辑
- 运行时对 `branch.xxx` 连接变量语义还没有完整落地

### 6.5 对白内容 `dialogues[].content`

当前支持：

- 写 `{group.row}` 占位符
- 编辑器中自动补全
- 保存时原样进入 JSON5

当前不负责：

- 最终运行时插值替换

## 7. 对象、说话人、地点规则

### 7.1 事件对象 `object_keys`

统一使用唯一键：

- `player`
- `normal:<角色名>`
- `important:<角色名>`

前端规则：

- 支持搜索
- 支持多选
- 默认内置第一个选项：`player / 主角`

### 7.2 对白说话人

结构：

```json5
{
  speaker_type: "player" | "object",
  speaker_key: "player" | "normal:xxx" | "important:xxx",
  content: "..."
}
```

### 7.3 地点

- 保存的是地点 `name`
- UI 里显示 `name - descr`
- 地点允许为空

## 8. 普通剧情图规则

### 8.1 节点类型

- `event`
- `action`

### 8.2 连线规则

- `event -> event` 允许
- `event -> action` 允许
- `action -> event` 允许
- `action -> action` 不允许

### 8.3 操作节点约束

- 一个 `action` 只能有一个父事件
- `action` 不能从另一个 `action` 连入
- `action.next` 最多只能有一个目标

## 9. AI 与图片规则

### 9.1 应用级 AI 设置

文件：`data/setting.json5`

结构：

```json5
{
  ai: {
    image: { apiKey, baseUrl, model },
    text: { apiKey, baseUrl, model }
  }
}
```

### 9.2 生图

地点和角色生图时：

- 真正传给图片模型的是 `global_prompt + 当前行 prompt`
- 尺寸参数来自各自配置中的 `width` / `height`

### 9.3 图片压缩

地点与角色当前都保留：

- 原图：`img_raw`
- 压缩图 1：`img_compress_1`
- 压缩图 2：`img_compress_2`

规则：

- 压缩后不删除原图
- UI 主要展示原图缩略图

## 10. 当前客户端规划

### 10.1 `apps/command-client`

定位：

- 本地 `Node.js` 命令行客户端
- 用来验证运行时逻辑
- 未来应直接依赖 `packages/runtime`

目标不是临时试玩器，而是：

- 跑通剧情推进
- 跑通变量系统
- 跑通脚本与条件表达式
- 承担自动化回归测试入口

### 10.2 `apps/cocos-client`

定位：

- 未来 Cocos 客户端占位目录
- 后续只做展示层与平台层接入
- 应复用 `packages/runtime`

### 10.3 长期分层目标

- 编辑器负责内容生产
- `runtime` 负责剧情语义
- `command-client` 负责命令行验证与回归测试
- `cocos-client` 负责最终游戏展示与交互

## 11. 当前开发进度

### 已完成

- 故事列表与编辑页
- 三类事件编辑入口
- 普通剧情图支持 `event` / `action`
- 变量系统、触发条件、脚本编辑
- `calc_rule` 跨分组引用
- 脚本复合赋值 `+=` / `-=` / `*=` / `/=` / `%=` 
- 系统变量文件、API、编辑入口、保存、校验、导出
- `apps/cocos-client` 占位目录
- `apps/command-client` 占位目录
- `packages/runtime` 第一阶段抽离

### 当前已完成的 runtime 抽离范围

- `calc_rule`
- `trigger_expr`
- 事件脚本执行
- 事件脚本校验
- 变量值文本解析 / 格式化

### 进行中 / 待补完

- 操作节点连接变量运行时语义
- 系统变量是否并入事件脚本 / 触发条件 / 对白引用
- `command-client` 的真实剧情执行流程
- 更完整的剧情运行时协议

## 12. 已知限制与风险

- `action.exec_script` 的连接变量运行时支持还没有完全落到 `runtime`
- 系统变量当前还没有正式并入脚本 / 触发条件 / 对白补全
- 对白里的 `{group.row}` 当前只是在编辑数据里保留原文
- 这个项目以前出现过中文编码污染，改中文文案时必须确认 UTF-8

## 13. 下一阶段建议

### 短期

- 在 `command-client` 中跑通最小故事执行链路
- 定义事件运行时上下文
- 明确系统变量是否参与脚本 / 触发条件 / 对白

### 中期

- 补完操作节点连接变量 `branch.xxx` 语义
- 让 `compiler` 导出更适合运行时消费的结构
- 让 `cocos-client` 吃同一套运行时

### 长期

- 形成稳定剧情 DSL
- 形成稳定运行时协议
- 让编辑器、CLI、Cocos 三端共用同一套剧情语义

## 14. 协作约定

- 优先直接改代码，不要只停在方案
- 改数据结构时，同时检查：
  - `packages/core`
  - `packages/runtime`
  - `packages/compiler`
  - `packages/file-store`
  - `apps/api`
  - `apps/web`
- 前端默认使用 `<script setup lang="ts">`
- 修改文件优先使用 `apply_patch`
- 不要回滚用户没有要求回滚的内容
