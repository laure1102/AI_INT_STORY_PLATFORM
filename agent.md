# Story Manager Agent Guide

Last updated: `2026-06-04`

This file is the current high-signal project map for future agents and developers.
If this guide conflicts with code, trust the code in these files first:

- `packages/core/src/types.ts`
- `packages/core/src/schema.ts`
- `packages/runtime/src/vals.ts`
- `packages/runtime/src/session.ts`
- `packages/file-store/src/index.ts`
- `apps/api/src/routes/stories.ts`

## 1. Project direction

Story Manager is no longer only an editor.

It is becoming a full content-authoring plus runtime prototype stack:

- the editor creates and validates story content
- the shared runtime executes variables, expressions, and scripts
- the TUI client validates gameplay/runtime flow locally
- the future Cocos client should reuse the same runtime semantics

## 2. Monorepo structure

### Apps

- `apps/web`: Nuxt 3 story editor
- `apps/api`: Koa API for files, assets, AI generation, and export
- `apps/tui-client`: text-based runtime shell over the shared runtime
- `apps/cocos-client`: placeholder for the future game client shell

### Packages

- `packages/core`: story data types, schema, validation contracts
- `packages/runtime`: shared runtime logic
- `packages/compiler`: compiles a story document into runtime bundle JSON
- `packages/file-store`: JSON5 persistence and local asset handling
- `packages/shared`: cross-app request/response and shared transport types

## 3. Story data layout

Each story lives under `data/stories/<storyId>/`.

Core files:

- `story.json5`
- `vals.json5`
- `player_override_vals.json5`
- `system_vals.json5`
- `scene.json5`
- `nomal_roles.json5`
- `import_roles.json5`
- `event_location.json5`

Event files:

- `events/events.json5`
- `events/big_once_events.json5`
- `events/loop_events.json5`

Notes:

- `nomal_roles.json5` and `import_roles.json5` are the active file names, even though `nomal` is misspelled.
- Old `roles.json5` and `roles_setting.json5` should not be restored.
- Graph events and action nodes now live together in `events/events.json5`.

## 4. Current story data contracts

### `vals.json5` and `system_vals.json5`

Both use the same structure:

```json5
{
  variables: [
    {
      name: "county",
      description: "",
      vals: [
        {
          name: "level",
          description: "",
          value_type: "value" | "calc",
          value: 1,
          calc_rule: ""
        }
      ]
    }
  ]
}
```

### `nomal_roles.json5`

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
      zhiye: "",
      descr: "",
      prompt: "",
      img_raw: "",
      img_compress_1: "",
      img_compress_2: ""
    }
  ]
}
```

### `import_roles.json5`

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
      zhiye: "",
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

### `event_location.json5`

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

### `player_override_vals.json5`

```json5
{
  entries: [
    {
      var_key: "player.name_xing",
      group_no: 1,
      need_player_override: true,
      tips: "请输入主角的姓"
    }
  ]
}
```

Rules:

- only references `vals.json5`, not `system_vals.json5`
- row order is meaningful and must be preserved
- `group_no` controls grouped input screens in clients; rows with the same number should be entered on the same screen step
- `need_player_override: true` means the client should ask the player to fill this field during profile creation
- `tips` is the client-side prompt / helper text

### `story.json5`

Current minimal shape:

```json5
{
  id: "demo",
  title: "示例故事",
  description: "",
  tags: []
}
```

Notes:

- `startEventId` has been removed from `story.json5`
- automatic start-event discovery is not implemented yet and should be designed later

## 5. Event model

### Graph events: `events/events.json5`

This file contains two node types.

Event node:

```json5
{
  node_type: "event",
  id: "arrival",
  title: "Arrival",
  trigger_expr: "",
  init_script: "",
  end_script: "",
  object_keys: ["player"],
  dialogues: [],
  location: "",
  next: []
}
```

Action node:

```json5
{
  node_type: "action",
  id: "arrival-action-1",
  title: "Ask about the county",
  vars: [
    {
      name: "mood",
      descr: "branch-local value",
      initial_value: "calm"
    }
  ],
  exec_script: "",
  next: []
}
```

Graph rules:

- `event -> event` is allowed
- `event -> action` is allowed
- `action -> event` is allowed
- `action -> action` is not allowed
- an action node should have at most one outgoing `next`

### Big-once events: `events/big_once_events.json5`

```json5
{
  id: "opening",
  title: "Opening Event",
  trigger_expr: "",
  init_script: "",
  object_keys: [],
  dialogues: [],
  location: "",
  bgm: "",
  end_script: ""
}
```

### Loop events: `events/loop_events.json5`

Loop events extend big-once events with:

```json5
{
  loop: {
    mode: "daily" | "weekly" | "monthly" | "interval_days",
    weekday?: 1..7,
    month_day?: 1..31,
    interval_days?: number
  }
}
```

## 6. Variable and script rules

These rules must stay aligned with `packages/runtime/src/vals.ts`.

### `calc_rule`

- supports same-group references with `{row}`
- supports cross-group references with `{group.row}`
- supports recursive calc resolution up to max depth `5`
- supports common `Math` functions and constants
- result must be a finite number

### `trigger_expr`

- supports `{group.row}`
- calc variables are resolved before comparison
- supports common `Math` functions
- result must be `boolean`
- empty string means `true`

### event scripts

Supported syntax:

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
{branch.xxx} = expression
{branch.xxx} += expression
{branch.xxx} -= expression
{branch.xxx} *= expression
{branch.xxx} /= expression
{branch.xxx} %= expression
```

