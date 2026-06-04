import { fileURLToPath } from "node:url"
import React, { useEffect, useMemo, useState } from "react"
import { Alert, ConfirmInput, Spinner, StatusMessage, TextInput } from "@inkjs/ui"
import { Box, render, Text, useApp, useInput } from "ink"
import type {
  RuntimePlayerProfileSetup,
  RuntimeStorySessionAction,
  RuntimeStoryViewModel
} from "@story-mgr/runtime"
import {
  createTuiClientApp,
  type CreateTuiClientAppOptions,
  type TuiClientApp,
  type TuiClientAppState,
  type TuiPlayerOverridePrompt,
  type TuiProfileSummary,
  type TuiSaveSlotSummary
} from "./index"

interface MenuOption {
  label: string
  value: string
}

interface MenuSelectProps {
  options: MenuOption[]
  visibleOptionCount?: number
  onSubmit: (value: string) => void
}

interface PlayerSetupDraft {
  customValues: Record<string, string>
}

interface TuiPlayerOverridePromptGroup {
  groupNo: number
  prompts: TuiPlayerOverridePrompt[]
}

interface CreatePlayerFieldState {
  promptGroups: TuiPlayerOverridePromptGroup[]
  draft: PlayerSetupDraft
}

type ScreenState =
  | { kind: "boot" }
  | { kind: "profile-menu" }
  | { kind: "create-player"; groupIndex: number; promptIndex: number; fieldState: CreatePlayerFieldState }
  | { kind: "save-menu" }
  | { kind: "save-input"; defaultSlotId: string }
  | { kind: "game" }
  | { kind: "confirm-quit" }

interface AsyncTaskState {
  label: string
  error: string | null
}

// CLI 只解析少量启动参数，其余交互都交给 Ink 界面处理。
function parseArgs(argv: string[]): CreateTuiClientAppOptions {
  const options: CreateTuiClientAppOptions = {
    storyId: "demo"
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]

    if (current === "--story" && next) {
      options.storyId = next
      index += 1
      continue
    }

    if (current === "--data-dir" && next) {
      options.dataDir = next
      index += 1
      continue
    }

    if (current === "--runtime-dir" && next) {
      options.runtimeDir = next
      index += 1
      continue
    }

    if (current === "--profile" && next) {
      options.profileId = next
      index += 1
      continue
    }

    if (current === "--slot" && next) {
      options.slotId = next
      index += 1
      continue
    }

    if (current === "--new") {
      options.autoStartNewGame = true
    }
  }

  return options
}

function createEmptyDraft(): PlayerSetupDraft {
  return {
    customValues: {}
  }
}

function buildPromptGroups(
  prompts: TuiPlayerOverridePrompt[]
): TuiPlayerOverridePromptGroup[] {
  const groups = new Map<number, TuiPlayerOverridePromptGroup>()

  for (const prompt of prompts) {
    const normalizedGroupNo = Number.isInteger(prompt.groupNo) && prompt.groupNo >= 1
      ? prompt.groupNo
      : 1
    const matchedGroup = groups.get(normalizedGroupNo)

    if (matchedGroup) {
      matchedGroup.prompts.push(prompt)
      continue
    }

    groups.set(normalizedGroupNo, {
      groupNo: normalizedGroupNo,
      prompts: [prompt]
    })
  }

  return Array.from(groups.values())
}

function getPromptGroupAt(
  promptGroups: TuiPlayerOverridePromptGroup[],
  groupIndex: number
) {
  return promptGroups[groupIndex] ?? null
}

function getPromptAt(
  promptGroups: TuiPlayerOverridePromptGroup[],
  groupIndex: number,
  promptIndex: number
) {
  const currentGroup = getPromptGroupAt(promptGroups, groupIndex)
  return currentGroup?.prompts[promptIndex] ?? null
}

function getPromptValue(draft: PlayerSetupDraft, prompt: TuiPlayerOverridePrompt | null) {
  if (!prompt) {
    return ""
  }

  return draft.customValues[prompt.varKey] ?? ""
}

