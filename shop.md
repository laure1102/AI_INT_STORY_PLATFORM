# 商城 shop 规划与开发计划

## 1. 模块定位

`shop` 是玩家在游戏内主动购买物品的商城系统。中文界面名称为“商城”，数据文件为 `shop.json5`。

商城只负责“把已有物品资产上架销售”，不负责创建物品资产。

- 物品资产库：`items.json5`
- 商城货架配置：`shop.json5`
- 玩家购买结果：运行时背包 `bags`
- 玩家购买/送礼冷却：运行时 session snapshot 的 `shop`

## 2. 设计边界

`items.json5` 负责：

- 物品 id、名称、分类、描述
- 提示词、生图、压缩图
- 物品标签、稀有度、是否可堆叠

`shop.json5` 负责：

- 商城分类
- 商品上架关系：商品 id -> 物品 id
- 价格、数量
- 展示/可购买条件
- 不可用提示
- 是否可送礼
- 送礼增加好感度
- 购买冷却、送礼冷却

## 3. 数据文件

路径：

```txt
data/stories/<storyId>/shop.json5
```

结构：

```json5
{
  currency_value_key: 'player.money',
  categories: [
    {
      id: 'daily_gifts',
      name: '人情礼品',
      sort_order: 10,
      visible_expr: '',
      descr: '',
    },
  ],
  products: [
    {
      id: 'shop_local_specialty_gift_box',
      category_id: 'daily_gifts',
      item_id: 'local_specialty_gift_box',
      price: 199,
      quantity: 1,
      sort_order: 10,
      enabled: true,
      available_expr: '',
      unavailable_reason: '',
      allow_gift: true,
      gift_favor_delta: 2,
      purchase_cooldown_hours: 0,
      gift_cooldown_hours: 24,
    },
  ],
}
```

## 4. 展示规则

分类：

- `visible_expr` 为空表示显示
- `visible_expr` 为条件脚本，返回 `true` 时显示
- 分类不可见时，其下商品不展示

商品：

- `enabled: false` 时商品下架
- `available_expr` 为空表示可购买
- `available_expr` 不满足时，商品仍显示，但灰色放到列表后面
- `unavailable_reason` 用于给玩家解释为什么暂时买不了
- 钱不够、商品冷却中、物品引用不存在时也灰显/禁止购买

## 5. 运行时状态

`shop.json5` 是故事基础配置，不写入玩家进度。

玩家个人商城状态存到 session snapshot：

```ts
shop: {
  purchases: [
    {
      product_id: string,
      purchased_count: number,
      last_purchased_game_minute: number | null,
      cooldown_until_game_minute: number | null,
    },
  ],
  gifts: [
    {
      product_id: string,
      role_key: string,
      gifted_count: number,
      last_gifted_game_minute: number | null,
      cooldown_until_game_minute: number | null,
    },
  ],
}
```

购买：

1. 检查商品存在、分类可见、商品启用
2. 检查 `available_expr`
3. 检查购买冷却
4. 检查 `currency_value_key`
5. 扣钱
6. 加入玩家背包
7. 写入购买记录和冷却

送礼：

1. 检查商品允许送礼
2. 检查玩家背包数量
3. 检查送礼冷却
4. 扣除背包物品
5. 自动加入/读取联系人
6. 增加联系人好感度
7. 写入送礼记录和冷却

## 6. StoryScript 函数

只读函数：

```ts
shop_can_buy("shop_local_specialty_gift_box")
shop_purchase_cooldown_left("shop_local_specialty_gift_box")
shop_gift_cooldown_left("shop_local_specialty_gift_box", "important:zhuli")
```

可写函数：

```ts
shop_buy("shop_local_specialty_gift_box")
shop_gift("shop_local_specialty_gift_box", "important:zhuli")
```

说明：

- `shop_can_buy` 返回当前是否可购买
- `shop_purchase_cooldown_left` 返回商品购买剩余冷却小时数
- `shop_gift_cooldown_left` 返回商品送给某联系人的剩余冷却小时数
- `shop_buy` 扣钱并把商品对应物品加入玩家背包
- `shop_gift` 从玩家背包扣除物品，并给联系人增加好感度
- 条件脚本只允许使用只读函数
- 过程脚本可以使用全部商城函数
- 静态校验会检查字面量商品 id 是否存在；动态 id 在运行时检查

## 7. 故事编辑器

第一阶段采用独立“商城”弹窗：

- 入口在故事编辑器顶部工具区
- 商品必须从物品库选择
- 可以配置商城分类
- 分类和商品条件使用 StoryScript 文本框
- 条件字段提供 `?` 规范入口和单字段校验
- 保存后写入 `shop.json5`

## 8. HTML 客户端

第一阶段：

- footer 中 `M 商城` 放在 `N 下一天` 左边
- 点击或按 `M` 打开商城弹窗
- 左侧显示商城分类
- 右侧显示商品列表
- 可购买商品可点击购买
- 不可购买商品灰显并显示原因
- 购买后扣钱、加入背包
- 已拥有且允许送礼的商品可送给手机联系人

## 9. 开发进度

- [x] `packages/core` 增加 shop 类型
- [x] `packages/core` 增加 shop schema
- [x] `packages/core` 增加 shop 校验
- [x] `packages/file-store` 支持读写 `shop.json5`
- [x] `packages/compiler` 编译 shop 配置
- [x] 故事编辑器新增“商城”配置弹窗
- [x] StoryScript 校验/补全加入商城函数
- [x] `packages/runtime` 增加商城运行时状态
- [x] `packages/runtime` 输出商城 view
- [x] `packages/runtime` 支持购买和送礼动作
- [x] `packages/runtime` 接入 `shop_*` StoryScript 函数
- [x] HTML 客户端新增 `M 商城` 弹窗
- [x] demo story 增加示例物品和 `shop.json5`
- [x] 新增 `shop.md`
- [x] 更新 `StoryScript.md`
- [x] AI 创作 Agent 接入 shop 草稿

## 10. AI 创作 Agent 接入

AI 创作 Agent 现在支持输出 `draft.shop`：

- `draft.shop.categories`：建议新增或覆盖商城分类。
- `draft.shop.products`：建议新增或覆盖商城商品。

约束：

- 商城不能直接创建物品资产。
- 商品的 `item_id` 必须引用已有 `items.json5` 物品，或本次草稿中同时生成并被应用的 `draft.items` 物品。
- 商品的 `category_id` 必须引用已有商城分类，或本次草稿中同时生成并被应用的 `draft.shop.categories` 分类。
- 分类 `visible_expr` 和商品 `available_expr` 都会按 StoryScript 条件表达式校验。
- 应用草稿时，只有用户勾选的商城分类和商品会写入 `shop.json5`。

## 11. 后续计划

- 商城支持商品搜索
- 商城支持更多货币变量或多货币
- 商品购买后触发事件
- 商品送礼后触发事件
- 编辑器中从商品直接跳转物品资产详情