Restrictions:

- cannot assign to `calc` variables
- no `if`, `else`, `for`, `while`, or function declarations
- temporary variables must be declared with `let`
- `branch.xxx` is only available when runtime provides action-branch context
- runtime currently allows script writes into merged global/system values except `calc` rows; the long-term design intent is stricter: system time variables should be runtime-owned and eventually read-only to story scripts

### dialogue content

- dialogue content may include `{group.row}` placeholders
- dialogue content may include `{branch.xxx}` placeholders
- editor-side autocomplete exists
- runtime text substitution is implemented in `packages/runtime`

## 7. Object and location rules

### event objects

`object_keys` uses unique keys:

- `player`
- `normal:<roleName>`
- `important:<roleName>`

The editor intentionally allows duplicate role names across normal and important roles because the stored key includes the namespace.

### dialogue speaker

```json5
{
  speaker_type: "player" | "object",
  speaker_key: "player" | "normal:xxx" | "important:xxx",
  content: ""
}
```

### location field

- stored value is the location `name`
- editor displays `name - descr`
- empty location is allowed

## 8. Asset and AI rules

App-level provider config lives in `data/setting.json5`.

Image generation:

- prompts use `global_prompt + item.prompt`
- location and role generation use `width` and `height`

Compression:

- original image is preserved
- compressed variants use `compress_quality_1` and `compress_quality_2`
- current UI mainly previews the original image thumbnail

## 9. Shared runtime status

`packages/runtime` currently owns:

- value parsing / formatting
- calc evaluation
- boolean trigger evaluation
- script execution and validation
- runtime text-template rendering
- merged global/system variable evaluation
- graph-event runtime session progression
- event dialogue playback
- action-node branch execution and branch-variable propagation
- runtime clock state and system-time synchronization

### Runtime clock model

Implemented in `packages/runtime/src/session.ts`.

Core state:

```ts
interface RuntimeClockState {
  base_date: string
  base_day: number
  total_minutes: number
  pending_minutes: number
  step_minutes: number
}
```

Current design:

- `system_vals.json5` is the source for initial clock defaults
- default game start is day `1`, not day `0`
- current default base date is `1990-1-1`
- time advances in stepped chunks, currently `10` in-game minutes per step
- `pending_minutes` accumulates scaled real time until it crosses a step boundary
- every completed step syncs derived system fields back into `system_vals`

Fields currently synchronized by runtime:

- `system.now_day`
- `system.now_date`
- `system.now_hour`
- `system.now_minute`
- `system.now_weekday`
- `system.now_shiduan`
- `system.now_jieqi`
- `system.now_jieri`

Control semantics:

- `system.time_pause === true` means the game clock does not advance
- `system.time_speed` means "real 1 minute corresponds to how many in-game minutes"
- non-positive or invalid `time_speed` effectively stops time progression
- `tick(deltaMs)` only advances time; it does not yet schedule `big_once_events` or `loop_events`

Public runtime control surface:

- `tick(deltaMs: number)`
- `setTimePause(paused: boolean)`
- `setTimeSpeed(speed: number)`

Important current boundary:

- time progression is already part of the shared runtime and must remain reusable by both `tui-client` and future `cocos-client`
- loop-event scheduling is intentionally not connected yet
- the current runtime session may have `current_event_id === null`; no automatic start-node discovery exists yet

`packages/core/src/vals.ts` now re-exports the runtime implementation for compatibility.

## 10. TUI client status

`apps/tui-client` now has a working Ink-based runtime shell for graph-event flow verification.

Implemented:

- local story bundle sync by reading `data/stories/<storyId>` through `@story-mgr/file-store` and compiling through `@story-mgr/compiler`
- local runtime storage layout under `.tui-client/stories/<storyId>/`
- profile storage via `custom.json5`
- player-creation flow driven by `player_override_vals.json5`
- save slots via `*.json5`
- runtime controller API in `apps/tui-client/src/index.ts`
- Ink-based interactive TUI shell in `apps/tui-client/src/cli.tsx`
- real graph-event runtime playback through `packages/runtime`
- event title / location / dialogue display
- action-node branch selection
- branch-variable summary display
- debug-panel toggle inside the TUI game screen
- runtime time controls wired through shared session APIs
- compact phone-like header / game area / footer layout
- overlay pager for message flow and global variables without growing overall TUI height
- next-day debug advance