function buildCreatePlayerSummaryLines(fieldState: CreatePlayerFieldState) {
  return fieldState.promptGroups.flatMap((group) => group.prompts).map((prompt) => ({
    key: prompt.varKey,
    label: prompt.label,
    value: fieldState.draft.customValues[prompt.varKey]?.trim() ?? ""
  }))
}

function buildProfileNameFromDraft(fieldState: CreatePlayerFieldState) {
  const surname = fieldState.draft.customValues["player.name_xing"]?.trim() ?? ""
  const givenName = fieldState.draft.customValues["player.name_ming"]?.trim() ?? ""
  return `${surname}${givenName}`.trim()
}

function validatePromptValue(prompt: TuiPlayerOverridePrompt, value: string) {
  if (!prompt.required) {
    return null
  }

  if (!value.trim()) {
    return `${prompt.label} 不能为空`
  }

  return null
}

function profileToOption(profile: TuiProfileSummary): MenuOption {
  const description = profile.locationLabel
    ? ` · ${profile.locationLabel}`
    : ` · ${profile.customValueCount} 个自定义变量`

  return {
    value: profile.profileId,
    label: `${profile.profileName} (${profile.profileId})${description}`
  }
}

function saveSlotToOption(saveSlot: TuiSaveSlotSummary): MenuOption {
  const eventLabel = saveSlot.activeEventId ?? "无"

  return {
    value: saveSlot.slotId,
    label: `${saveSlot.slotId} · ${saveSlot.savedAt} · 当前事件 ${eventLabel}`
  }
}

function createInteractionOptions(
  view: RuntimeStoryViewModel,
  saveSlotCount: number
): MenuOption[] {
  const interactionOptions = view.interaction?.kind === "select"
    ? view.interaction.options.map((option) => ({
        value: `action:${option.id}`,
        label: option.description ? `${option.label} · ${option.description}` : option.label
      }))
    : []

  return [
    ...interactionOptions,
    {
      value: "meta:debug",
      label: view.screen === "debug" ? "返回游戏" : "查看调试信息"
    },
    {
      value: "meta:save",
      label: `保存进度${saveSlotCount > 0 ? `（已有 ${saveSlotCount} 个存档）` : ""}`
    },
    {
      value: "meta:quit",
      label: "退出客户端"
    }
  ]
}

// Ink 依赖可交互终端；在非 TTY 环境里提前给出清晰提示，避免抛出底层 raw mode 错误。
function assertInteractiveTerminal() {
  const stdin = process.stdin
  const stdout = process.stdout
  const supportsRawMode = Boolean(stdin.isTTY && typeof stdin.setRawMode === "function")

  if (stdin.isTTY && stdout.isTTY && supportsRawMode) {
    return
  }

  throw new Error(
    [
      "tui-client 需要在可交互终端中运行。",
      "当前进程不支持 TTY raw mode，Ink 无法接管键盘输入。",
      "请直接在系统终端里运行 `pnpm tui -- --story demo`，不要放在非交互式输出环境里执行。"
    ].join("\n")
  )
}

function findPlayerName(state: TuiClientAppState) {
  const playerSetup = state.profile?.player_setup
  const fullName = playerSetup
    ? `${playerSetup.player_surname ?? ""}${playerSetup.player_given_name ?? ""}`
    : ""

  return fullName || playerSetup?.player_name || state.profile?.profile_name || "未命名角色"
}

function findLocationLabel(state: TuiClientAppState) {
  const playerSetup = state.profile?.player_setup
  if (!playerSetup) {
    return "未设置"
  }

  return [
    playerSetup.province_name,
    playerSetup.city_name,
    playerSetup.county_name
  ].filter(Boolean).join("/")
}

async function handleDispatchAction(
  app: TuiClientApp,
  action: RuntimeStorySessionAction,
  setState: (nextState: TuiClientAppState) => void
) {
  app.dispatch(action)
  setState(app.getState())
}

