# Story Manager Agent Guide

最后更新：`2026-06-03`

这份文档是给后续协作 Agent / 开发者看的“当前真实状态说明”。
如果文档和代码冲突，以这些文件为准：

- `packages/core/src/types.ts`
- `packages/core/src/schema.ts`
- `packages/core/src/vals.ts`
- `packages/core/src/validate.ts`
- `packages/file-store/src/index.ts`
- `apps/api/src/routes/stories.ts`

## 1. 项目定位

这是一个用 `Node.js + Nuxt 3 + Koa2 + JSON5` 开发的剧情编辑器。
目标不是做数据库后台，而是做：

- 可视化编辑剧情结构
- 用纯文件管理故事数据
- 让 Git 对剧情、变量、角色、地点、事件都友好
- 逐步形成“剧情 DSL + 资源生产工具 + 运行时导出”的完整链路

当前主线已经进入：

- 画布化事件编辑
- 结构化事件 DSL
- 全局变量/系统变量/脚本表达式能力
- AI 提示词与生图辅助

## 2. 技术栈

- 前端：`Nuxt 3` + `Vue 3` + `TypeScript`
- 后端：`Koa2` + `TypeScript`
- 校验：`zod`
- 存储：`JSON5`
- 图片处理：`sharp`
- 编译导出：`packages/compiler`

## 3. 仓库结构

- `apps/web`：前端编辑器
- `apps/api`：Koa API
- `packages/core`：类型、schema、变量/脚本/表达式规则、校验
- `packages/file-store`：JSON5 读写、资产落盘、图片压缩、资源清理
- `packages/compiler`：把故事文档编译成运行时 JSON
- `packages/shared`：前后端共享类型
- `data`：业务数据与应用配置

## 4. 当前故事目录结构

每个故事目录位于 `data/stories/<storyId>/`。

### 4.1 故事级文件

- `story.json5`：故事元信息
- `vals.json5`：全局变量
- `system_vals.json5`：系统变量
- `scene.json5`：场景
- `nomal_roles.json5`：普通角色
- `import_roles.json5`：重要角色
- `event_location.json5`：地点

注意：

- 当前文件名就是 `nomal_roles.json5` 和 `import_roles.json5`，虽然拼写不标准，但这是现行契约，不要擅自改名。
- `roles.json5`、`roles_setting.json5` 属于旧结构，不要恢复。

### 4.2 事件级文件

- `events/events.json5`：普通剧情推进事件画布数据，内部同时包含 `event` 节点和 `action` 节点
- `events/big_once_events.json5`：一次性大事件
- `events/loop_events.json5`：循环事件

注意：

- `actions.json5` 已不是正式结构，普通剧情里的操作节点已经并入 `events/events.json5`。

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

说明：

- `value_type` 只支持 `value` / `calc`
- `value` 模式直接存值
- `calc` 模式必须填写 `calc_rule`

### 5.3 `system_vals.json5`

系统变量与全局变量使用同一套结构，也是：

```json5
{
  variables: []
}
```

当前状态：

- 已有独立文件：`system_vals.json5`
- 编辑入口在“全局变量”按钮右侧
- 已支持读取、保存、校验、导出
- 已有独立 API：`PUT /api/stories/:storyId/system-vals`
- 当前还没有并入事件脚本 / 触发条件 / 对白占位符的引用体系与补全体系

这意味着：

- 现在系统变量是“可编辑、可保存、可校验、可导出”的
- 但还不是“事件脚本可正式引用的第二套变量命名空间”

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

规则：

- `qufen_xingbie = true` 时，实际使用男女分开的 `descr/prompt/img`
- `qufen_xingbie = false` 时，实际使用通用 `descr/prompt/img`
- `zhiye` 只用于标记，不参与提示词生成和生图

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

这一节很重要，后续改动必须与 `packages/core/src/vals.ts` 保持一致。

### 6.1 全局变量 `calc_rule`

用途：

- 只用于 `vals.json5` 或 `system_vals.json5` 中 `value_type = "calc"` 的变量

规则：

- 支持同组引用：`{rowName}`
- 支持跨组引用：`{group.row}`
- 跨组引用现在已经正式支持
- 结果必须返回有限数字
- 支持递归计算，最大嵌套深度是 `5`
- 支持常见 `Math` 函数与常量

示例：

```txt
{population} / 10000
{county.population} / 10000
Math.floor({gdp} / {population})
max({level}, 1)
```

说明：

