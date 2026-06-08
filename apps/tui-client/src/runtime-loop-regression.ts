import path from "node:path"
import { fileURLToPath } from "node:url"
import { compileStory } from "@story-mgr/compiler"
import type {
  StoryOnceDialogueDefinition,
  StoryOnceEventFile,
  StoryEventTriggerMode,
  StoryLoopEventFile,
  StoryValDefinition,
  StoryValEntryDefinition,
  StoryValsFile
} from "@story-mgr/core"
import { createStoryFileStore } from "@story-mgr/file-store"
import {
  createStorySession,
  evaluateStoryValCalcRule,
  type RuntimeStoryBundle,
  type RuntimeStorySession
} from "@story-mgr/runtime"

const DEFAULT_STORY_ID = "demo"
const DEFAULT_LOOP_EVENT_ID = "daily_money"
const REGRESSION_NOW = "2026-06-05T00:00:00.000Z"
const MINUTES_PER_DAY = 24 * 60
const ONE_GAME_DAY_MS = 24 * 60 * 60 * 1000

interface DemoRegressionResult {
  kind: "demo-daily"
  storyId: string
  loopEventId: string
  bootstrapSteps: number
  moneyBeforeLoop: number
  dayGiveMoney: number
  moneyAfterLoop: number
  afterDay: number
  afterHour: number
  afterMinute: number
  notifications: string[]
}

interface SyntheticRegressionScenario {
  id: string
  title: string
  nowDate: string
  nowDay: number
  advanceDays: number
  initialMoney: number
  loopEvents: StoryLoopEventFile[]
  expectedMoney: number
  expectedDay: number
  expectedHour?: number
  expectedMinute?: number
  expectedLoopStates: Array<{
    eventId: string
    triggerCount: number
    lastTriggeredDay: number
    lastTriggeredMinute: number
    nextDueMinute: number
  }>
  expectedNotificationOrder?: string[]
}

interface SyntheticRegressionResult {
  kind: "synthetic"
  scenarioId: string
  scenarioTitle: string
  moneyBeforeLoop: number
  moneyAfterLoop: number
  afterDay: number
  afterHour: number
  afterMinute: number
  notifications: string[]
}

interface GraphQueueRegressionResult {
  kind: "graph-queue"
  scenarioId: string
  scenarioTitle: string
  moneyBeforeFlow: number
  moneyAfterFlow: number
  notifications: string[]
}

interface GraphQueueRegressionScenario {
  id: string
  title: string
  playerValues: Record<string, unknown>
  graphNodes: Array<RegressionGraphEventNode | RegressionGraphActionNode>
  onceEvents?: StoryOnceEventFile[]
  expectedMoney: number
  expectedConsumedRootIds?: string[]
  expectedTriggeredOnceIds?: string[]
  expectedNotificationOrder?: string[]
}

interface LoopSkipRegressionResult {
  kind: "loop-skip"
  scenarioId: string
  scenarioTitle: string
  moneyBeforeLoop: number
  moneyAfterLoop: number
  afterDay: number
  afterHour: number
  afterMinute: number
  notifications: string[]
}

interface LoopSkipRegressionScenario {
  id: string
  title: string
  nowDate: string
  nowDay: number
  advanceDays: number
  initialMoney: number
  playerValues?: Record<string, unknown>
  loopEvent: StoryLoopEventFile
  expectedMoney: number
  expectedDay: number
  expectedHour?: number
  expectedMinute?: number
  expectedNextDueMinute: number
}

interface RegressionGraphEventNode {
  node_type: "event"
  id: string
  title: string
  trigger_mode: StoryEventTriggerMode
  trigger_expr: string
  init_script: string
  end_script: string
  object_keys: string[]
  dialogues: StoryOnceDialogueDefinition[]
  location: string
  next: string[]
}

interface RegressionGraphActionNode {
  node_type: "action"
  id: string
  title: string
  vars: Array<{
    name: string
    descr?: string
    initial_value: string
  }>
  exec_script: string
  next: string[]
}

function resolveDataDir() {
  const currentFilePath = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(currentFilePath), "../../../data")
}

function createValueRow(
  name: string,
  value: unknown,
  description = ""
): StoryValEntryDefinition {
  return {
    name,
    description,
    value_type: "value",
    value,
    calc_rule: ""
  }
}

