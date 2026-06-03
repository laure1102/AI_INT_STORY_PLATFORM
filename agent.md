# Story Manager Agent Guide

最后更新：`2026-06-03`

这份文档是给后续协作 Agent / 开发者看的“当前真实状态说明”。
如果文档和代码冲突，优先以这些文件为准：
- `packages/core/src/types.ts`
- `packages/core/src/schema.ts`
- `packages/core/src/vals.ts`
- `packages/core/src/validate.ts`
- `packages/file-store/src/index.ts`

## 1. 项目定位
这是一个用 `Node.js + Nuxt 3 + Koa2 + JSON5` 开发的剧情编辑器，目标不是做数据库后台，而是做：
- 可视化编辑剧情结构
- 用纯文件管理故事数据
- 让 Git 对剧情、变量、角色、地点、事件都友好可追踪
- 逐步形成可运行的“剧情 DSL + 资源生产工具”

当前主线已经从“列表录入工具”进入“画布编辑 + 结构化事件 DSL + AI 资源辅助生产”阶段。

## 2. 技术栈
- 前端：`Nuxt 3` + `Vue 3` + `TypeScript`
- 后端：`Koa2` + `TypeScript`
- 校验：`zod`
- 存储：`JSON5`
- 图片处理：`sharp`
- AI：后端直连模型接口，文本和图片配置分开

## 3. 仓库结构
- `apps/web`：前端编辑器
- `apps/api`：Koa API
- `packages/core`：类型、schema、表达式/脚本解析、校验
- `packages/file-store`：JSON5 读写、资源落盘、图片压缩、资产清理
- `packages/compiler`：把故事文档编译成运行时可消费结构
- `packages/shared`：共享类型
- `data`：全部业务数据和应用设置

## 4. 当前真实数据文件布局
每个故事目录为 `data/stories/<storyId>/`。

### 故事级文件
- `story.json5`：故事元信息
- `vals.json5`：全局变量
- `scene.json5`：场景
- `nomal_roles.json5`：普通角色
- `import_roles.json5`：重要角色
- `event_location.json5`：地点

注意：
- 当前文件名就是 `nomal_roles.json5` 和 `import_roles.json5`，虽然拼写不标准，但这是现行契约，不要擅自改名。
- `roles.json5`、`roles_setting.json5` 是旧结构，当前写入逻辑会清理它们，不要再恢复。

### 事件级文件
- `events/events.json5`：普通剧情推进事件画布数据，里面同时包含 `event` 节点和 `action` 节点
- `events/big_once_events.json5`：一次性大事件
- `events/loop_events.json5`：循环事件

注意：
- `actions.json5` 不是当前正式结构，普通剧情里的操作节点已经并入 `events/events.json5`。

### 资源目录
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
- `startEventId` 必须指向普通剧情图里的一个“事件节点”，不能指向操作节点。
- 如果未设置，会有校验 warning。

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

字段规则：
- `value_type` 只支持 `value` / `calc`
- `value` 模式直接存值
- `calc` 模式必须填写 `calc_rule`

### 5.3 `scene.json5`
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

说明：
- 场景目前只有一个压缩质量字段
- 场景背景分 `day_img` / `night_img`

### 5.4 `nomal_roles.json5`
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
- `zhiye` 只是标记字段，不参与提示词生成规则本身

### 5.5 `import_roles.json5`
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
      xingge: "活泼开朗",
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
- schema 会自动把不该使用的那一套字段清空

### 5.6 `event_location.json5`
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

### 5.7 普通剧情事件 `events/events.json5`
这里是一个数组，元素有两种：