function MenuSelect({
  options,
  visibleOptionCount = 8,
  onSubmit
}: MenuSelectProps) {
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setActiveIndex((currentIndex) => {
      if (options.length === 0) {
        return 0
      }

      return Math.min(currentIndex, options.length - 1)
    })
  }, [options])

  useInput((input, key) => {
    if (options.length === 0) {
      return
    }

    const lowerInput = input.toLowerCase()

    if (key.upArrow || lowerInput === "w" || lowerInput === "k") {
      setActiveIndex((currentIndex) => {
        return currentIndex > 0 ? currentIndex - 1 : options.length - 1
      })
      return
    }

    if (key.downArrow || lowerInput === "s" || lowerInput === "j") {
      setActiveIndex((currentIndex) => {
        return currentIndex < options.length - 1 ? currentIndex + 1 : 0
      })
      return
    }

    if (key.return) {
      const activeOption = options[activeIndex]
      if (activeOption) {
        onSubmit(activeOption.value)
      }
      return
    }

    if (/^[1-9]$/.test(input)) {
      const nextIndex = Number.parseInt(input, 10) - 1
      const quickOption = options[nextIndex]
      if (quickOption) {
        onSubmit(quickOption.value)
      }
    }
  })

  if (options.length === 0) {
    return <Text color="yellow">当前没有可选项。</Text>
  }

  const clampedVisibleCount = Math.max(1, visibleOptionCount)
  const windowStart = Math.min(
    Math.max(0, activeIndex - Math.floor(clampedVisibleCount / 2)),
    Math.max(0, options.length - clampedVisibleCount)
  )
  const visibleOptions = options.slice(windowStart, windowStart + clampedVisibleCount)

  return (
    <Box flexDirection="column" gap={0}>
      <Text color="gray">操作：↑/↓、W/S、J/K 移动，Enter 确认，数字键 1-9 快捷选择。</Text>
      {visibleOptions.map((option, visibleIndex) => {
        const actualIndex = windowStart + visibleIndex
        const isActive = actualIndex === activeIndex
        const shortcutLabel = actualIndex < 9 ? `${actualIndex + 1}. ` : "   "

        return (
          <Text key={option.value} color={isActive ? "green" : undefined}>
            {isActive ? "> " : "  "}
            {shortcutLabel}
            {option.label}
          </Text>
        )
      })}
    </Box>
  )
}

function SummaryPanel({ state }: { state: TuiClientAppState }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} paddingY={1}>
      <Text color="cyan">故事：{state.storyId}</Text>
      <Text>阶段：{state.stage}</Text>
      <Text>Bundle：{state.bundle ? "已同步" : "未同步"}</Text>
      <Text>本地角色：{state.profiles.length}</Text>
      <Text>当前角色：{state.profile?.profile_name ?? "未选择"}</Text>
      <Text>存档数：{state.saveSlots.length}</Text>
      <Text>当前事件：{state.view?.activeEventId ?? "无"}</Text>
    </Box>
  )
}

function NotificationPanel({ notifications }: { notifications: string[] }) {
  const recentNotifications = notifications.slice(-6)

  if (recentNotifications.length === 0) {
    return null
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
      <Text color="yellow">最近消息</Text>
      {recentNotifications.map((message, index) => (
        <Text key={`${message}-${index}`}>- {message}</Text>
      ))}
    </Box>
  )
}

function BootScreen({ state, task }: { state: TuiClientAppState; task: AsyncTaskState | null }) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="green">Story Manager TUI Client</Text>
      <SummaryPanel state={state} />
      {task ? <Spinner label={task.label} /> : null}
      <NotificationPanel notifications={state.notifications} />
    </Box>
  )
}