function createSystemValsFile(nowDate: string, nowDay: number): StoryValsFile {
  return {
    variables: [
      {
        name: "system",
        description: "系统变量",
        vals: [
          createValueRow("now_day", nowDay, "游戏时间_第几天"),
          createValueRow("now_hour", 0, "游戏时间_小时"),
          createValueRow("now_minute", 0, "游戏时间_分钟"),
          createValueRow("time_pause", true, "游戏时间暂停"),
          createValueRow("time_speed", 1, "游戏时间倍率"),
          createValueRow("now_date", nowDate, "游戏时间_日期"),
          createValueRow("now_weekday", 1, "游戏时间_星期"),
          createValueRow("now_jieqi", "", "游戏时间_节气"),
          createValueRow("now_jieri", "", "游戏时间_节日"),
          createValueRow("now_shiduan", "", "游戏时间_时段")
        ]
      }
    ]
  }
}

function createPlayerValsFile(initialMoney: number): StoryValsFile {
  return {
    variables: [
      {
        name: "player",
        description: "玩家变量",
        vals: [
          createValueRow("money", initialMoney, "金钱")
        ]
      }
    ]
  }
}

function createPlayerValsFileFromRecord(values: Record<string, unknown>): StoryValsFile {
  return {
    variables: [
      {
        name: "player",
        description: "玩家变量",
        vals: Object.entries(values).map(([name, value]) => createValueRow(name, value))
      }
    ]
  }
}

function createSyntheticBundle(
  scenario: SyntheticRegressionScenario
): RuntimeStoryBundle {
  return {
    storyId: `regression-${scenario.id}`,
    title: scenario.title,
    generatedAt: REGRESSION_NOW,
    vals: createPlayerValsFile(scenario.initialMoney),
    playerOverrideVals: {
      entries: []
    },
    systemVals: createSystemValsFile(scenario.nowDate, scenario.nowDay),
    scenes: {
      ai: {
        compress_quality: 60
      },
      scenes: []
    },
    roles: {
      normal: {
        ai: {
          width: 1536,
          height: 1024,
          global_prompt: "",
          compress_quality_1: 60,
          compress_quality_2: 80
        },
        roles: []
      },
      important: {
        ai: {
          width: 1536,
          height: 1024,
          global_prompt: "",
          compress_quality_1: 60,
          compress_quality_2: 80
        },
        roles: []
      }
    },
    eventLocations: {
      ai: {
        width: 1536,
        height: 1024,
        global_prompt: "",
        compress_quality_1: 60,
        compress_quality_2: 80
      },
      assignments: []
    },
    graphEvents: {},
    onceEvents: [],
    loopEvents: scenario.loopEvents
  }
}

function createGraphEventNode(input: {
  id: string
  title: string
  triggerExpr?: string
  initScript?: string
  endScript?: string
  dialogues?: StoryOnceDialogueDefinition[]
  next?: string[]
}) {
  return {
    node_type: "event",
    id: input.id,
    title: input.title,
    trigger_mode: input.triggerExpr?.trim() ? "condition" : "default",
    trigger_expr: input.triggerExpr ?? "",
    init_script: input.initScript ?? "",
    end_script: input.endScript ?? "",
    object_keys: [],
    dialogues: input.dialogues ?? [],
    location: "",
    next: input.next ?? []
  } satisfies RegressionGraphEventNode
}

function createGraphActionNode(input: {
  id: string
  title: string
  execScript?: string
  next?: string[]
  vars?: RegressionGraphActionNode["vars"]
}) {
  return {
    node_type: "action",
    id: input.id,
    title: input.title,
    vars: input.vars ?? [],
    exec_script: input.execScript ?? "",
    next: input.next ?? []
  } satisfies RegressionGraphActionNode
}

function createGraphQueueBundle(input: {
  scenarioId: string
  title: string
  playerValues: Record<string, unknown>
  graphNodes: Array<RegressionGraphEventNode | RegressionGraphActionNode>
  onceEvents?: StoryOnceEventFile[]
}): RuntimeStoryBundle {
  return {
    storyId: `graph-${input.scenarioId}`,
    title: input.title,
    generatedAt: REGRESSION_NOW,
    vals: createPlayerValsFileFromRecord(input.playerValues),
    playerOverrideVals: {
      entries: []
    },
    systemVals: createSystemValsFile("1990-1-1", 1),
    scenes: {
      ai: {
        compress_quality: 60
      },
      scenes: []
    },
    roles: {
      normal: {
        ai: {
          width: 1536,
          height: 1024,
          global_prompt: "",
          compress_quality_1: 60,
          compress_quality_2: 80
        },
        roles: []
      },
      important: {
        ai: {
          width: 1536,
          height: 1024,
          global_prompt: "",
          compress_quality_1: 60,
          compress_quality_2: 80
        },
        roles: []
      }
    },
    eventLocations: {
      ai: {
        width: 1536,
        height: 1024,
        global_prompt: "",
        compress_quality_1: 60,
        compress_quality_2: 80
      },
      assignments: []
    },
    graphEvents: Object.fromEntries(input.graphNodes.map((node) => [node.id, node])),
    onceEvents: input.onceEvents ?? [],
    loopEvents: []
  }
}

