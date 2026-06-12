# StoryScript 规范

Last updated: `2026-06-11`

本文档定义 Story Manager 项目的统一脚本语言规范。

规范优先级：

- `StoryScript.md` 是脚本语言的唯一规范来源
- Agent、编辑器提示和运行时实现必须保持一致
- 如果未来新增语法或权限，先更新本文档，再更新提示和运行时

---

## 1. 适用范围

StoryScript 适用于以下字段：

- `trigger_expr`
- `init_script`
- `end_script`
- `action.exec_script`
- 对白与其他模板文本中的变量插值

---

## 2. 脚本类别

### 2.1 条件脚本

适用字段：

- `trigger_expr`

规则：

- 条件脚本本质上是一个返回 `boolean` 的函数
- 条件脚本仅用于 `trigger_mode: "condition"` 的事件
- `trigger_mode: "condition"` 时，`trigger_expr` 必须为非空字符串
- 最终结果必须为 `boolean`
- `trigger_mode: "default"` 的事件不执行 `trigger_expr`

允许两种写法：

简写：

```ts
${county.level} > 0
```

完整写法：

```ts
if (${county.level} > 0) {
  return true
}

return false
```

### 2.2 过程脚本

适用字段：

- `init_script`
- `end_script`
- `action.exec_script`

规则：

- 过程脚本本质上是一个无返回值函数
- 允许使用 `return;` 提前结束
- 不要求最终返回值

### 2.3 模板文本

适用字段：

- 对白内容
- 其他文本模板字段

规则：

- 仅支持变量插值
- 不支持控制流语句
- 不解析脚本注释语法

---

## 3. 变量引用语法

### 3.1 标准写法

StoryScript 中的变量引用统一使用：

```txt
${group.row}
```

示例：

```txt
${county.level}
${player.money}
${branch.score}
${call.mama}
```

### 3.2 模板文本中的写法

对白与其他模板文本中的变量插值也统一使用 `${...}`。

示例：

```txt
县城等级已经达到 ${county.level} 级。
```

## 4. 变量空间与权限

### 4.1 全局变量

格式：

```txt
${group.row}
```

规则：

- 普通 `value` 变量：可读可写
- `calc` 变量：可读，不可写

### 4.2 系统变量

来源：

- `system_vals.json5`

规则：

- 可读
- 不可写

### 4.3 分支变量

格式：

```txt
${branch.xxx}
```

来源：

- 操作节点连接变量

规则：

- 在存在分支上下文时可读
- 在存在分支上下文时可写

### 4.4 调用参数变量

格式：

```txt
${call.xxx}
```

来源：

- `invoke` 型事件被调用时传入的参数

规则：

- 可读
- 不可写

### 4.5 临时变量

声明方式：

```ts
let localName = ...
```

规则：

- 仅在当前脚本内有效
- 可读可写
- 当前版本只允许使用 `let` 声明临时变量；`const` 和 `var` 不属于本规范

---

## 5. 语法规范

StoryScript 使用 TypeScript / JavaScript 风格的受限子集。

### 5.1 语句

必须支持：

- `let`
- 赋值语句
- `if / else`
- `switch`
- `for`
- `while`
- `break`
- `continue`
- `return`
- 块语句 `{ ... }`

### 5.2 表达式

必须支持：

- 数字、字符串、布尔、`null`
- 算术运算
- 比较运算
- 逻辑运算
- 复合赋值：`+= -= *= /= %=`
- 三元表达式
- `Math.xxx(...)`
- 一组受限的常用全局函数：`Number(...)`、`String(...)`、`Boolean(...)`、`parseInt(...)`、`parseFloat(...)`、`isNaN(...)`、`isFinite(...)`
- 一组受限的常用字符串函数：`trim(...)`、`includes(...)`、`startsWith(...)`、`endsWith(...)`、`slice(...)`、`toLowerCase(...)`、`toUpperCase(...)`
- 一组受限的常用格式化函数：`toFixed(...)`、`formatWan(...)`
- 圆括号表达式

说明：