- `{rowName}` 仍然只表示“当前组”
- 跨组时必须写完整 `{group.row}`
- 被引用的普通变量必须能转成数字
- 循环引用会报错

补全：

- `calc_rule` 编辑器会提示当前组变量与其他组变量

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
- 支持算术、比较、逻辑运算、括号、字符串字面量、`true/false/null`
- 支持常见 `Math` 函数和常量

示例：

```txt
{county.level} >= 1
Math.floor({county.level}) > 0 && {county.name_full} !== ""
{county.flag} === true
```

补全：

- 输入 `{` 后弹出变量补全
- 当前仅补全全局变量命名空间，不含系统变量

### 6.3 事件脚本 `init_script / end_script`

适用字段：

- 普通剧情事件：`init_script`、`end_script`
- 一次性大事件：`init_script`、`end_script`
- 循环事件：`init_script`、`end_script`

这不是完整 JavaScript，而是“多行脚本子集”。

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

支持特性：

- 多行
- `//` 单行注释
- 行尾分号可有可无
- 表达式里可使用：
  - `{group.row}`
  - 已声明的临时变量
  - 常见 `Math` 函数和常量
  - 数字、字符串、`true/false/null`
  - 常见算术/比较/逻辑运算

限制：

- 不能给 `calc` 变量赋值
- 不能使用 `if / else / for / while / function`
- 不能直接写代码块
- 临时变量必须先 `let`
- 保留字不能作为临时变量名

示例：

```txt
let income = {county.gdp} / 100
income = Math.floor(income)
income += 5
{county.money} = income
{county.tax} += Math.floor(income / 10)
```

补全与高亮：

- 输入 `{` 时提示全局变量
- 编辑器对 `let`、`Math`、常见函数、`true/false/null` 做关键字高亮
- 自动补全弹层会根据输入框在窗口中的位置自动翻转到上方或下方显示

### 6.4 操作节点脚本 `exec_script`

适用字段：

- 普通剧情图里的 `action.exec_script`

当前状态：

- 数据结构已支持 `vars` 与 `exec_script`
- UI 已支持连接变量表格编辑
- UI 层已为连接变量预留了补全方向

但要注意：

- `packages/core/src/vals.ts` 当前真正稳定支持的是“全局变量脚本子集”
- `branch.xxx` 这套连接变量运行时语义还没有完整落到 `core`
- 因此不要把“操作脚本已经完整支持连接变量运行时读写”写成既成事实

### 6.5 对白内容 `dialogues[].content`

当前对白支持写变量占位符：

```txt
这些年过去了，{county.name_full} 还是老样子。
```

当前状态：

- 编辑器里已支持 `{group.row}` 自动补全
- 保存时原样写入 JSON5
- 编译阶段当前不会替换成最终文案，真正插值要由后续游戏运行时处理

注意：

- 对白内容不是脚本，不支持赋值语句

## 7. 对象、说话人、地点规则

### 7.1 事件对象 `object_keys`

统一使用唯一键，而不是只存名字：

- `player`
- `normal:<角色名>`
- `important:<角色名>`

原因：

- 普通角色和重要角色允许重名

前端规则：

- 对象选择器支持搜索
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

规则：

- `speaker_type = "player"` 时，`speaker_key` 必须是 `player`
- `speaker_type = "object"` 时，`speaker_key` 必须属于当前事件的 `object_keys`

### 7.3 地点

- 地点字段保存的是地点 `name`
- UI 下拉里显示 `name - descr`
- 地点允许为空

## 8. 普通剧情图规则

### 8.1 节点类型

普通剧情图有两种节点：

- `event`
- `action`

### 8.2 连线规则

- `event -> event` 允许
- `event -> action` 允许
- `action -> event` 允许
- `action -> action` 不允许

### 8.3 操作节点约束

当前校验规则：

- 一个 `action` 只能有一个父事件
- `action` 不能从另一个 `action` 连入
- `action.next` 最多只能有一个目标

### 8.4 可达性

- `story.startEventId` 用于普通剧情图入口
- 从入口不可达的普通事件和操作节点会给 warning

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

说明：

- 文本模型与图片模型彻底分离
- 后端按请求实时读取设置

### 9.2 提示词生成

地点提示词：

- 主要基于当前地点的 `descr`

角色提示词：

- 主要基于当前角色描述字段
- 重要角色区分性别时，男女使用各自描述与提示词字段

### 9.3 生图

地点和角色生图时：

- 真正传给图片模型的是 `global_prompt + 当前行 prompt`
- 尺寸参数来自各自配置中的 `width` / `height`