function ProfileMenuScreen({
  state,
  onSelect
}: {
  state: TuiClientAppState
  onSelect: (value: string) => void
}) {
  const options = useMemo<MenuOption[]>(() => {
    return [
      ...state.profiles.map((profile) => profileToOption(profile)),
      {
        value: "__create__",
        label: "创建新角色"
      }
    ]
  }, [state.profiles])

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="green">选择角色</Text>
      <SummaryPanel state={state} />
      <MenuSelect
        options={options}
        visibleOptionCount={8}
        onSubmit={onSelect}
      />
      <NotificationPanel notifications={state.notifications} />
    </Box>
  )
}

function CreatePlayerScreen({
  fieldState,
  groupIndex,
  promptIndex,
  validationError,
  onDraftChange,
  onSubmit,
  onCancel
}: {
  fieldState: CreatePlayerFieldState
  groupIndex: number
  promptIndex: number
  validationError: string | null
  onDraftChange: (nextDraft: PlayerSetupDraft) => void
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const currentGroup = getPromptGroupAt(fieldState.promptGroups, groupIndex)
  const currentPrompt = getPromptAt(fieldState.promptGroups, groupIndex, promptIndex)
  const totalGroupCount = fieldState.promptGroups.length
  const totalPromptCount = fieldState.promptGroups.reduce((count, group) => count + group.prompts.length, 0)
  const completedPromptCount = fieldState.promptGroups
    .slice(0, groupIndex)
    .reduce((count, group) => count + group.prompts.length, 0) + promptIndex
  const isLastGroup = groupIndex === totalGroupCount - 1
  const isLastPromptInGroup = currentGroup ? promptIndex === currentGroup.prompts.length - 1 : false
  const isLastStep = isLastGroup && isLastPromptInGroup
  const currentValue = getPromptValue(fieldState.draft, currentPrompt)
  const summaryLines = buildCreatePlayerSummaryLines(fieldState)
  const profileName = buildProfileNameFromDraft(fieldState)

  useInput((_input, key) => {
    if (key.escape) {
      onCancel()
    }
  })

  if (!currentPrompt) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="green">创建角色</Text>
        <Alert variant="warning">当前没有可填写的玩家覆盖字段。</Alert>
        <Text color="gray">请先回到编辑器配置玩家覆盖变量，或者取消当前流程。</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="green">创建角色</Text>
      <Text color="gray">Esc 返回上一层；同分组字段会在同一个界面连续录入。</Text>
      <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} paddingY={1}>
        <Text>分组 {groupIndex + 1}/{totalGroupCount} · 分组编号 {currentGroup?.groupNo ?? 1}</Text>
        <Text>字段 {promptIndex + 1}/{currentGroup?.prompts.length ?? 1} · 总进度 {completedPromptCount + 1}/{totalPromptCount}</Text>
        <Text>{currentPrompt.label}</Text>
        {currentPrompt.tips ? <Text color="gray">{currentPrompt.tips}</Text> : null}
        {currentGroup && currentGroup.prompts.length > 1 ? (
          <Box flexDirection="column" marginBottom={1}>
            {currentGroup.prompts.map((prompt, index) => {
              const value = fieldState.draft.customValues[prompt.varKey]?.trim() ?? ""
              const isActive = index === promptIndex

              return (
                <Text key={prompt.varKey} color={isActive ? "green" : "gray"}>
                  {isActive ? "> " : "  "}
                  {prompt.label}: {value || "待输入"}
                </Text>
              )
            })}
          </Box>
        ) : null}
        <TextInput
          key={currentPrompt.varKey}
          defaultValue={currentValue}
          placeholder={currentPrompt.tips || currentPrompt.label}
          onChange={(value) => {
            onDraftChange({
              customValues: {
                ...fieldState.draft.customValues,
                [currentPrompt.varKey]: value
              }
            })
          }}
          onSubmit={onSubmit}
        />
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
        <Text>当前汇总</Text>
        {summaryLines.map((line) => (
          <Text key={line.key}>{line.label}: {line.value || "待输入"}</Text>
        ))}
        {profileName ? <Text>角色名: {profileName}</Text> : null}
      </Box>
      {validationError ? (
        <Alert variant="error">{validationError}</Alert>
      ) : null}
      <Text color="gray">{isLastStep ? "按回车完成最后一个字段并创建角色。" : "按回车保存当前字段并进入下一个字段。"}</Text>
    </Box>
  )
}

