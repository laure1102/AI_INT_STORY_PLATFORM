# 行动 doing 规划与开发计划

Last updated: `2026-06-16`

## 1. 功能目标

`doing` 是玩家主动发起事件的系统。中文界面名称为“行动”，数据文件为 `doing.json5`。

它解决的问题是：玩家不只能被动等待剧情、AI 导演、条件事件或定时事件触发，而是可以主动选择“我要去哪里、找谁、做什么”。

典型场景：

- 娱乐：KTV、会所、酒吧、饭局
- 政务：去县政府、拜访县长、开协调会
- 社交：约朋友吃饭、拜访 NPC、送礼
- 购物：买车、买房、买奢侈品
- 产业：查看项目、推动招商、安排建设
- 临时行动：NPC 通过剧情或联系人消息开启“去县长办公室”等短期入口

## 2. 模块边界

`doing` 与现有事件系统的关系：

- `chains.json5`：链式剧情线，适合连续剧情推进
- `pool_events.json5`：平面事件池，适合系统/AI 导演挑选
- `schedule_events.json5`：定时规则事件，适合按游戏时间触发
- `doing.json5`：玩家主动行动，适合菜单选择后立即进入事件

`doing` 的行动事件复用平面事件池的事件内容和执行字段。也就是说，行动里的 `id`、`title`、`init_script`、`object_keys`、`presentation`、`location`、`bgm`、`end_script` 与平面事件池保持同一套语义。

行动不配置 `trigger_mode`、`trigger_expr`、`invoke_params`。行动只有一种触发方式：玩家从行动菜单主动选择，或脚本解锁后由玩家从菜单选择。入口是否显示由 `visible_expr` 决定。

在此基础上，行动额外拥有：

- 菜单树
- 显示条件
- 解锁/锁定状态
- 冷却
- 一次性行动
- 玩家主动触发入口

## 3. 数据文件

新增文件：

```txt
data/stories/<storyId>/doing.json5
```

首版结构：

```json5
{
  menus: [
    {
      id: "entertainment",
      title: "娱乐",
      parent_id: "",
      sort_order: 10,
      visible_expr: "",
      descr: ""
    }
  ],
  doings: [
    {
      id: "go_ktv",
      title: "去KTV放松一下",
      menu_id: "entertainment",
      descr: "",
      visible_expr: "",
      cooldown_hours: 0,
      once: false,
      init_script: "",
      object_keys: [],
      presentation: {
        type: "dialogue",
        dialogues: []
      },
      location: "",
      bgm: "",
      end_script: ""
    }
  ]
}
```

## 4. 字段规则

### 4.1 menus

- `id`：菜单 id，必须唯一
- `title`：菜单显示名
- `parent_id`：父菜单 id，空字符串表示根菜单
- `sort_order`：同级排序，越小越靠前
- `visible_expr`：条件脚本，返回 `true` 时显示；空字符串表示显示
- `descr`：编辑器备注，不参与运行时逻辑

### 4.2 doings

行动事件字段分为两层：

- 事件内容字段：复用平面事件池的内容和执行语义，但不包含触发方式字段
- 行动元信息字段：用于菜单、显示、冷却和一次性状态

事件内容字段：

- `id`：行动 id，必须唯一
- `title`：行动显示名
- `init_script`：进入行动时执行
- `object_keys`：参与对象，规则同平面事件池
- `presentation`：事件表现，规则同平面事件池
- `location`：地点 id
- `bgm`：进入行动事件时使用的背景音乐；空字符串表示不指定
- `end_script`：行动结束时执行

行动元信息字段：

- `menu_id`：所属菜单 id
- `descr`：编辑器备注
- `visible_expr`：条件脚本，返回 `true` 时显示；空字符串表示显示
- `cooldown_hours`：执行后冷却的游戏小时数，`0` 表示无冷却
- `once`：是否只能执行一次

## 5. 解锁模型

第一阶段采用“预设行动 + 运行时解锁/锁定”的方式。

不做脚本动态创建完全陌生的行动。所有可被解锁的行动都应先写在 `doing.json5` 中。

推荐写法：

```json5
{
  id: "visit_mayor_office",
  title: "去县长办公室",
  menu_id: "official",
  visible_expr: "doing_has(\"visit_mayor_office\")",
  cooldown_hours: 0,
  once: false
}
```

联系人消息或剧情脚本中：

```ts
doing_unlock("visit_mayor_office")
```

## 6. 运行时状态

`doing.json5` 是故事基础配置；玩家个人进度存在 session snapshot 中，不写回 `doing.json5`。

建议状态结构：

```ts
interface RuntimeDoingState {
  unlocked_ids: string[]
  locked_ids: string[]
  records: RuntimeDoingRecord[]
}

interface RuntimeDoingRecord {
  id: string
  used_count: number
  last_used_game_minute: number | null
  cooldown_until_game_minute: number | null
}
```

语义：

- `unlocked_ids`：脚本显式解锁过的行动
- `locked_ids`：脚本显式锁定过的行动，优先级高于解锁
- `records`：行动使用次数和冷却记录
- `doing_has(id)` 应返回“该行动当前被解锁且未被显式锁定”

## 7. StoryScript 函数

第一阶段新增：

只读函数：

```ts
doing_has("visit_mayor_office")
doing_used_count("go_ktv")
doing_cooldown_left("go_ktv")
```

可写函数：

```ts
doing_unlock("visit_mayor_office")
doing_lock("visit_mayor_office")
doing_set_cooldown("go_ktv", 24)
```

规则：