- `Math` 仅开放白名单成员，不暴露其他全局对象
- `Math.random()` 已开放，可用于轻微随机扰动；如果需要可复现结果，仍优先使用系统变量推导的确定性扰动
- `Number`、`String`、`Boolean` 为函数调用形式，不表示开放完整构造器语义
- `parseInt` 建议显式传入第二个参数，例如 `parseInt(text, 10)`
- `isNaN`、`isFinite` 按数值转换后的结果工作
- 同时支持少量白名单方法别名：`number.toFixed(...)`、`string.trim()`、`string.includes(...)`、`string.startsWith(...)`、`string.endsWith(...)`、`string.slice(...)`、`string.toLowerCase()`、`string.toUpperCase()`
- 除上述白名单方法外，字符串处理仍应优先通过这些白名单函数完成，不支持任意对象方法调用
- `toFixed(value, digits)` 返回字符串，`digits` 范围为 `0 ~ 100`
- `formatWan(value, digits)` 返回面向中文数值展示的字符串；绝对值小于 `10000` 时返回普通数字文本，否则返回如 `12.3万`

### 5.3 注释

支持单行注释：

```ts
// 这一行不会参与执行
${player.money} += 100 // 行尾注释
```

支持块注释：

```ts
/*
  这一段不会参与执行
  ${player.money} += 100
*/
```

规则：

- 注释只适用于脚本字段
- 注释内容不参与语法解析、变量引用解析、事件调用解析
- 字符串字面量内的 `//`、`/*`、`*/` 按普通文本处理
- 块注释必须闭合
- 模板文本不解析注释语法

### 5.4 不支持语法

- `function`
- 箭头函数
- `class`
- `new`
- `this`
- `async / await`
- `import / export`
- 任意全局对象访问
- 原型链和动态反射能力
- 除白名单外的内建对象与成员访问，例如 `Date.now()`、`JSON.stringify()`、`array.map()`、`text.replace()`

---

## 6. 语义规则

### 6.1 条件脚本规则

- 最终结果必须为 `boolean`
- `trigger_expr` 必须为非空字符串
- 若使用完整写法，应保证所有执行路径满足布尔语义
- 条件脚本只读，不允许修改全局变量、系统变量、分支变量、调用参数
- 条件脚本不允许使用 `invoke_once`
- 条件脚本只开放只读背包函数：`bag_count`、`bag_has`

### 6.2 过程脚本规则

- 不要求返回值
- 可使用 `return;` 提前结束

### 6.3 赋值限制

- 禁止给 `calc` 变量赋值
- 禁止给系统变量赋值
- 禁止给 `call.xxx` 赋值

### 6.4 `invoke_once`

语法：

```ts
invoke_once pool test1 mama=${county.level}
invoke_once chain event_a mood=${county.level}
invoke_once schedule daily_tax day=${system.now_day}
invoke_once chain event_b delay_hours=6 mood=${county.level}
invoke_once pool rumor_event delay_days=1 county_id=${county.id}
invoke_once schedule monthly_tax delay_months=1
invoke_once chain anniversary_event delay_years=1
```

规则：

- `invoke_once` 为保留语句
- 用于把 `invoke` 型事件推入调度队列
- 第一个参数为目标事件类型：`chain`、`pool`、`schedule`
- 兼容旧写法：`graph`、`once`、`loop`
- 第二个参数为目标事件 `id`
- 后续参数使用 `name=expression`
- 不同步执行
- 后续参数分为两类：
  - 调用参数：会传入目标事件，目标事件内可通过 `${call.xxx}` 读取
  - 调度元参数：只影响调度，不会传入目标事件，也不会出现在 `${call.xxx}` 中
- 当前支持的调度元参数只有以下 4 个：
  - `delay_hours`
  - `delay_days`
  - `delay_months`
  - `delay_years`
- 一条 `invoke_once` 最多只允许出现一个延迟字段
- 延迟字段的表达式结果必须是 `>= 0` 的整数
- 未填写延迟字段时，表示立即进入就绪队列
- 填写延迟字段时，表示按游戏内时间进入未来调度队列
- `delay_hours` / `delay_days` 按游戏分钟直接换算
- `delay_months` / `delay_years` 按游戏内日历换算，不用固定 30 天 / 365 天近似
- 月份与年份延迟保留当前游戏内时分
- 月末溢出时按目标月最后一天截断，例如 `1990-01-31 + 1 个月 = 1990-02-28`

推荐写法：

```ts
// 立即调用
invoke_once chain tax_reward county_id=${county.id}

// 6 小时后调用
invoke_once chain tax_reward delay_hours=6 county_id=${county.id}

// 1 天后调用
invoke_once pool rumor_event delay_days=1 rumor_level=${county.level}

// 1 个月后调用
invoke_once schedule monthly_tax delay_months=1
```

### 6.5 背包函数

运行时背包是玩家存档数据，物品 id 必须来自故事的 `items.json5`。

只读函数：