function createLoopEvent(input: {
  id: string
  title: string
  endScript: string
  loop: StoryLoopEventFile["loop"]
  triggerExpr?: string
  initScript?: string
  dialogues?: StoryOnceDialogueDefinition[]
}) {
  return {
    id: input.id,
    title: input.title,
    trigger_mode: input.triggerExpr?.trim() ? "condition" : "default",
    trigger_expr: input.triggerExpr ?? "",
    init_script: input.initScript ?? "",
    object_keys: [],
    dialogues: input.dialogues ?? [],
    location: "",
    bgm: "",
    end_script: input.endScript,
    loop: input.loop
  } satisfies StoryLoopEventFile
}

function findRow(
  valsFile: StoryValsFile,
  token: string
): { group: StoryValDefinition; row: StoryValEntryDefinition } | null {
  const [groupName, rowName] = token.split(".")
  const matchedGroup = valsFile.variables.find((group) => group.name.trim() === groupName?.trim())
  const matchedRow = matchedGroup?.vals.find((row) => row.name.trim() === rowName?.trim())

  if (!matchedGroup || !matchedRow) {
    return null
  }

  return {
    group: matchedGroup,
    row: matchedRow
  }
}

function readNumber(valsFile: StoryValsFile, token: string) {
  const matchedEntry = findRow(valsFile, token)
  if (!matchedEntry) {
    throw new Error(`Value "${token}" was not found.`)
  }

  const value = matchedEntry.row.value_type === "calc"
    ? evaluateStoryValCalcRule(
        matchedEntry.group,
        matchedEntry.row.calc_rule,
        {
          valsFile
        }
      ).result
    : matchedEntry.row.value

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected numeric value for "${token}", received: ${JSON.stringify(value)}`)
  }

  return value
}

function stepUntilIdle(session: RuntimeStorySession, limit = 200) {
  // 用自动 continue 跑完开场链，避免每次手动点剧情。
  for (let step = 0; step < limit; step += 1) {
    const snapshot = session.getSnapshot()
    const viewModel = session.getViewModel()

    if (!snapshot.current_event_id) {
      return {
        completed: true,
        steps: step
      }
    }

    if (viewModel.interaction?.kind !== "select") {
      return {
        completed: false,
        steps: step,
        currentEventId: snapshot.current_event_id,
        interaction: viewModel.interaction
      }
    }

    const continueOption = viewModel.interaction.options.find((option) => option.id === "continue")
    if (continueOption) {
      session.dispatch({ type: "continue" })
      continue
    }

    if (viewModel.interaction.options.length === 1) {
      session.dispatch({
        type: "select-option",
        optionId: viewModel.interaction.options[0]!.id
      })
      continue
    }

    return {
      completed: false,
      steps: step,
      currentEventId: snapshot.current_event_id,
      interaction: viewModel.interaction
    }
  }

  return {
    completed: false,
    steps: limit,
    reason: "step-limit-reached"
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function advanceGameDays(session: RuntimeStorySession, dayCount: number) {
  session.setTimePause(false)
  session.setTimeSpeed(1)
  session.tick(dayCount * ONE_GAME_DAY_MS)
}

function findNotificationIndex(notifications: string[], title: string) {
  return notifications.findIndex((notification) => notification.includes(title))
}

async function runDemoDailyRegression(
  storyId: string,
  loopEventId: string
): Promise<DemoRegressionResult> {
  const store = createStoryFileStore(resolveDataDir())
  const document = await store.readStoryDocument(storyId)
  const { compiled } = compileStory(document)
  const session = createStorySession({
    bundle: compiled,
    now: new Date(REGRESSION_NOW)
  })

  const bootstrapResult = stepUntilIdle(session)
  assert(bootstrapResult.completed, `Bootstrap flow did not finish: ${JSON.stringify(bootstrapResult)}`)

  const beforeTickSnapshot = session.getSnapshot()
  const moneyBeforeLoop = readNumber(beforeTickSnapshot.vals, "player.money")
  const dayGiveMoney = readNumber(beforeTickSnapshot.vals, "player.day_give_money")
  const beforeDay = readNumber(beforeTickSnapshot.system_vals, "system.now_day")

  assert(beforeDay === 1, `Expected bootstrap day to stay at 1, received ${beforeDay}`)

  advanceGameDays(session, 1)

  const afterTickSnapshot = session.getSnapshot()
  const moneyAfterLoop = readNumber(afterTickSnapshot.vals, "player.money")
  const afterDay = readNumber(afterTickSnapshot.system_vals, "system.now_day")
  const afterHour = readNumber(afterTickSnapshot.system_vals, "system.now_hour")
  const afterMinute = readNumber(afterTickSnapshot.system_vals, "system.now_minute")
  const loopState = afterTickSnapshot.scheduler.loop_states.find((item) => item.event_id === loopEventId)
  const loopEventState = afterTickSnapshot.loop_event_states.find((item) => item.event_id === loopEventId)
  const notifications = session.getViewModel().notifications

  assert(afterDay === 2, `Expected loop regression day to advance to 2, received ${afterDay}`)
  assert(afterHour === 0 && afterMinute === 0, `Expected loop trigger at 00:00, received ${afterHour}:${afterMinute}`)
  assert(afterTickSnapshot.current_event_id === null, "Expected passive loop event to auto-finish")
  assert(moneyAfterLoop === moneyBeforeLoop + dayGiveMoney, "Expected daily loop to add player.day_give_money")
  assert(loopState?.trigger_count === 1, `Expected loop trigger_count to be 1, received ${loopState?.trigger_count}`)
  assert(loopState?.last_triggered_game_minute === MINUTES_PER_DAY, `Expected last loop trigger minute to be 1440, received ${loopState?.last_triggered_game_minute}`)
  assert(loopState?.next_due_game_minute === MINUTES_PER_DAY * 2, `Expected next loop due minute to be 2880, received ${loopState?.next_due_game_minute}`)
  assert(loopEventState?.last_triggered_day === 2, `Expected last triggered day to be 2, received ${loopEventState?.last_triggered_day}`)

  return {
    kind: "demo-daily",
    storyId,
    loopEventId,
    bootstrapSteps: bootstrapResult.steps,
    moneyBeforeLoop,
    dayGiveMoney,
    moneyAfterLoop,
    afterDay,
    afterHour,
    afterMinute,
    notifications: notifications.slice(-10)
  }
}

function runSyntheticScenario(
  scenario: SyntheticRegressionScenario
): SyntheticRegressionResult {
  const session = createStorySession({
    bundle: createSyntheticBundle(scenario),
    now: new Date(REGRESSION_NOW)
  })
  const beforeSnapshot = session.getSnapshot()
  const moneyBeforeLoop = readNumber(beforeSnapshot.vals, "player.money")

  advanceGameDays(session, scenario.advanceDays)

  const afterSnapshot = session.getSnapshot()
  const moneyAfterLoop = readNumber(afterSnapshot.vals, "player.money")
  const afterDay = readNumber(afterSnapshot.system_vals, "system.now_day")
  const afterHour = readNumber(afterSnapshot.system_vals, "system.now_hour")
  const afterMinute = readNumber(afterSnapshot.system_vals, "system.now_minute")
  const notifications = session.getViewModel().notifications

  assert(afterSnapshot.current_event_id === null, `[${scenario.id}] Expected passive loop chain to auto-finish`)
  assert(afterDay === scenario.expectedDay, `[${scenario.id}] Expected day ${scenario.expectedDay}, received ${afterDay}`)
  assert(afterHour === (scenario.expectedHour ?? 0), `[${scenario.id}] Expected hour ${scenario.expectedHour ?? 0}, received ${afterHour}`)
  assert(afterMinute === (scenario.expectedMinute ?? 0), `[${scenario.id}] Expected minute ${scenario.expectedMinute ?? 0}, received ${afterMinute}`)
  assert(moneyAfterLoop === scenario.expectedMoney, `[${scenario.id}] Expected money ${scenario.expectedMoney}, received ${moneyAfterLoop}`)

  for (const expectedLoopState of scenario.expectedLoopStates) {
    const loopState = afterSnapshot.scheduler.loop_states.find((item) => item.event_id === expectedLoopState.eventId)
    const loopEventState = afterSnapshot.loop_event_states.find((item) => item.event_id === expectedLoopState.eventId)

    assert(loopState, `[${scenario.id}] Missing loop scheduler state for ${expectedLoopState.eventId}`)
    assert(loopEventState, `[${scenario.id}] Missing loop event state for ${expectedLoopState.eventId}`)
    assert(loopState.trigger_count === expectedLoopState.triggerCount, `[${scenario.id}] Unexpected trigger count for ${expectedLoopState.eventId}`)
    assert(loopState.last_triggered_game_minute === expectedLoopState.lastTriggeredMinute, `[${scenario.id}] Unexpected last trigger minute for ${expectedLoopState.eventId}`)
    assert(loopState.next_due_game_minute === expectedLoopState.nextDueMinute, `[${scenario.id}] Unexpected next due minute for ${expectedLoopState.eventId}`)
    assert(loopEventState.last_triggered_day === expectedLoopState.lastTriggeredDay, `[${scenario.id}] Unexpected last triggered day for ${expectedLoopState.eventId}`)
  }

  if (scenario.expectedNotificationOrder) {
    let previousIndex = -1

    for (const title of scenario.expectedNotificationOrder) {
      const currentIndex = findNotificationIndex(notifications, title)
      assert(currentIndex >= 0, `[${scenario.id}] Missing notification containing "${title}"`)
      assert(currentIndex > previousIndex, `[${scenario.id}] Notification order mismatch for "${title}"`)
      previousIndex = currentIndex
    }
  }

  return {
    kind: "synthetic",
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    moneyBeforeLoop,
    moneyAfterLoop,
    afterDay,
    afterHour,
    afterMinute,
    notifications: notifications.slice(-10)
  }
}

function runGraphQueueScenario(
  scenario: GraphQueueRegressionScenario
): GraphQueueRegressionResult {
  const session = createStorySession({
    bundle: createGraphQueueBundle({
      scenarioId: scenario.id,
      title: scenario.title,
      playerValues: scenario.playerValues,
      graphNodes: scenario.graphNodes,
      onceEvents: scenario.onceEvents
    }),
    now: new Date(REGRESSION_NOW)
  })

  const beforeSnapshot = session.getSnapshot()
  const moneyBeforeFlow = readNumber(beforeSnapshot.vals, "player.money")
  const runResult = stepUntilIdle(session)
  const afterSnapshot = session.getSnapshot()
  const moneyAfterFlow = readNumber(afterSnapshot.vals, "player.money")
  const notifications = session.getViewModel().notifications

  assert(runResult.completed, `[${scenario.id}] Graph queue flow did not complete: ${JSON.stringify(runResult)}`)
  assert(afterSnapshot.current_event_id === null, `[${scenario.id}] Expected graph queue flow to become idle`)
  assert(afterSnapshot.scheduler.active === null, `[${scenario.id}] Expected no active scheduled event after graph flow`)
  assert(moneyAfterFlow === scenario.expectedMoney, `[${scenario.id}] Expected money ${scenario.expectedMoney}, received ${moneyAfterFlow}`)

  if (scenario.expectedConsumedRootIds) {
    assert(
      JSON.stringify(afterSnapshot.scheduler.consumed_graph_root_ids) === JSON.stringify(scenario.expectedConsumedRootIds),
      `[${scenario.id}] Unexpected consumed graph roots: ${JSON.stringify(afterSnapshot.scheduler.consumed_graph_root_ids)}`
    )
  }

  if (scenario.expectedTriggeredOnceIds) {
    const triggeredOnceIds = afterSnapshot.triggered_once_events.map((item) => item.event_id)
    assert(
      JSON.stringify(triggeredOnceIds) === JSON.stringify(scenario.expectedTriggeredOnceIds),
      `[${scenario.id}] Unexpected triggered once ids: ${JSON.stringify(triggeredOnceIds)}`
    )
  }

  if (scenario.expectedNotificationOrder) {
    let previousIndex = -1

    for (const title of scenario.expectedNotificationOrder) {
      const currentIndex = findNotificationIndex(notifications, title)
      assert(currentIndex >= 0, `[${scenario.id}] Missing notification containing "${title}"`)
      assert(currentIndex > previousIndex, `[${scenario.id}] Notification order mismatch for "${title}"`)
      previousIndex = currentIndex
    }
  }

  return {
    kind: "graph-queue",
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    moneyBeforeFlow,
    moneyAfterFlow,
    notifications: notifications.slice(-10)
  }
}

function runLoopSkipScenario(
  scenario: LoopSkipRegressionScenario
): LoopSkipRegressionResult {
  const session = createStorySession({
    bundle: {
      storyId: `loop-skip-${scenario.id}`,
      title: scenario.title,
      generatedAt: REGRESSION_NOW,
      vals: createPlayerValsFileFromRecord({
        money: scenario.initialMoney,
        ...(scenario.playerValues ?? {})
      }),
      playerOverrideVals: {
        entries: []
      },
      systemVals: createSystemValsFile(scenario.nowDate, scenario.nowDay),
      scenes: {
        ai: {
          compress_quality: 60
        },
        scenes: []
      },
      roles: {
        normal: {
          ai: {
            width: 1536,
            height: 1024,
            global_prompt: "",
            compress_quality_1: 60,
            compress_quality_2: 80
          },
          roles: []
        },
        important: {
          ai: {
            width: 1536,
            height: 1024,
            global_prompt: "",
            compress_quality_1: 60,
            compress_quality_2: 80
          },
          roles: []
        }
      },
      eventLocations: {
        ai: {
          width: 1536,
          height: 1024,
          global_prompt: "",
          compress_quality_1: 60,
          compress_quality_2: 80
        },
        assignments: []
      },
      graphEvents: {},
      onceEvents: [],
      loopEvents: [scenario.loopEvent]
    },
    now: new Date(REGRESSION_NOW)
  })

  const beforeSnapshot = session.getSnapshot()
  const moneyBeforeLoop = readNumber(beforeSnapshot.vals, "player.money")

  advanceGameDays(session, scenario.advanceDays)

  const afterSnapshot = session.getSnapshot()
  const moneyAfterLoop = readNumber(afterSnapshot.vals, "player.money")
  const afterDay = readNumber(afterSnapshot.system_vals, "system.now_day")
  const afterHour = readNumber(afterSnapshot.system_vals, "system.now_hour")
  const afterMinute = readNumber(afterSnapshot.system_vals, "system.now_minute")
  const notifications = session.getViewModel().notifications
  const loopState = afterSnapshot.scheduler.loop_states.find((item) => item.event_id === scenario.loopEvent.id)
  const loopEventState = afterSnapshot.loop_event_states.find((item) => item.event_id === scenario.loopEvent.id)

  assert(afterSnapshot.current_event_id === null, `[${scenario.id}] Expected skipped loop to stay idle`)
  assert(afterDay === scenario.expectedDay, `[${scenario.id}] Expected day ${scenario.expectedDay}, received ${afterDay}`)
  assert(afterHour === (scenario.expectedHour ?? 0), `[${scenario.id}] Expected hour ${scenario.expectedHour ?? 0}, received ${afterHour}`)
  assert(afterMinute === (scenario.expectedMinute ?? 0), `[${scenario.id}] Expected minute ${scenario.expectedMinute ?? 0}, received ${afterMinute}`)
  assert(moneyAfterLoop === scenario.expectedMoney, `[${scenario.id}] Expected money ${scenario.expectedMoney}, received ${moneyAfterLoop}`)
  assert(loopState, `[${scenario.id}] Missing loop scheduler state for ${scenario.loopEvent.id}`)
  assert(loopState.trigger_count === 0, `[${scenario.id}] Skipped loop should not increase trigger_count`)
  assert(loopState.last_triggered_game_minute === null, `[${scenario.id}] Skipped loop should not set last_triggered_game_minute`)
  assert(loopState.next_due_game_minute === scenario.expectedNextDueMinute, `[${scenario.id}] Unexpected next due minute`)
  assert(!loopEventState, `[${scenario.id}] Skipped loop should not create loop_event_state`)

  return {
    kind: "loop-skip",
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    moneyBeforeLoop,
    moneyAfterLoop,
    afterDay,
    afterHour,
    afterMinute,
    notifications: notifications.slice(-10)
  }
}

function buildSyntheticScenarios(): SyntheticRegressionScenario[] {
  return [
    {
      id: "weekly-next-occurrence",
      title: "Weekly loop schedules to the next weekday",
      nowDate: "1990-1-1",
      nowDay: 1,
      advanceDays: 2,
      initialMoney: 100,
      loopEvents: [
        createLoopEvent({
          id: "weekly_pay",
          title: "Weekly Pay",
          endScript: "${player.money} += 30",
          loop: {
            mode: "weekly",
            weekday: 3
          }
        })
      ],
      expectedMoney: 130,
      expectedDay: 3,
      expectedLoopStates: [
        {
          eventId: "weekly_pay",
          triggerCount: 1,
          lastTriggeredDay: 3,
          lastTriggeredMinute: MINUTES_PER_DAY * 2,
          nextDueMinute: MINUTES_PER_DAY * 9
        }
      ]
    },
    {
      id: "monthly-current-month-first-hit",
      title: "Monthly loop can hit later this month first",
      nowDate: "1990-1-10",
      nowDay: 10,
      advanceDays: 5,
      initialMoney: 200,
      loopEvents: [
        createLoopEvent({
          id: "monthly_bonus",
          title: "Monthly Bonus",
          endScript: "${player.money} += 40",
          loop: {
            mode: "monthly",
            month_day: 15
          }
        })
      ],
      expectedMoney: 240,
      expectedDay: 15,
      expectedLoopStates: [
        {
          eventId: "monthly_bonus",
          triggerCount: 1,
          lastTriggeredDay: 15,
          lastTriggeredMinute: MINUTES_PER_DAY * 5,
          nextDueMinute: MINUTES_PER_DAY * 36
        }
      ]
    },
    {
      id: "interval-days-repeat",
      title: "Interval day loop repeats by exact day count",
      nowDate: "1990-1-1",
      nowDay: 1,
      advanceDays: 3,
      initialMoney: 300,
      loopEvents: [
        createLoopEvent({
          id: "interval_reward",
          title: "Interval Reward",
          endScript: "${player.money} += 20",
          loop: {
            mode: "interval_days",
            interval_days: 3
          }
        })
      ],
      expectedMoney: 320,
      expectedDay: 4,
      expectedLoopStates: [
        {
          eventId: "interval_reward",
          triggerCount: 1,
          lastTriggeredDay: 4,
          lastTriggeredMinute: MINUTES_PER_DAY * 3,
          nextDueMinute: MINUTES_PER_DAY * 6
        }
      ]
    },
    {
      id: "same-minute-stable-order",
      title: "Same-minute loops execute in stable queue order",
      nowDate: "1990-1-1",
      nowDay: 1,
      advanceDays: 1,
      initialMoney: 1,
      loopEvents: [
        createLoopEvent({
          id: "multiply_first",
          title: "Multiply First",
          endScript: "${player.money} *= 10",
          loop: {
            mode: "daily"
          }
        }),
        createLoopEvent({
          id: "add_second",
          title: "Add Second",
          endScript: "${player.money} += 5",
          loop: {
            mode: "daily"
          }
        })
      ],
      expectedMoney: 15,
      expectedDay: 2,
      expectedLoopStates: [
        {
          eventId: "multiply_first",
          triggerCount: 1,
          lastTriggeredDay: 2,
          lastTriggeredMinute: MINUTES_PER_DAY,
          nextDueMinute: MINUTES_PER_DAY * 2
        },
        {
          eventId: "add_second",
          triggerCount: 1,
          lastTriggeredDay: 2,
          lastTriggeredMinute: MINUTES_PER_DAY,
          nextDueMinute: MINUTES_PER_DAY * 2
        }
      ],
      expectedNotificationOrder: [
        "Multiply First",
        "Add Second"
      ]
    }
  ]
}

function buildLoopSkipScenarios(): LoopSkipRegressionScenario[] {
  return [
    {
      id: "daily-loop-skip-and-reschedule",
      title: "Daily loop skips current cycle when trigger is false",
      nowDate: "1990-1-1",
      nowDay: 1,
      advanceDays: 1,
      initialMoney: 50,
      playerValues: {
        flag: 0
      },
      loopEvent: createLoopEvent({
        id: "daily_skip",
        title: "Daily Skip",
        triggerExpr: "${player.flag} > 0",
        endScript: "${player.money} += 99",
        loop: {
          mode: "daily"
        }
      }),
      expectedMoney: 50,
      expectedDay: 2,
      expectedNextDueMinute: MINUTES_PER_DAY * 2
    }
  ]
}

function buildGraphQueueScenarios(): GraphQueueRegressionScenario[] {
  return [
    {
      id: "graph-root-trigger-lock-after-queue",
      title: "Queued graph root still runs after trigger changes",
      playerValues: {
        money: 0,
        flag: 0
      },
      graphNodes: [
        createGraphEventNode({
          id: "root_a",
          title: "Root A",
          endScript: "${player.money} += 1\n${player.flag} = 1"
        }),
        createGraphEventNode({
          id: "root_b",
          title: "Root B",
          triggerExpr: "${player.flag} === 0",
          endScript: "${player.money} += 10"
        })
      ],
      expectedMoney: 11,
      expectedConsumedRootIds: ["root_a", "root_b"],
      expectedNotificationOrder: ["Root A", "Root B"]
    },
    {
      id: "once-trigger-lock-after-queue",
      title: "Queued once event still runs after trigger changes",
      playerValues: {
        money: 0,
        flag: 0
      },
      graphNodes: [
        createGraphEventNode({
          id: "root_guard",
          title: "Root Guard",
          endScript: "${player.money} += 1\n${player.flag} = 1"
        })
      ],
      onceEvents: [
        {
          id: "once_bonus",
          title: "Once Bonus",
          trigger_mode: "condition",
          trigger_expr: "${player.flag} === 0",
          init_script: "",
          object_keys: [],
          dialogues: [],
          location: "",
          bgm: "",
          end_script: "${player.money} += 20"
        }
      ],
      expectedMoney: 21,
      expectedConsumedRootIds: ["root_guard"],
      expectedTriggeredOnceIds: ["once_bonus"],
      expectedNotificationOrder: ["Root Guard", "Once Bonus"]
    },
    {
      id: "graph-auto-next-fallback",
      title: "Graph auto next picks the first enterable event",
      playerValues: {
        money: 0,
        flag: 0
      },
      graphNodes: [
        createGraphEventNode({
          id: "root_entry",
          title: "Root Entry",
          endScript: "${player.money} += 10",
          next: ["blocked_next", "eligible_next"]
        }),
        createGraphEventNode({
          id: "blocked_next",
          title: "Blocked Next",
          triggerExpr: "${player.flag} > 0",
          endScript: "${player.money} += 100"
        }),
        createGraphEventNode({
          id: "eligible_next",
          title: "Eligible Next",
          endScript: "${player.money} += 5"
        })
      ],
      expectedMoney: 15,
      expectedConsumedRootIds: ["root_entry"],
      expectedNotificationOrder: ["Eligible Next"]
    },
    {
      id: "graph-queue-continues-after-branch-skip",
      title: "Graph queue continues after an action branch cannot enter its next event",
      playerValues: {
        money: 0,
        flag: 0
      },
      graphNodes: [
        createGraphEventNode({
          id: "root_a",
          title: "Root A",
          next: ["root_a_action"]
        }),
        createGraphActionNode({
          id: "root_a_action",
          title: "Root A Action",
          execScript: "${player.money} += 1",
          next: ["blocked_after_action"]
        }),
        createGraphEventNode({
          id: "blocked_after_action",
          title: "Blocked After Action",
          triggerExpr: "${player.flag} > 0",
          endScript: "${player.money} += 100"
        }),
        createGraphEventNode({
          id: "root_b",
          title: "Root B",
          endScript: "${player.money} += 10"
        })
      ],
      expectedMoney: 11,
      expectedConsumedRootIds: ["root_a", "root_b"],
      expectedNotificationOrder: ["Root A", "Root B"]
    }
  ]
}

async function main() {
  const storyId = process.argv[2] ?? DEFAULT_STORY_ID
  const loopEventId = process.argv[3] ?? DEFAULT_LOOP_EVENT_ID
  const demoResult = await runDemoDailyRegression(storyId, loopEventId)
  const syntheticResults = buildSyntheticScenarios().map(runSyntheticScenario)
  const loopSkipResults = buildLoopSkipScenarios().map(runLoopSkipScenario)
  const graphQueueResults = buildGraphQueueScenarios().map(runGraphQueueScenario)

  console.log(JSON.stringify({
    ok: true,
    executedAt: REGRESSION_NOW,
    demoResult,
    syntheticResults,
    loopSkipResults,
    graphQueueResults
  }, null, 2))
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : JSON.stringify(error)
  console.error(message)
  process.exitCode = 1
})