#### 事件节点 `event`
```json5
{
  node_type: "event",
  id: "back_county",
  title: "回到县城",
  trigger_expr: "",
  init_script: "",
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

### 5.8 一次性大事件 `events/big_once_events.json5`
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

### 5.9 循环事件 `events/loop_events.json5`
在一次性大事件基础上增加：
```json5
loop: {
  mode: "daily" | "weekly" | "monthly" | "interval_days",
  weekday?: 1..7,
  month_day?: 1..31,
  interval_days?: >=1
}
```

## 6. 变量引用、计算、赋值、代码提示规则

这一节很重要，后续改动必须和 `packages/core/src/vals.ts` 保持一致。

### 6.1 全局变量 `calc_rule`
用途：
- 只用于 `vals.json5` 里 `value_type = "calc"` 的变量

语法规则：
- 引用格式：`{rowName}`
- 只能引用“当前变量组”里的其他变量，不能跨组
- 返回值必须是有限数字
- 支持递归计算，最大嵌套深度是 `5`
- 支持常见 `Math` 函数和常量

示例：
```txt
{population} / 10000
Math.floor({gdp} / {population})
max({level}, 1)
```

注意：
- `calc_rule` 不支持 `{group.row}`
- 被引用的普通变量必须能转成数字
- 循环引用会报错

代码提示：
- `calc_rule` 编辑器只提示当前组内的变量名

### 6.2 事件触发条件 `trigger_expr`
适用字段：
- 普通剧情事件 `trigger_expr`
- 一次性大事件 `trigger_expr`
- 循环事件 `trigger_expr`

语法规则：
- 引用格式：`{group.row}`
- 如果引用到 `calc` 变量，会先算出结果再参与表达式
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

代码提示：
- 在输入 `{` 后弹出补全
- 提示项为全部全局变量，格式是 `group.row`

### 6.3 事件脚本 `init_script / end_script`
适用字段：
- 普通剧情事件：`init_script`
- 一次性大事件：`init_script`、`end_script`
- 循环事件：`init_script`、`end_script`

当前脚本不是完整 JavaScript，而是“多行脚本子集”。

当前仅支持三种语句：
```txt
let temp = expression
temp = expression
{group.row} = expression
```

支持特性：
- 多行
- `//` 单行注释
- 行尾分号可有可无
- 表达式里可用：
  - `{group.row}`
  - 已声明的临时变量
  - 常见 `Math` 函数和常量
  - 数字、字符串、`true/false/null`
  - 常见算术/比较/逻辑运算

限制：
- 不能给 `calc` 变量赋值
- 不能使用 `if / else / for / while / function`
- 不能直接写代码块
- 不能声明保留字作为临时变量名
- 临时变量必须先 `let`，再允许重新赋值

示例：
```txt
let income = {county.gdp} / 100
income = Math.floor(income)
{county.money} = income
```

代码提示：
- 输入 `{` 时提示全局变量
- 当前脚本编辑器会对 `let`、`Math`、常见函数、`true/false/null` 做关键字高亮

### 6.4 操作节点脚本 `exec_script`
适用字段：
- 普通剧情图里的 `action.exec_script`

当前真实状态：
- 数据结构已经有 `vars` 和 `exec_script`
- UI 已支持连接变量表格
- UI 补全里会出现两类提示：
  - 全局变量：`{group.row}`
  - 连接变量：`{branch.varName}`

但要注意：
- `packages/core/src/vals.ts` 当前的脚本解释器，正式支持的仍然是“事件脚本那套子集”
- `branch.xxx` 的真正运行时/校验支持还没有完整落到 `core`
- 因此目前不要把“操作脚本已经完整支持 `{branch.xxx}` 读写”写死成既成事实

换句话说：
- UI 层已经为连接变量做了编辑和补全准备
- `core` 层对 `branch.xxx` 还需要后续补完

### 6.5 对白内容 `dialogues[].content`
当前对白内容支持写变量占位符：
```txt
这些年过去了，{county.name_full}县还是老样子。
```

当前状态：
- 编辑器里已经支持 `{group.row}` 自动补全
- 保存时原样写入 JSON5
- 编译阶段目前不会替换成最终文本，真正插值应由后续游戏运行时处理

注意：
- 对白内容不是脚本，不支持赋值语句
- 这里只是“可写占位符文本”

## 7. 对象、说话人、地点的规则

### 7.1 事件对象 `object_keys`
当前统一使用唯一键，而不是只存角色名：
- `player`
- `normal:<角色名>`
- `important:<角色名>`

原因：
- 普通角色和重要角色允许同名
- 只存 `name` 会冲突

前端规则：
- 对象选择器支持搜索、多选
- 默认内置一个选项：`player / 主角`

### 7.2 对白说话人
对白结构：
```json5
{
  speaker_type: "player" | "object",
  speaker_key: "player" | "normal:xxx" | "important:xxx",
  content: "..."
}
```

校验规则：
- `speaker_type = player` 时，`speaker_key` 必须是 `player`
- `speaker_type = object` 时，`speaker_key` 必须属于当前事件的 `object_keys`

### 7.3 地点
- 地点字段保存的是地点 `name`
- UI 下拉里显示 `name - descr`
- 地点允许为空

## 8. 普通剧情图的结构规则

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
- `story.startEventId` 用来做普通剧情图的入口
- 从入口不可达的普通事件和操作节点会给 warning

## 9. AI 与图片生成规则

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
- 文本模型和图片模型彻底分离
- 后端按请求读取设置，不再混用

### 9.2 文本提示词生成
地点提示词：
- 输入主要来自当前地点行的 `descr`
- 不直接把 `global_prompt` 提前拼进提示词生成请求

角色提示词：
- 输入主要来自当前角色描述
- 重要角色会带上 `important / xingge / gender / qufen_xingbie` 信息辅助生成

### 9.3 图片生成
地点和角色图片生成时：
- 真正传给图片模型的是 `global_prompt + 行 prompt`
- 尺寸来自各自配置文件中的 `width` / `height`

当前已接入：
- OpenAI-compatible `/v1/images/generations`
- `mj_imagine` 特殊适配：`/mj/submit/imagine` + 轮询任务
- `doubao-seedream-4-0-250828` 特殊适配：`/v1/images/generations`

### 9.4 图片压缩
地点和角色当前都保留三种资源路径：
- 原图：`img_raw`
- 压缩图 1：`img_compress_1`
- 压缩图 2：`img_compress_2`

重要角色在区分性别时，男女各自有：
- `img_male_raw / img_male_compress_1 / img_male_compress_2`
- `img_female_raw / img_female_compress_1 / img_female_compress_2`

当前规则：
- 压缩后不删除原图
- UI 主要展示原图缩略图，压缩图显示地址和尺寸信息

## 10. 当前开发进度

### 已完成
- 故事浏览与进入编辑页
- 普通剧情画布、一次性大事件、循环事件三个 Tab
- 普通剧情图支持 `event` / `action` 两种节点
- 普通剧情节点支持创建、编辑、删除、连接
- 节点编辑面板已拆分“基础信息 / 后续节点”Tab
- 一次性大事件与循环事件的独立编辑器
- 全局变量编辑器
- `calc_rule` 预览、校验、同组变量补全
- 事件触发条件、事件脚本的变量补全和关键字高亮
- 对白列表表格化编辑
- 对白内容支持 `{group.row}` 补全
- 角色系统拆分为普通角色 / 重要角色
- 角色和地点都支持宽高、双压缩质量、全局提示词
- 角色和地点支持 AI 提示词生成、AI 生图、图片压缩、资产查看
- 角色和地点支持快捷创建
- 普通剧情事件对象选择支持搜索、多选、唯一键
- 验证系统已覆盖变量、事件、地点、对象、对白、起始节点、可达性等

### 正在进行
- 完善操作节点的“连接变量”运行时语义
- 继续统一画布交互和表单体验
- 继续收敛事件 DSL 和运行时消费方式

## 11. 已知问题 / 风险
- Windows 下图片覆盖/删除仍可能遇到 `EBUSY` / `EPERM`，当前已做重试，但仍需小心
- 中文文本曾经出现过编码污染，改中文 UI 文案时必须确保文件是 UTF-8
- `GraphActionDetailPanel.vue` 的 UI 帮助文案与 `core` 真正脚本能力还没有完全对齐
- `branch.xxx` 连接变量目前是“UI 先行”，不是“核心运行时已完整支持”
- 编译器当前会保留对白里的 `{group.row}` 原文，不负责最终文本插值

## 12. 下一阶段计划

### 短期
- 补完操作节点 `branch.xxx` 的校验与执行语义
- 统一所有脚本说明文案，避免 UI 和 `core` 规则不一致
- 继续打磨普通剧情图的连线和节点交互

### 中期
- 明确事件运行顺序、事件触发、操作分支变量传递到下一个节点的机制
- 丰富导出结构，方便真正游戏引擎消费
- 增强大事件 / 循环事件与普通剧情图之间的协作方式

### 长期
- 形成完整剧情编排工作流
- 形成稳定的故事运行时协议
- 支持更大规模项目和更强的 Git 协作体验

## 13. 协作约定
- 优先直接改代码，不要只停在方案
- 修改前先看 `packages/core` 的规则，不要只看前端表单
- 改数据结构时，同时检查：
  - `packages/core/src/types.ts`
  - `packages/core/src/schema.ts`
  - `packages/core/src/validate.ts`
  - `packages/file-store/src/index.ts`
  - `apps/api/src/routes`
  - `apps/web/app/components/story`
- 前端默认使用 `<script setup lang="ts">`
- 修改文件优先用 `apply_patch`
- 不要回滚用户没有要求回滚的内容