function SaveMenuScreen({
  state,
  onSelect
}: {
  state: TuiClientAppState
  onSelect: (value: string) => void
}) {
  const options = useMemo<MenuOption[]>(() => {
    return [
      {
        value: "__new__",
        label: "开始新游戏"
      },
      ...state.saveSlots.map((saveSlot) => saveSlotToOption(saveSlot))
    ]
  }, [state.saveSlots])

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="green">进入游戏</Text>
      <SummaryPanel state={state} />
      <Text>当前角色：{findPlayerName(state)}</Text>
      <Text>所在地：{findLocationLabel(state)}</Text>
      <Text color="gray">先选择继续旧存档，或直接开始新游戏。</Text>
      <MenuSelect
        options={options}
        visibleOptionCount={8}
        onSubmit={onSelect}
      />
      <NotificationPanel notifications={state.notifications} />
    </Box>
  )
}

function SaveInputScreen({
  defaultSlotId,
  error,
  onSubmit,
  onCancel
}: {
  defaultSlotId: string
  error: string | null
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel()
    }
  })

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="green">保存进度</Text>
      <Text color="gray">输入存档 ID，回车保存；Esc 返回游戏。</Text>
      <TextInput
        key={defaultSlotId}
        defaultValue={defaultSlotId}
        placeholder="请输入存档 ID"
        onSubmit={onSubmit}
      />
      {error ? (
        <Alert variant="error">{error}</Alert>
      ) : null}
    </Box>
  )
}

function GameScreen({
  state,
  onSelectOption,
  onSubmitText,
  onConfirmContinue
}: {
  state: TuiClientAppState
  onSelectOption: (value: string) => void
  onSubmitText: (value: string) => void
  onConfirmContinue: () => void
}) {
  const view = state.view

  if (!view) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="green">游戏界面</Text>
        <Alert variant="warning">当前还没有运行时视图。</Alert>
      </Box>
    )
  }

  const interactionOptions = createInteractionOptions(view, state.saveSlots.length)
  const mergedNotifications = [...state.notifications, ...view.notifications]

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="green">{view.storyTitle}</Text>
      <SummaryPanel state={state} />
      <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} paddingY={1}>
        <Text>当前事件：{view.activeEventTitle ?? view.activeEventId ?? "无"}</Text>
        {view.activeEventId ? <Text color="gray">ID: {view.activeEventId}</Text> : null}
        {view.currentLocationName ? <Text>地点：{view.currentLocationName}</Text> : null}
      </Box>
      {view.currentDialogue ? (
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} paddingY={1}>
          <Text color="cyan">
            {view.currentDialogue.speakerLabel}
            {" "}
            <Text color="gray">
              {view.currentDialogue.index}/{view.currentDialogue.total}
            </Text>
          </Text>
          <Text>{view.currentDialogue.content}</Text>
        </Box>
      ) : null}
      {view.availableBranches.length > 0 ? (
        <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} paddingY={1}>
          <Text color="magenta">可选操作</Text>
          {view.availableBranches.map((branch) => (
            <Box key={branch.id} flexDirection="column" marginTop={1}>
              <Text>{branch.title}</Text>
              <Text color="gray">ID: {branch.id}</Text>
              {branch.nextEventId ? <Text color="gray">下一事件：{branch.nextEventId}</Text> : null}
            </Box>
          ))}
        </Box>
      ) : null}
      {view.branchContextSummary.length > 0 ? (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} paddingY={1}>
          <Text color="yellow">当前分支变量</Text>
          {view.branchContextSummary.map((entry) => (
            <Text key={entry.key}>
              {entry.key}: {entry.value || "(空)"}
            </Text>
          ))}
        </Box>
      ) : null}
      {view.interaction?.kind === "select" ? (
        <Box flexDirection="column" gap={1}>
          <Text>{view.interaction.prompt}</Text>
          <MenuSelect
            options={interactionOptions}
            visibleOptionCount={8}
            onSubmit={onSelectOption}
          />
        </Box>
      ) : null}
      {view.interaction?.kind === "text-input" ? (
        <Box flexDirection="column" gap={1}>
          <Text>{view.interaction.prompt}</Text>
          <TextInput
            defaultValue={view.interaction.initialValue ?? ""}
            placeholder={view.interaction.placeholder ?? "请输入内容"}
            onSubmit={onSubmitText}
          />
        </Box>
      ) : null}
      {view.interaction?.kind === "confirm" ? (
        <Box flexDirection="column" gap={1}>
          <Text>{view.interaction.prompt}</Text>
          <ConfirmInput
            onConfirm={onConfirmContinue}
            onCancel={() => undefined}
          />
        </Box>
      ) : null}
      {view.screen === "debug" ? (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} paddingY={1}>
          <Text color="cyan">调试信息</Text>
          <Text>全局变量组数：{view.debugSummary.globalGroupCount}</Text>
          <Text>系统变量组数：{view.debugSummary.systemGroupCount}</Text>
          <Text>历史记录：{view.debugSummary.historyCount}</Text>
          <Text>已触发大事件：{view.debugSummary.triggeredBigOnceCount}</Text>
          <StatusMessage variant="info">
            调试视图已打开，可继续选择其他操作。
          </StatusMessage>
        </Box>
      ) : null}
      <NotificationPanel notifications={mergedNotifications} />
    </Box>
  )
}