Current TUI local layout:

```txt
.tui-client/
  stories/
    <storyId>/
      bundle.json
      profiles/
        <profileId>/
          custom.json5
          saves/
            <slotId>.json5
```

Profile `custom.json5` may now also include `player_setup`, while `custom_values` remains the actual override layer applied to the runtime bundle.

Profile creation rules:

- the editor controls player-input fields through `player_override_vals.json5`
- the TUI asks only rows where `need_player_override === true`
- prompts are grouped by `group_no`
- answers are written to `custom_values[var_key]`
- if common player/county fields exist, `player_setup` is inferred from `custom_values`
- runtime still consumes `custom_values` as the true override layer

Bootstrap flow:

1. sync story bundle
2. select or create profile
3. load profile custom values
4. select save or start new game
5. create runtime session
6. enter game

Command:

```bash
pnpm tui -- --story demo
```

Notes:

- the TUI must run in a real interactive TTY terminal because Ink needs raw keyboard input
- the current runtime gameplay loop is focused on `events/events.json5`
- `big_once_events.json5` and `loop_events.json5` are not yet scheduled into the live runtime flow

### Current TUI game-screen behavior

Layout:

- header: left shows `第N天 HH:MM 时段` and paused state; right shows `县名县({county.level})`
- middle game area: only runtime content, overlays, dialogue, branch options, or empty-state text
- footer: left shows `角色名  金钱: <格式化金额>`; right shows `下一天`
- footer extra hint row: keyboard shortcuts

Current keyboard shortcuts:

- `h`: return to profile menu
- `t`: open settings menu
- `space`: pause / resume time
- `l`: show or hide message-flow overlay
- `i`: show or hide global-values overlay
- `n`: advance to next day `00:00` for debugging

Overlay behavior:

- message flow and global variables render inside the game area, not below the screen
- overlay paging preserves the previous game-area state and restores it after closing
- overlay content can be scrolled without changing the overall shell height

Current TUI money/header formatting:

- county header appends global county level as `XX县({county.level})`
- footer money display is humanized with `千 / 万 / 亿` formatting

Current TUI time loop:

- `apps/tui-client/src/cli.tsx` calls `app.tick(1000)` every real second while a session exists
- pause and speed changes are delegated to the shared runtime instead of local UI-only state
- `n` temporarily normalizes time controls, advances to the next day boundary, then restores previous pause/speed state

## 11. Cocos client status

`apps/cocos-client` exists only as a placeholder shell right now.

The intended rule is:

- `tui-client` validates runtime semantics
- `cocos-client` focuses on presentation and platform integration
- both should reuse `packages/runtime`

## 12. Current known gaps

- `story.json5` no longer has `startEventId`, but automatic start-event discovery is still not implemented
- `big_once_events` are not yet integrated into runtime scheduling
- `loop_events` are not yet integrated into runtime scheduling
- save snapshots do not yet persist transient cursor state such as current dialogue index, pending action list, and branch context
- loading a save currently restores values and `current_event_id`, but does not resume mid-dialogue
- `player_setup` inference is still convention-based for known fields such as `player.name_xing`, `player.name_ming`, `county.name_full`, `county.name_short`, `county.parent_city`, and `county.province`
- scene/background presentation and audio are not yet represented in the TUI runtime
- `system.now_jieqi` is still a placeholder and currently resolves to an empty string
- long-term rule "system variables are runtime-owned and script read-only" is not fully enforced yet

## 13. Next recommended steps

- design and implement automatic graph start-event discovery
- stabilize the long-term variable contract for player creation
- reuse the same player-creation contract in the future Cocos onboarding flow
- persist transient runtime session state so save/load resumes mid-event correctly
- integrate `big_once_events` into the shared runtime scheduler
- integrate `loop_events` into the shared runtime scheduler
- enforce runtime-owned system-variable write protection where appropriate
- add regression tests around:
  bundle -> custom -> save layering
  branch-variable read/write semantics
  dialogue placeholder rendering
  save/load resume behavior
  time progression and system-time synchronization

## 14. Collaboration rules

- prefer direct code changes over discussion-only responses
- when changing data contracts, check `core`, `runtime`, `compiler`, `file-store`, `api`, and `web`
- prefer ASCII in edited files unless non-ASCII is necessary
- 新增代码注释统一使用中文，保持简洁，优先解释关键逻辑与边界
- use `apply_patch` for manual file edits
- do not revert unrelated user changes