当前已适配过的调用方式：

- OpenAI-compatible `/v1/images/generations`
- `mj_imagine` 特殊提交通道
- `doubao-seedream-4-0-250828` 对应 `/v1/images/generations`

### 9.4 图片压缩

地点与角色当前都保留三套路径：

- 原图：`img_raw`
- 压缩图 1：`img_compress_1`
- 压缩图 2：`img_compress_2`

重要角色区分性别时，还会分别保存男女图的原图与两套压缩图。

当前规则：

- 压缩后不删除原图
- UI 只展示原图缩略图
- 压缩图主要展示地址与尺寸信息

## 10. 编辑器当前状态

### 10.1 顶部入口

故事编辑页当前已有这些入口：

- 全局变量
- 系统变量
- 场景
- 地点
- 角色
- 设置

### 10.2 角色与地点

- 角色分为普通角色 / 重要角色两个 Tab
- 两个角色 Tab 各自维护自己的 AI 全局设置
- 地点与角色都支持：
  - AI 提示词生成
  - AI 生图
  - 双压缩质量
  - 原图缩略图查看
  - 快捷创建
- 保存后提示“已保存”，不自动关闭弹窗

### 10.3 事件编辑

- 普通剧情推进事件：全屏弹窗
- 一次性大事件：全屏弹窗
- 循环事件：全屏弹窗
- 操作节点：非全屏弹窗

### 10.4 事件类型 Tab

当前事件管理分成三个独立 Tab：

- 普通剧情推进事件
- 一次性大事件
- 定时循环事件

普通剧情推进事件与另外两类事件是独立画布，不共用同一套结构。

## 11. 当前开发进度

### 已完成

- 故事列表与故事进入编辑页
- 普通剧情推进事件 / 一次性大事件 / 循环事件 三套事件编辑入口
- 普通剧情图支持 `event` / `action` 两种节点
- 普通剧情图节点创建、编辑、删除、连线、后续节点维护
- 事件详情弹窗中的“基础信息 / 后续节点” Tab
- 一次性大事件表单与对白列表编辑
- 循环事件在一次性大事件基础上增加循环规则
- 全局变量编辑器
- `calc_rule` 的预览、校验、自动补全
- `calc_rule` 跨分组引用
- 事件触发条件布尔表达式
- 事件脚本多行、注释、变量补全、关键字高亮
- 事件脚本复合赋值：`+=`、`-=`、`*=`、`/=`、`%=`
- 普通剧情事件新增 `end_script`
- 对白内容支持全局变量占位符补全
- 普通角色 / 重要角色分文件管理
- 地点与角色支持原图、双压缩图与相关 UI
- 角色和地点快捷创建
- 系统变量文件、API、编辑入口、保存、校验、导出

### 进行中 / 待补完

- 操作节点连接变量的运行时语义
- 系统变量是否要并入脚本 / 触发条件 / 对白占位符体系
- 更完整的剧情运行时协议

## 12. 已知限制与风险

- `action.exec_script` 的连接变量运行时支持还没完全落到 `core`
- 系统变量当前还没有正式并入事件脚本 / 触发条件 / 对白补全
- 对白里的 `{group.row}` 当前只是在编辑数据里保留原文，最终插值要靠游戏运行时
- Windows 下图片覆盖删除仍可能遇到 `EBUSY` / `EPERM`，当前已做重试
- 这个项目以前出现过中文编码污染，改中文文案时必须确认文件是 UTF-8

## 13. 下一阶段建议

### 短期

- 明确系统变量是否参与脚本、触发条件、对白引用
- 补完操作节点连接变量 `branch.xxx` 的校验与执行语义
- 继续打磨普通剧情图的交互体验

### 中期

- 明确事件运行顺序、事件结束脚本、操作节点脚本、分支变量传递机制
- 丰富导出结构，方便真正游戏引擎消费

### 长期

- 形成稳定剧情 DSL
- 形成完整运行时协议
- 支持更大规模项目与更稳定的 Git 协作体验

## 14. 协作约定

- 优先直接改代码，不要只停在方案
- 改数据结构时，同时检查：
  - `packages/core/src/types.ts`
  - `packages/core/src/schema.ts`
  - `packages/core/src/validate.ts`
  - `packages/file-store/src/index.ts`
  - `apps/api/src/routes`
  - `apps/web/app/components/story`
- 前端默认使用 `<script setup lang="ts">`
- 修改文件优先使用 `apply_patch`
- 不要回滚用户没有要求回滚的内容