function ConfirmQuitScreen({
  onConfirm,
  onCancel
}: {
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="yellow">确认退出</Text>
      <Text>是否退出当前客户端？未保存进度将会丢失。</Text>
      <ConfirmInput
        defaultChoice="cancel"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </Box>
  )
}

function App({ options }: { options: CreateTuiClientAppOptions }) {
  const { exit } = useApp()
  const [app] = useState(() => createTuiClientApp(options))
  const [state, setState] = useState<TuiClientAppState>(app.getState())
  const [screen, setScreen] = useState<ScreenState>({ kind: "boot" })
  const [task, setTask] = useState<AsyncTaskState | null>({
    label: "正在启动并同步故事数据...",
    error: null
  })
  const [validationError, setValidationError] = useState<string | null>(null)

  // 启动时统一走 bootstrap，后续界面只负责驱动控制层。
  useEffect(() => {
    let isDisposed = false

    const bootstrap = async () => {
      try {
        await app.bootstrap()
        if (isDisposed) {
          return
        }

        const nextState = app.getState()
        setState(nextState)
        setTask(null)

        if (nextState.session) {
          setScreen({ kind: "game" })
          return
        }

        if (nextState.profile) {
          setScreen({ kind: "save-menu" })
          return
        }

        setScreen({ kind: "profile-menu" })
      } catch (error) {
        if (isDisposed) {
          return
        }

        setTask({
          label: "启动失败",
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    void bootstrap()

    return () => {
      isDisposed = true
    }
  }, [app])

  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === "c") {
      exit()
    }
  })

  async function runTask(label: string, handler: () => Promise<void>) {
    setTask({ label, error: null })

    try {
      await handler()
      setTask(null)
    } catch (error) {
      setTask({
        label,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async function selectProfile(profileId: string) {
    if (profileId === "__create__") {
      await runTask("正在准备创建角色...", async () => {
        const prompts = await app.listPlayerOverridePrompts()
        const nextState = app.getState()
        setState(nextState)
        setValidationError(null)
        setScreen({
          kind: "create-player",
          groupIndex: 0,
          promptIndex: 0,
          fieldState: {
            promptGroups: buildPromptGroups(prompts),
            draft: createEmptyDraft()
          }
        })
      })
      return
    }

    await runTask("正在读取角色...", async () => {
      await app.selectProfile(profileId)
      const nextState = app.getState()
      setState(nextState)
      setScreen({ kind: "save-menu" })
    })
  }

  async function handleCreatePlayerSubmit(value: string) {
    if (screen.kind !== "create-player") {
      return
    }

    const currentPrompt = getPromptAt(
      screen.fieldState.promptGroups,
      screen.groupIndex,
      screen.promptIndex
    )
    if (!currentPrompt) {
      setValidationError("当前没有可提交的字段。")
      return
    }

    const nextDraft: PlayerSetupDraft = {
      customValues: {
        ...screen.fieldState.draft.customValues,
        [currentPrompt.varKey]: value
      }
    }
    const validationMessage = validatePromptValue(currentPrompt, value)

    if (validationMessage) {
      setValidationError(validationMessage)
      setScreen({
        kind: "create-player",
        groupIndex: screen.groupIndex,
        promptIndex: screen.promptIndex,
        fieldState: {
          ...screen.fieldState,
          draft: nextDraft
        }
      })
      return
    }

    setValidationError(null)

    const currentGroup = getPromptGroupAt(screen.fieldState.promptGroups, screen.groupIndex)
    const hasNextPromptInGroup = Boolean(
      currentGroup && screen.promptIndex < currentGroup.prompts.length - 1
    )
    const hasNextGroup = screen.groupIndex < screen.fieldState.promptGroups.length - 1

    if (hasNextPromptInGroup) {
      setScreen({
        kind: "create-player",
        groupIndex: screen.groupIndex,
        promptIndex: screen.promptIndex + 1,
        fieldState: {
          ...screen.fieldState,
          draft: nextDraft
        }
      })
      return
    }

    if (hasNextGroup) {
      setScreen({
        kind: "create-player",
        groupIndex: screen.groupIndex + 1,
        promptIndex: 0,
        fieldState: {
          ...screen.fieldState,
          draft: nextDraft
        }
      })
      return
    }

    await runTask("正在创建角色...", async () => {
      await app.createProfile({
        profileName: buildProfileNameFromDraft({
          ...screen.fieldState,
          draft: nextDraft
        }),
        customValues: nextDraft.customValues
      })
      const nextState = app.getState()
      setState(nextState)
      setScreen({ kind: "save-menu" })
    })
  }

  function updateCreatePlayerDraft(nextDraft: PlayerSetupDraft) {
    if (screen.kind !== "create-player") {
      return
    }

    setScreen({
      kind: "create-player",
      groupIndex: screen.groupIndex,
      promptIndex: screen.promptIndex,
      fieldState: {
        ...screen.fieldState,
        draft: nextDraft
      }
    })
  }

  function cancelCreatePlayer() {
    if (screen.kind !== "create-player") {
      return
    }

    if (screen.promptIndex > 0) {
      setScreen({
        kind: "create-player",
        groupIndex: screen.groupIndex,
        promptIndex: screen.promptIndex - 1,
        fieldState: screen.fieldState
      })
      return
    }

    if (screen.groupIndex > 0) {
      const previousGroup = getPromptGroupAt(screen.fieldState.promptGroups, screen.groupIndex - 1)

      setScreen({
        kind: "create-player",
        groupIndex: screen.groupIndex - 1,
        promptIndex: Math.max(0, (previousGroup?.prompts.length ?? 1) - 1),
        fieldState: screen.fieldState
      })
      return
    }

    setValidationError(null)
    setScreen({ kind: "profile-menu" })
  }

  async function selectSaveOption(value: string) {
    await runTask("正在创建运行时会话...", async () => {
      if (value === "__new__") {
        await app.startNewGame()
      } else {
        await app.loadSave(value)
      }

      const nextState = app.getState()
      setState(nextState)
      setScreen({ kind: "game" })
    })
  }

  async function handleGameSelect(value: string) {
    if (value === "meta:debug") {
      await handleDispatchAction(app, {
        type: state.view?.screen === "debug" ? "close-debug" : "open-debug"
      }, setState)
      return
    }

    if (value === "meta:save") {
      setValidationError(null)
      setScreen({
        kind: "save-input",
        defaultSlotId: `slot-${state.saveSlots.length + 1}`
      })
      return
    }

    if (value === "meta:quit") {
      setScreen({ kind: "confirm-quit" })
      return
    }

    const optionId = value.replace(/^action:/, "")
    await handleDispatchAction(app, {
      type: optionId === "continue" ? "continue" : "select-option",
      ...(optionId === "continue" ? {} : { optionId })
    } as RuntimeStorySessionAction, setState)
  }

  async function submitTextInput(value: string) {
    const interaction = state.view?.interaction
    if (!interaction || interaction.kind !== "text-input") {
      return
    }

    await handleDispatchAction(app, {
      type: "submit-text",
      field: interaction.field,
      value
    }, setState)
  }

  async function confirmInteraction() {
    await handleDispatchAction(app, { type: "continue" }, setState)
  }

  async function submitSaveSlot(slotId: string) {
    const normalizedSlotId = slotId.trim() || `slot-${state.saveSlots.length + 1}`

    await runTask("正在保存进度...", async () => {
      await app.saveToSlot(normalizedSlotId)
      const nextState = app.getState()
      setState(nextState)
      setScreen({ kind: "game" })
    })
  }

  const currentView = (() => {
    if (task?.error) {
      return (
        <Box flexDirection="column" gap={1}>
          <BootScreen state={state} task={task} />
          <Alert variant="error">{task.error}</Alert>
          <Text color="gray">按 Ctrl+C 退出，或修正问题后重新启动。</Text>
        </Box>
      )
    }

    if (task) {
      return <BootScreen state={state} task={task} />
    }

    if (screen.kind === "profile-menu") {
      return <ProfileMenuScreen state={state} onSelect={(value) => void selectProfile(value)} />
    }

    if (screen.kind === "boot") {
      return <BootScreen state={state} task={null} />
    }

    if (screen.kind === "create-player") {
      return (
        <CreatePlayerScreen
          fieldState={screen.fieldState}
          groupIndex={screen.groupIndex}
          promptIndex={screen.promptIndex}
          validationError={validationError}
          onDraftChange={updateCreatePlayerDraft}
          onSubmit={(value) => void handleCreatePlayerSubmit(value)}
          onCancel={cancelCreatePlayer}
        />
      )
    }

    if (screen.kind === "save-menu") {
      return <SaveMenuScreen state={state} onSelect={(value) => void selectSaveOption(value)} />
    }

    if (screen.kind === "save-input") {
      return (
        <SaveInputScreen
          defaultSlotId={screen.defaultSlotId}
          error={validationError}
          onSubmit={(value) => void submitSaveSlot(value)}
          onCancel={() => setScreen({ kind: "game" })}
        />
      )
    }

    if (screen.kind === "confirm-quit") {
      return (
        <ConfirmQuitScreen
          onConfirm={() => exit()}
          onCancel={() => setScreen({ kind: "game" })}
        />
      )
    }

    return (
      <GameScreen
        state={state}
        onSelectOption={(value) => void handleGameSelect(value)}
        onSubmitText={(value) => void submitTextInput(value)}
        onConfirmContinue={() => void confirmInteraction()}
      />
    )
  })()

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {currentView}
    </Box>
  )
}

// 入口只负责渲染 Ink 根组件，并等待界面主动退出。
export async function runTuiClient(argv = process.argv.slice(2)) {
  assertInteractiveTerminal()

  const options = parseArgs(argv)
  const instance = render(<App options={options} />, {
    exitOnCtrlC: true,
    patchConsole: true
  })

  await instance.waitUntilExit()
}

async function main() {
  try {
    await runTuiClient()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main()
}