- `doing_has`、`doing_used_count`、`doing_cooldown_left` 可用于条件脚本
- `doing_unlock`、`doing_lock`、`doing_set_cooldown` 只允许用于过程脚本
- 字面量 `doing_id` 必须在 `doing.json5` 中存在
- 动态 `doing_id` 在运行时检查

## 8. 运行时执行流程

玩家点击行动后：

1. 读取 `doing.json5` 中的行动定义
2. 检查菜单和行动的 `visible_expr`
3. 检查显式锁定状态
4. 检查 `once`
5. 检查冷却
6. 创建 `source_type: "doing"` 的前台事件队列项
7. 按普通事件流程执行 `init_script`、`presentation`、`end_script`
8. 行动完成后更新 `used_count`、`last_used_game_minute`、`cooldown_until_game_minute`

## 9. 编辑器设计

故事编辑器新增同级 tab：`行动`。

位置：

```txt
链式剧情线 / 平面事件池 / 定时规则事件 / 行动
```

第一阶段已实现为事件编辑区同级 tab：`行动`，位置在 `定时规则事件` 之后。

当前界面：

- `菜单树` 子页：以表格维护菜单
- `行动列表` 子页：像平面事件池一样以卡片浏览行动，点击卡片或编辑按钮打开详情弹窗
- 行动详情弹窗直接复用平面事件池 `OnceEventDetailPanel`
- 行动事件详情复用平面事件池布局：`menu_id`、`cooldown_hours`、`once` 压缩在基础信息面板内维护；`visible_expr` 放在原“触发方式”位置维护；`descr` 仍是数据层备注字段，当前不在行动事件详情里展示
- `visible_expr` 提供 `?` 规范入口、单字段校验按钮和 StoryScript 变量/函数补全
- 行动事件内容的脚本、对象、地点、事件表现、AI 补对白等能力与平面事件池保持一致

后续可继续演进成三栏界面：

- 左侧：菜单树
- 中间：当前菜单下行动列表
- 右侧：行动详情编辑

菜单编辑字段：

- id
- title
- parent_id
- sort_order
- visible_expr
- descr

行动编辑字段：

- id
- title
- menu_id
- descr
- visible_expr
- cooldown_hours
- once
- location
- object_keys
- init_script
- presentation
- end_script

## 10. HTML 客户端设计

底部增加：

```txt
D 行动
```

交互：

- 点击或按 `D` 打开行动弹窗
- 左侧显示菜单树
- 右侧显示当前菜单下行动
- 可执行行动可点击进入
- 不可执行行动灰显，并显示不可用原因
- 执行行动后关闭弹窗，进入行动对应事件

## 11. 第一阶段开发计划

### Phase 1.1 数据契约

- [x] `packages/core` 增加 doing 类型
- [x] `packages/core` 增加 doing schema
- [x] `packages/core` 增加 doing 校验
- [x] `packages/file-store` 支持读写 `doing.json5`
- [x] demo story 增加 `doing.json5`

### Phase 1.2 编译器

- [x] `packages/compiler` 读取 doing 数据
- [x] `CompiledStory` 增加 doing 配置
- [x] 编译期校验菜单引用、地点引用、对象引用、脚本字段

### Phase 1.3 运行时

- [x] session snapshot 增加 doing 状态
- [x] 运行时输出可见/可执行行动视图
- [x] 运行时支持触发 `source_type: "doing"` 事件
- [x] 运行时记录 used_count 和 cooldown
- [x] StoryScript 接入 `doing_*` 函数

### Phase 1.4 编辑器

- [x] 故事编辑器新增 `行动` tab
- [x] 菜单树增删改
- [x] 行动列表增删改
- [x] 行动详情支持事件表现、地点、对象、脚本字段
- [x] 条件/脚本校验按钮支持 doing 字段
- [x] 条件/脚本补全提示和对象多选支持 doing 字段
- [x] 行动列表采用卡片浏览 + 详情弹窗编辑，贴近平面事件池体验
- [x] 条件/脚本字段提供 `?` 入口跳转 StoryScript 规范
- [x] 行动详情复用平面事件池详情面板，事件本体不再维护第二套编辑 UI

### Phase 1.5 HTML 客户端

- [x] 底部新增 `D 行动`
- [x] 行动弹窗显示菜单树和行动列表壳
- [x] 支持点击行动进入事件
- [x] 支持灰显不可用行动和原因提示
- [x] 支持快捷键 `d`

### Phase 1.6 文档与验证

- [x] 新增 `doing.md`
- [x] 更新 `StoryScript.md`
- [x] 更新 `agent.md`
- [x] 增加基础运行验证

## 12. 暂不做

第一阶段暂不做：

- 脚本动态创建全新行动
- 行动菜单拖拽排序
- 复杂行动推荐/AI 排序
- 行动历史日志 UI
- 行动与 AI 剧情导演的训练数据导出

## 13. 后续方向

- [x] Agent 生成剧情时可自动生成 doing 草稿
- [x] 联系人消息、对白选项、事件脚本可通过 `doing_unlock` 解锁预设行动
- doing 可作为 AI 剧情导演的候选入口之一
- 做行动消耗、收益预览
- 按地点、角色、时间、好感度动态推荐行动

## 14. AI 创作 Agent 接入状态

- Agent 会读取现有 `doing.json5` 的菜单树和行动列表。
- 新增玩家主动入口时，Agent 输出 `draft.doing.menus` 和 `draft.doing.doings`。
- 创作结果界面可以预览、勾选行动菜单和行动事件。
- 应用草稿时，选中的菜单和行动会写入 `doing.json5`。
- doing 行动不配置 `trigger_mode`、`trigger_expr`、`invoke_params`；显示条件使用 `visible_expr`，触发只来自菜单选择。