```ts
bag_count("player", "item_id")
bag_has("player", "item_id", 1)
```

可写函数：

```ts
bag_add("player", "item_id", 1)
bag_remove("player", "item_id", 1)
```

规则：

- `player` 是默认主角/玩家背包 owner id
- `bag_count` 返回当前数量
- `bag_has` 返回 `boolean`
- `bag_add` 添加物品并返回添加后的数量
- `bag_remove` 在数量足够时扣除物品并返回 `true`，否则返回 `false`
- `trigger_expr` 只允许使用 `bag_count`、`bag_has`
- `init_script`、`end_script`、`action.exec_script` 可以使用四个背包函数
- 静态校验会检查字面量 `item_id` 是否存在；动态 `item_id` 在运行时检查

---

## 7. 示例

### 7.1 条件脚本

```ts
${county.level} >= 1 && ${player.money} > 1000
```

### 7.2 过程脚本

```ts
let reward = ${county.renkou} * 10
reward = Math.floor(reward / 2)

if (${player.money} < 0) {
  ${player.money} = 0
}

${player.money} += reward
```

### 7.2.1 常用函数

```ts
let rawLevel = "12"
let level = Number(rawLevel)
let safeLevel = parseInt(rawLevel, 10)
let ratio = parseFloat("3.14")
let hasBonus = Boolean(${player.is_vip})

if (isFinite(level) && !isNaN(ratio)) {
  ${player.money} += level + ratio
}
```

```ts
let rawTitle = "  新手县城人口日报  "
let normalizedTitle = trim(rawTitle)
let isDailyReport = includes(normalizedTitle, "日报")
let startsWithNewbie = startsWith(normalizedTitle, "新手")
let shortTitle = slice(normalizedTitle, 0, 4)
let upperTag = toUpperCase("vip")

if (isDailyReport && startsWithNewbie) {
  ${county.report_title} = shortTitle + "-" + upperTag
}
```

```ts
let reward = ${county.population_resident} / 10000
let rewardText = toFixed(reward, 2)
let displayText = formatWan(${county.population_resident}, 1)

${county.reward_preview} = rewardText
${county.population_display} = displayText
```

```ts
let inFudong = Number((Math.random() * 0.2 + 1).toFixed(4))
let outFudong = Number((Math.random() * 0.2 + 1).toFixed(4))
let tag = "  日报  ".trim().toUpperCase()

${county.daily_tag} = tag
```

### 7.3 分支变量

```ts
${branch.score} += 1

if (${branch.score} >= 3) {
  ${player.money} += 500
}
```

### 7.4 调用参数

```ts
if (${call.mama} > 60) {
  ${player.money} += 100
}
```

### 7.5 模板文本

```txt
老板，现在县城等级是 ${county.level}，账上还有 ${player.money}。
```

### 7.6 背包

```ts
if (!bag_has("player", "population_flow_report", 1)) {
  bag_add("player", "population_flow_report", 1)
}
```

---

## 8. 编译与运行时约束

### 8.1 编译阶段

- 脚本源码应编译为受限 IR / 字节码
- 编译阶段应检查不支持的语法节点
- 编译阶段应检查变量读写权限
- 编译阶段应检查条件脚本的返回值语义
- 编译阶段应保留源码行列映射

### 8.2 运行阶段

- 运行时只执行编译结果
- 不直接执行原生 TS / JS 字符串
- 不暴露 `window`、`globalThis`、`process`、`Function`
- 白名单内建仅开放必要能力，如 `Math`
- 所有脚本执行必须受最大步数限制
- 所有循环必须受最大迭代数限制
- `trigger_expr` 运行时按只读条件脚本执行

---

## 9. 编辑器引用规范

以下界面说明应引用本规范：

- `trigger_expr` 的 `?` 帮助
- `init_script` 的 `?` 帮助
- `end_script` 的 `?` 帮助
- `action.exec_script` 的 `?` 帮助
- 对白插值帮助

代码补全应基于以下变量空间：

- 全局变量
- 系统变量
- `branch.xxx`
- `call.xxx`
- `Math.xxx`
- `Number`
- `String`
- `Boolean`
- `parseInt`
- `parseFloat`
- `isNaN`
- `isFinite`
- `trim`
- `includes`
- `startsWith`
- `endsWith`
- `slice`
- `toLowerCase`
- `toUpperCase`
- `toFixed`
- `formatWan`
- `bag_count`
- `bag_has`
- `bag_add`
- `bag_remove`

---
