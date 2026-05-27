# Story Manager Agent Guide

## 1. 项目目的
这是一个用 `Node.js + Nuxt + Koa2` 开发的游戏网状剧情事件编辑器。

核心目标：
- 用画布可视化编辑剧情节点和连线
- 用纯 `json5` 文件保存数据，避免数据库，方便 Git 版本管理
- 支持故事基础数据、全局变量、场景、角色、地点、事件图谱
- 支持 AI 提示词生成、AI 生图、图片压缩、资源落盘

当前编辑器重点已经从“列表编辑”转向“画布编辑 + 结构化数据管理”。

## 2. 技术栈
- 前端：Nuxt 3 + Vue 3 + TypeScript
- 后端：Koa2 + TypeScript
- 文件存储：JSON5
- 图片处理：`sharp`
- AI 调用：OpenAI-compatible 接口，后端直接 `fetch`

## 3. 仓库结构
- `apps/web`：前端编辑器
- `apps/api`：Koa2 API
- `packages/core`：数据结构、schema、校验
- `packages/file-store`：JSON5 读写、资源管理、图片压缩
- `packages/shared`：前后端共享 API 类型
- `packages/compiler`：导出/编译故事数据
- `data`：全部业务数据

## 4. 数据存储结构
每个故事对应 `data/stories/<storyId>/` 目录。

故事级文件：
- `story.json5`：故事元信息
- `vals.json5`：全局变量
- `scene.json5`：场景
- `roles.json5`：角色
- `event_location.json5`：地点

事件级文件：
- `events/events.json5`：网状剧情事件
- `events/big_once_events.json5`：大事件
- `events/loop_events.json5`：循环事件

资源目录：
- `assets/background`：场景背景图
- `assets/event_location`：地点图片

## 5. 当前数据结构
### `story.json5`
故事基础信息，至少包含 `id/title/description/startEventId/tags`。

### `vals.json5`
全局变量分组结构：
```json5
{
  variables: [
    {
      name: "county",
      description: "县域",
      vals: [
        {
          name: "GDP",
          description: "GDP",
          value_type: "value",
          value: 50000000000,
          calc_rule: ""
        }
      ]
    }
  ]
}
```
- `value_type` 支持 `value` / `calc`
- `calc` 支持递归引用，最多 5 层
- `calc_rule` 支持 `{变量名}` 引用同组变量
- `calc_rule` 支持表达式和常见数学函数

### `scene.json5`
```json5
{
  ai: { compress_quality: 60 },
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

### `event_location.json5`
```json5
{
  ai: {
    compress_quality: 60,
    global_prompt: "",
    image_size: "1536x1024"
  },
  assignments: [
    {
      name: "office",
      descr: "",
      img: "",
      prompt: ""
    }
  ]
}
```

### `setting.json5`
AI 配置按文本/图像分开：
```json5
{
  ai: {
    image: { apiKey, baseUrl, model },
    text: { apiKey, baseUrl, model }
  }
}
```

## 6. 代码结构说明
### `packages/core`
负责定义和校验所有业务 schema。
重点文件：
- `src/types.ts`
- `src/schema.ts`
- `src/validate.ts`

### `packages/file-store`
负责所有 JSON5 文件的读取、写入、清理，以及资产路径处理。
关键职责：
- 读写 story / vals / scenes / roles / event locations
- 写入上传图片
- 压缩场景和地点图片
- 读取资源元数据
- 清理未引用资源

### `apps/api`
负责暴露编辑器 API：
- 故事读取/保存
- 校验
- 导出
- AI 提示词生成
- AI 生图
- 图片压缩

### `apps/web`
负责编辑器 UI：
- 故事列表
- 画布编辑
- 事件编辑弹窗
- 全局变量弹窗
- 场景弹窗
- 地点弹窗
- 设置弹窗

## 7. 当前开发进度
### 已完成
- 基础项目骨架已跑通
- 首页/编辑页可用
- 画布式剧情编辑器已实现
- 画布支持自动布局
- 支持横向叙事轴布局
- 节点编辑、创建根节点、创建子节点已实现
- 全局变量编辑已实现
- 全局变量支持分组、二级变量、`value/calc`、递归计算、表达式函数
- 场景编辑已实现
- 场景支持图片选择、压缩、质量配置
- 地点编辑已实现
- 地点支持 AI 提示词生成、AI 生图、压缩、查看图片
- 地点支持批量选择、全选、批量提示词/生图/压缩，并显示进度
- AI 设置已实现
- 文生和图生配置已分离

### 正在优化
- Windows 下图片压缩后的文件锁问题
- 批量处理体验
- 画布和节点布局细节
- 文案和交互统一

## 8. 关键行为约定
- 不使用数据库
- 不把事件拆成海量单文件，事件集合按 `events/*.json5` 聚合
- 画布以自动布局为主，不允许拖动节点
- 默认叙事轴是横向
- 场景和地点的压缩质量保存到各自 story 文件中
- 地点生成提示词时只用当前行描述，不提前拼全局提示词
- 生图时再把全局提示词和行提示词拼接

## 9. 已知问题 / 风险
- Windows 下对刚写入的 webp 文件做删除或覆盖时，可能出现 `EBUSY` / `EPERM`
- 读取图片元数据时，尽量避免 `sharp(path)` 直接持有路径句柄，优先用 buffer
- 中文界面文本之前有过编码乱码问题，后续改 UI 时要注意 UTF-8
- 批量 AI 任务可能耗时较长，需要保留进度反馈

## 10. 后续开发计划
### 短期
- 继续完善画布编辑器交互
- 继续清理布局和样式细节
- 完善事件编辑面板
- 完善校验提示和错误提示

### 中期
- 设计完整剧情事件数据结构
- 设计事件条件、变量引用、分支逻辑
- 设计场景/角色/地点与事件的关联方式
- 增强导出结构，便于游戏运行时消费

### 长期
- 完善剧情编排工作流
- 支持更大规模项目管理
- 让 Git 版本管理足够友好、可回溯、可协作

## 11. 工作习惯
- 优先直接改代码，不要只停留在方案
- Vue 使用 `<script setup lang="ts">`
- 修改文件优先用 `apply_patch`
- 避免回滚用户未要求的改动
- 遇到 Windows 文件锁，优先从文件读取/覆盖策略上修

