# Story Manager Agent Guide

Last updated: `2026-06-15`

This file is the current high-signal project map for future agents and developers.
If this guide conflicts with code, trust the code in these files first:

- `packages/core/src/types.ts`
- `packages/core/src/schema.ts`
- `packages/runtime/src/vals.ts`
- `packages/runtime/src/session.ts`
- `packages/file-store/src/index.ts`
- `apps/api/src/routes/stories.ts`
- `StoryScript.md`

## 0. Encoding rule

- all code reading, code writing, patch editing, and generated text files must use UTF-8 encoding
- all PowerShell-based file read/write and command pipelines in this project must explicitly preserve UTF-8 input/output behavior
- when inspecting files that may contain Chinese text, always prefer UTF-8-safe reads first, and never assume the terminal default encoding is correct
- if any garbled text appears during editing or command output, stop and re-read the source with UTF-8 before making further changes

## 1. Project direction

Story Manager is no longer only an editor.

It is becoming a full content-authoring plus runtime prototype stack:

- the editor creates and validates story content
- the shared runtime executes variables, expressions, and scripts
- the HTML client validates gameplay/runtime flow locally
- the future Cocos client should reuse the same runtime semantics

## 2. Monorepo structure

### Apps

- `apps/web`: Nuxt 3 story editor
- `apps/api`: Koa API for files, assets, AI generation, and export
- `apps/html-client`: browser-based runtime shell over the shared runtime
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
- `story_bible.json5`
- `vals.json5`
- `player_override_vals.json5`
- `system_vals.json5`
- `scene.json5`
- `nomal_roles.json5`
- `import_roles.json5`
- `event_location.json5`
- `items.json5`
- `initial_bags.json5`

Event files:

- `events/chains.json5`
- `events/pool_events.json5`
- `events/schedule_events.json5`

Notes:

- `story_bible.json5` is editor/backend creation context only; it is not compiled into runtime bundles.
- `nomal_roles.json5` and `import_roles.json5` are the active file names, even though `nomal` is misspelled.
- Old `roles.json5` and `roles_setting.json5` should not be restored.
- Chain event nodes and action nodes now live together in `events/chains.json5`.
- `items.json5` is the story-level item asset library; it is separate from event/location/role assets and includes editable item categories.
- `initial_bags.json5` is only a new-save initialization template; live inventory is stored in the runtime session snapshot as `bags`.
- `events/events.json5`, `events/once_events.json5`, and `events/loop_events.json5` are legacy fallback file names only.

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
      id: "start_suanming",
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
      id: "zhuli",
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
      id: "office_small",
      descr: "",
      prompt: "",
      img_raw: "",
      img_compress_1: "",
      img_compress_2: ""
    }
  ]
}
```

### `items.json5`

Story-level item asset library:

```json5
{
  ai: {
    width: 1024,
    height: 1024,
    global_prompt: "",
    compress_quality_1: 60,
    compress_quality_2: 80
  },
  categories: [
    {
      id: "prop",
      name: "道具",
      descr: "",
      sort_order: 20
    }
  ],
  items: [
    {
      id: "population_flow_report",
      name: "人口流动统计表",
      category_id: "prop",
      descr: "",
      prompt: "",
      tags: [],
      rarity: "common",
      stackable: false,
      max_stack: 1,
      usable: false,
      img_raw: "",
      img_compress_1: "",
      img_compress_2: ""
    }
  ]
}
```

Rules:

- item category ids must be unique
- item ids must be unique
- each item must reference an existing `category_id`
- item images live under `assets/items/`, with original images under `assets/items/raw/`
- the web editor has a `物品` tool button for category management, item editing, prompt generation, image generation, and compression
- the compiler includes `items` in `CompiledStory`; runtime mutable inventory is stored in `snapshot.bags`; equipment semantics are not implemented yet

### `initial_bags.json5`

Story-level initial bag template used only when creating a new runtime session:

```json5
{
  player: {
    entries: [
      {
        item_id: "population_flow_report",
        quantity: 1,
        bound: false,
        meta: {}
      }
    ]
  }
}
```

Rules:

- `player` is the default owner id for the protagonist/player character
- every `item_id` must exist in `items.json5`
- runtime inventory is mutable save data in `snapshot.bags`; it is not written back to `items.json5` or `initial_bags.json5`
- runtime view models expose a read-only `bagSummary` for clients/debug panels; scripts should still mutate inventory only through StoryScript bag helpers

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
- runtime now auto-discovers chain start events by finding chain `event` nodes with no incoming chain-event parent

### `story_bible.json5`

Backend AI creation context for turning a web-novel premise into playable structured content:

```json5
{
  background: "",
  golden_finger: "",
  protagonist: "",
  world_rules: "",
  outline: "",
  current_arc: "",
  gameplay_design: "",
  style_guide: "",
  constraints: ""
}
```

Rules:

- this file is per-story creative source material for the editor and backend generation agents
- it should describe playable web-novel game design, not only prose-writing instructions
- generated output must target project data files: chain events, pool events, schedule events, scenes, roles, locations, items, and variables
- runtime ignores this file; the compiler should not include it in `CompiledStory`

## 5. Event model

### Chain events: `events/chains.json5`

This file contains two node types.

Event node:

```json5
{
  node_type: "event",
  id: "arrival",
  title: "Arrival",
  trigger_mode: "default", // "default" | "condition" | "invoke"
  trigger_expr: "",
  invoke_params: [],
  init_script: "",
  end_script: "",
  object_keys: ["player"],
  presentation: {
    type: "dialogue",
    dialogues: []
  },
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

Chain rules:

- `event -> event` is allowed
- `event -> action` is allowed
- `action -> event` is allowed
- `action -> action` is not allowed
- an action node should have at most one outgoing `next`

Event presentation:

- `presentation: { type: "silent" }` runs scripts and advances without client-facing text
- `presentation: { type: "message", message: { content: "...", duration_seconds: 3 } }` shows a transient client message
- `presentation: { type: "dialogue", dialogues: [...] }` uses the current click-through dialogue flow

### Pool events: `events/pool_events.json5`

```json5
{
  id: "opening",
  title: "Opening Event",
  trigger_mode: "default",
  trigger_expr: "",
  invoke_params: [],
  init_script: "",
  object_keys: [],
  presentation: {
    type: "silent"
  },
  location: "",
  bgm: "",
  end_script: ""
}
```

### Schedule events: `events/schedule_events.json5`

Schedule events extend pool events with:

```json5
{
  trigger_mode: "default",
  invoke_params: [],
  loop: {
    mode: "daily" | "weekly" | "monthly" | "interval_days",
    weekday?: 1..7,
    month_day?: 1..31,
    interval_days?: number,
    at?: "HH:mm",
    priority?: number,
    after?: ["other_schedule_event_id"],
    before?: ["other_schedule_event_id"]
  }
}
```

Schedule loop ordering:

- `at` is the in-game time of day for the loop, defaulting to `00:00`
- lower `priority` runs earlier when multiple loops are due at the same minute; default is `100`
- `after` means this schedule event must run after the listed schedule event ids when they are due together
- `before` is the inverse relation and should be used sparingly; prefer `after` for business dependencies
- validation rejects invalid `HH:mm`, non-integer priorities, self-dependencies, and dependencies that do not exist in `schedule_events.json5`
- authoring Agent drafts should include `at`, `priority`, and dependency fields when generating schedule events; use `after` for rules such as "daily payout after daily population settlement"

### Trigger modes and invocation

- chain events, pool events, and schedule events all support `trigger_mode: "default" | "condition" | "invoke"`.
- `default` events participate in normal scheduler scanning and do not execute `trigger_expr`.
- `condition` events participate in normal scheduler scanning and require a non-empty `trigger_expr`.
- `invoke` events require at least one `invoke_params` entry; they do not participate in normal scanning and only enter the runtime queue when called.
- event ids only need to be unique inside their own collection; chain/pool/schedule ids may repeat.
- StoryScript invocation must include the target collection: `invoke_once pool test1 money=${player.money}`, `invoke_once chain event_a mood=${county.level}`, `invoke_once schedule daily_tax day=${system.now_day}`.
- legacy StoryScript target names `graph`, `once`, and `loop` are still accepted and normalized to `chain`, `pool`, and `schedule`.
- runtime API shape is `invokeOnceEvent(targetType, eventId, args)` and dispatch action shape is `{ type: "invoke-once", targetType, eventId, args }`.
- scheduler stores invoked calls as `source_type: "invoke"` plus `invoke_target_type`; invoked calls are queue instances and do not mark once events consumed or update loop cycle state.
- invoked chain events enter the chain at the target event; `call.xxx` values stay available through that invoked chain.
- invoked schedule events run as standalone schedule event content but do not reschedule the schedule cycle.

## 6. Variable and script rules

Current implementation details must stay aligned with `packages/runtime/src/vals.ts`.

Unified script specification lives in:

- `StoryScript.md`

Keep this section short and implementation-focused. Do not duplicate the full language spec here.

`StoryScript.md` is the single source of truth for StoryScript syntax and semantics.

### `calc_rule`

- supports same-group references with `{row}`
- supports cross-group references with `{group.row}`
- supports recursive calc resolution up to max depth `5`
- supports common `Math` functions and constants
- result must be a finite number

### current `trigger_expr` behavior

- supports `${group.row}`
- calc variables are resolved before comparison
- supports common `Math` functions
- result must be `boolean`
- only applies when `trigger_mode: "condition"`
- `trigger_mode: "condition"` requires a non-empty expression
- `trigger_mode: "default"` is the explicit always-eligible mode
- predicate mode is read-only and rejects external assignment
- predicate mode rejects `invoke_once`
- predicate mode only exposes read-only bag helpers: `bag_count` and `bag_has`

### current script engine summary

- supports `let`
- supports direct assignment and compound assignment
- supports `if`, `else`, `switch`, `for`, `while`, `break`, `continue`, and `return`
- supports `//` line comments and `/* */` block comments in script fields
- supports `Math`
- supports safe helper globals: `Number`, `String`, `Boolean`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`
- supports safe string helpers: `trim`, `includes`, `startsWith`, `endsWith`, `slice`, `toLowerCase`, `toUpperCase`
- supports safe formatting helpers: `toFixed`, `formatWan`
- supports `Math.random()`
- also supports a small whitelist of method aliases: `number.toFixed(...)`, `string.trim()`, `string.includes(...)`, `string.startsWith(...)`, `string.endsWith(...)`, `string.slice(...)`, `string.toLowerCase()`, `string.toUpperCase()`
- arbitrary method calls outside that whitelist remain unsupported unless `StoryScript.md` is updated first
- supports `invoke_once chain|pool|schedule <eventId> name=expression`
- legacy `invoke_once graph|once|loop ...` remains compatible
- loops are protected by both a max step limit and a max iteration limit
- StoryScript placeholder syntax is only `${...}`
- comments are stripped before placeholder and `invoke_once` preprocessing while preserving line numbers
- legacy `{...}` placeholders are invalid in StoryScript fields and text templates
- `branch.xxx` is only available when runtime provides action-branch context
- `call.xxx` is only available for `invoke` mode event scripts/dialogue after runtime provides invocation args
- event/action scripts can use `bag_add("player", "item_id", 1)` and `bag_remove("player", "item_id", 1)` to mutate runtime inventory
- scripts and conditions can use `bag_count("player", "item_id")` and `bag_has("player", "item_id", 1)` to inspect runtime inventory
- literal `item_id` arguments are validated against `items.json5`; dynamic ids are checked at runtime
- runtime text substitution for dialogue/template content is implemented in `packages/runtime`
- editor `?` help popovers for condition/script/dialogue fields should eventually be sourced from `StoryScript.md`
- StoryScript validation lives in shared runtime/core paths and should be covered by future shared regression tests.

## 7. Object and location rules

### event objects

`object_keys` uses unique keys:

- `player`
- `normal:<roleId>`
- `important:<roleId>`

The editor intentionally allows duplicate role names across normal and important roles because the stored key includes the namespace and the role `id`.

### dialogue speaker

```json5
{
  speaker_type: "player" | "object",
  speaker_key: "player" | "normal:xxx" | "important:xxx",
  content: ""
}
```

### location field

- stored value is the location `id`
- editor displays `id - descr`
- empty location is allowed

## 8. Asset and AI rules

App-level provider config lives in `data/setting.json5`.

Current app-level AI config groups:

- `ai.text`: text prompt generation for existing editor helpers
- `ai.image`: image generation for locations and roles
- `ai.agent`: backend multi-Agent story creation models, separate from `text` and `image`

Image generation:

- prompts use `global_prompt + item.prompt`
- location and role generation use `width` and `height`

Compression:

- original image is preserved
- compressed variants use `compress_quality_1` and `compress_quality_2`
- current UI mainly previews the original image thumbnail

### Backend AI creation Agent

The AI content creation module is separate from the runtime AI剧情导演.

Purpose:

- turn web-novel settings into playable/open/evolving game content
- generate or modify structured files, not only prose
- produce data that can be validated, edited, and later selected by the runtime director

Current foundation:

- per-story creative context lives in `story_bible.json5`
- app-level creation models live in `data/setting.json5` under `ai.agent`
- the web story editor now defaults to the `创作` workspace
- the previous event editor is behind the `事件` workspace tab
- `apps/api` exposes `GET/PUT /api/stories/:storyId/story-bible`
- `apps/api` exposes `POST /api/stories/:storyId/creation-agent/run`
- `apps/api` exposes `POST /api/stories/:storyId/creation-agent/apply`
- `creation-agent/run` starts a new creation when called with only `instruction`; when called with `baseDraft`, the same multi-Agent workflow revises the current draft and must return a complete revised draft, not a patch
- the LangGraph workflow returns a structured draft preview and does not directly mutate story files
- the editor creation workspace can run the backend multi-Agent workflow and display Agent logs, draft events, locations, roles, items, variable suggestions, notes, and warnings
- the editor creation workspace can select draft locations, roles, items, variables, and events, then explicitly apply the selected subset
- the backend creation Agent gives item context in two layers:
  - `itemIndexAll` is the full compact item index for existence checks and reuse decisions
  - `relevantItemDetails` is a local keyword-ranked detail pool for richer item fields; it is not the full library
- the editor creation workspace keeps an editable local copy of the Agent draft before apply; users can revise safe fields such as title, summary, arc, location/role/item text, item category/basic flags, variable description/value, event title, event location, trigger mode, condition expression, first dialogue, init script, and end script
- the creation workspace can reset the editable draft back to the latest Agent result
- after a draft exists, the new-creation command area is collapsed by default; the feedback box sends the editable current draft as `baseDraft` so the Agent can optimize the existing result instead of starting over
- feedback optimization shows a dedicated running state and local feedback history; each submitted feedback item is marked as running, completed, or failed
- the editor creation workspace previews apply impact before confirmation: create, overwrite, skip, and likely reference cleanups
- draft apply can write selected data into `events/chains.json5`, `events/pool_events.json5`, `events/schedule_events.json5`, `event_location.json5`, `nomal_roles.json5`, `import_roles.json5`, `items.json5`, and `vals.json5`
- draft apply returns the updated story document, validation result, applied counts, and warnings for any downgraded or skipped references
- variable suggestions are structured draft rows and can be written to `vals.json5` after user confirmation

Current draft-apply rules:

- apply is human-confirmed; Agent runs must not write files by themselves
- locations are selected by location id
- roles are selected by role keys, using `normal:<id>` or `important:<id>`; legacy pure role ids are only accepted for backward compatibility
- items are selected by item id and must reference an existing `items.json5` category id
- events are selected by event keys, using `chain:<id>`, `pool:<id>`, or `schedule:<id>`
- variables are selected by variable keys, using `group.name`; legacy string suggestions are accepted for backward compatibility
- draft object ids and variable keys are not editable in the creation workspace yet; this keeps selection state and event references stable
- draft ids are normalized to ASCII-like ids before apply
- draft variables are normalized to lowercase ASCII-like group and row names
- selected variables are written only to `vals.json5`, not `system_vals.json5`
- selected items are written to `items.json5`; existing item images are preserved when a draft overwrites an item
- selected items with missing categories are skipped with a warning
- selected `system.*` variables are skipped with a warning
- selected variables never overwrite existing `vals.json5` rows; existing rows are skipped with a warning
- the creation workspace impact preview is client-side guidance; the backend apply service remains the final authority and returns authoritative warnings
- event ids are unique only inside their own collection; `chain:foo`, `pool:foo`, and `schedule:foo` may coexist
- selected chain event `next` references are kept only when the target chain event is selected or already exists
- missing or unselected locations are cleared from applied events with a warning
- missing or unselected role speakers are downgraded to `player` with a warning
- invalid `condition` or `invoke` trigger details are downgraded to `default` with a warning
- schedule draft events require `loop`; missing loop rules are applied as `daily` with a warning

Required architecture:

- multi-Agent is mandatory for this module
- planned roles are chief editor, plot planner, asset designer, event writer, script doctor, and consistency checker
- LangChain/LangGraph are the expected workflow layer for the backend execution graph
- execution APIs are backend/editor-only and must not be coupled to `packages/runtime`
- draft application must remain an explicit confirm/apply step, not an automatic generation side effect

Boundary:

- AI剧情导演 runs during gameplay and selects from existing events
- backend AI creation Agent runs during authoring and writes structured story assets
- `story_bible.json5` and `ai.agent` are not part of `CompiledStory`

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
- runtime scheduler state for chain roots, pool events, and schedule events

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
- `tick(deltaMs)` advances the shared clock and then runs scheduler reconciliation
- runtime internally splits pause sources into `manual_pause` and `event_pause`
- effective pause state is `manual_pause || event_pause`, and the merged result is mirrored back into `system.time_pause`

Public runtime control surface:

- `tick(deltaMs: number)`
- `setTimePause(paused: boolean)`
- `setTimeSpeed(speed: number)`

Important current boundary:

- time progression is already part of the shared runtime and must remain reusable by both `html-client` and future `cocos-client`
- current runtime uses a scheduler model with `scheduled`, `ready_queue`, and `active`
- chain root discovery is already connected
- `pool_events` are already connected to scheduler-driven playback
- `schedule_events` already maintain future due times and are promoted from `scheduled` to `ready_queue` when due
- canonical event collection naming is now `chain`, `pool`, and `schedule`; legacy `graph`, `once`, and `loop` are compatibility aliases

### Runtime scheduler model

Implemented in `packages/runtime/src/session.ts`.

Core snapshot shape:

```ts
interface RuntimeSchedulerState {
  scheduled: RuntimeScheduledEvent[]
  ready_queue: RuntimeScheduledEvent[]
  active: RuntimeScheduledEvent | null
  consumed_once_ids: string[]
  consumed_graph_root_ids: string[]
  loop_states: RuntimeSchedulerLoopState[]
  audit_logs: RuntimeSchedulerAuditEntry[]
  director_logs: RuntimeDirectorDecisionLog[]
  manual_pause: boolean
  event_pause: boolean
  next_seq: number
}
```

Current behavior:

- chain events only enter global scheduling through root event nodes
- root event rule: chain `event` nodes with no incoming chain-event parent edge
- chain roots are consumed once per save after successful playback
- chain roots and `pool_events` with `default` or passing `condition` triggers are scanned as AI director entry candidates
- the director selects one natural story entry per scheduling round; selected `chain_root` entries run their authored chain, and selected `pool` entries run as standalone pool events
- the first-pass AI剧情导演 lives in `packages/runtime/src/director.ts`
  - `RuntimeStoryDirector` owns candidate selection
  - `RuntimeDirectorScorer` owns scoring and can later be replaced by a TensorFlow-backed implementation
  - the default rule scorer reads optional `event.meta.director.priority` and `event.meta.director.weight`
  - candidate feature snapshots include flattened global/system values, game time, consumed pool ids, triggered pool ids, and recent history
  - director decisions are stored in `scheduler.director_logs` for later training-data export
  - `createRuntimeDirectorTrainingSamples` converts `director_logs` into stable `{ input, label, teacher }` samples for later TensorFlow training
  - training sample labels use selected `source_type`, event id, and candidate index; rule scores stay in `teacher` metadata instead of becoming required model inputs
  - when a front-stage event is active or waiting in the ready queue, the director does not enqueue another natural entry
- queued scheduler items now carry `trigger_locked`
- `chain_root` and `pool` condition events check `trigger_expr` at enqueue time; once queued, they keep execution eligibility even if related variable values change before playback
- `default` events do not execute `trigger_expr`; `invoke` events are excluded from normal scanning
- `schedule_events` keep one next-due schedule per event, enter `scheduled`, and are promoted into `ready_queue` when due
- schedule condition events re-check `trigger_expr` only when they become due
- if a schedule event reaches due time but its `trigger_expr` is false, the current cycle is skipped and the next cycle is scheduled
- a skipped loop cycle does not increment `scheduler.loop_states[].trigger_count`
- a skipped loop cycle does not write `loop_event_states`
- ready schedule items due at the same minute are ordered by dependency (`after` / `before`), then lower `priority`, then scheduler `seq`
- only one front-stage event may run at a time through `scheduler.active`
- while a front-stage event is running, `event_pause` is set to `true`, so story playback pauses game time automatically
- runtime clock progression now uses stepwise reconciliation:
  - queue scaled time into `clock.pending_minutes`
  - advance one clock step at a time
  - reconcile scheduler after each step
  - if an event becomes active, stop advancing time immediately
- due schedule events are first removed from `scheduled`, then inserted into `ready_queue`
  - this avoids self-deduping bugs where a due schedule item could stay forever at the same due minute
- passive events now auto-settle:
  - if an entered event has no dialogue and no action branches, runtime auto-runs its end flow
  - this is important for settlement-style loop events such as daily income payout
- event completion now clears current runtime event state through a shared helper, reducing branch-specific cleanup drift
- a scheduled queue item now represents a full front-stage event chain, not only the first event node
  - chain root -> event -> event chains stay inside the same `scheduler.active` instance until the chain truly ends
  - action-branch flows also stay inside the same `scheduler.active` instance until the branch resolves or the chain ends
  - if a branch next-event is missing or blocked by `trigger_expr`, the current scheduled chain now completes cleanly instead of leaving `scheduler.active` stuck
  - when a graph event has multiple direct event `next` nodes, runtime now checks them in declared order and picks the first enterable one

Current event-source coverage:

- `chain_root`: fully connected
- `pool`: fully connected for first-pass runtime playback
- `schedule`: first-pass scheduler connected for `daily`, `weekly`, `monthly`, and `interval_days`

Current loop timing rule:

- scheduler stores due time in game minutes
- schedule events trigger at their configured `loop.at` time of day; missing `at` defaults to `00:00`
- next cycle is recalculated after each schedule completion
- verified behavior for the demo `daily_money` loop:
  - after the opening chain root / pool chain finishes
  - advancing game time to day `2` `00:00`
  - triggers `daily_population_flow` first because `daily_money.loop.after` includes it
  - then triggers `daily_money`
  - auto-runs their script/end flow after message presentation finishes
  - increases `player.money`
  - records loop trigger state
  - reschedules the next due instance for day `3` `00:00`
- refined first-due / next-due semantics:
  - `daily`: first due is the next day at `loop.at`, then every `+1` day
  - `interval_days`: first due is `N` days later at `loop.at`, then every `+N` days
  - `weekly`: first due is the next matching weekday at `loop.at` (never same-day immediate), then every `+7` days from the last due minute
  - `monthly`: first due can land later in the current month if `month_day` is still ahead; otherwise it lands in the next month; later cycles always advance month-by-month from the last due date
- ready-queue ordering is deterministic:
  - ready items are sorted by `due_game_minute`
  - same-minute ties honor `after` / `before`
  - remaining ties use lower `priority`
  - final ties use scheduler `seq`
- loop trigger-day records now respect `clock.base_day`
  - `loop_event_states.last_triggered_day` is game-day aware, not just minute-offset based

`packages/core/src/vals.ts` now re-exports the runtime implementation for compatibility.

## 10. HTML client status

`apps/html-client` is the active local gameplay/runtime shell. The old `apps/tui-client` module has been removed.

Implemented:

- local story bundle sync by reading `data/stories/<storyId>` through `@story-mgr/file-store` and compiling through `@story-mgr/compiler`
- local runtime storage layout under `.html-client/stories/<storyId>/`
- story-specific browser routes under `/<storyId>/` with `/` redirecting to the selected story
- profile storage via `custom.json5`
- player-creation flow driven by `player_override_vals.json5`
- save slots via `*.json5`
- runtime session control through `apps/html-client/src/client-app.ts`
- browser UI served by `apps/html-client/src/server.ts` and static files in `apps/html-client/public/`
- game layout follows header / game area / footer, with footer command popups for phone, messages, variables, scheduler, bag, and saves
- the old topbar sync/profile/save/phone buttons are removed; story sync now happens automatically before starting or loading a session
- runtime time controls are wired through shared session APIs
- phone contacts are available in the footer and unread phone messages flash as a reminder
- the phone drawer uses a left/right contact-thread layout; chat history keeps cross-day messages and refreshes when the next day is advanced
- number keys `1` through `9` select current game-area options

Current HTML local layout:

```txt
.html-client/
  stories/
    <storyId>/
      bundle.json
      profiles/
        <profileId>/
          custom.json5
          saves/
            <slotId>.json5
```

Profile `custom.json5` may include `player_setup`, while `custom_values` remains the actual override layer applied to the runtime bundle.

Profile creation rules:

- the editor controls player-input fields through `player_override_vals.json5`
- the HTML client asks only rows where `need_player_override === true`
- prompts are grouped by `group_no`
- `input_type: "text"` renders a text input
- `input_type: "select"` renders a select using `input_options`
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
pnpm html -- --story demo
```

Current HTML game-screen behavior:

- header: current event title, location/time, and running state
- game area: runtime content, dialogue, message prompts, branch options, or empty-state text
- footer: left shows role, money, and phone unread status; right shows `N 下一天`
- footer command row opens popups for messages, bag, variables, scheduler, saves, and phone
- `space` pauses/resumes time
- `n` advances to the next day boundary
- `p` opens/closes phone
- `l`, `b`, `i`, `o`, `t`, and `s` open footer popups
- `Esc` closes an open popup or phone; when no popup is open it returns to the main profile screen
- `1` to `9` select current interaction options

## 11. Cocos client status

`apps/cocos-client` exists only as a placeholder shell right now.

The intended rule is:

- `html-client` validates local runtime semantics during browser-based prototyping
- `cocos-client` should focus on presentation and platform integration
- both should reuse `packages/runtime`

## 12. Current known gaps

- save snapshots do not yet persist transient cursor state such as current dialogue index, pending action list, and branch context
- loading a save currently restores values and `current_event_id`, but does not resume mid-dialogue
- `player_setup` inference is still convention-based for known fields such as `player.name_xing`, `player.name_ming`, `county.name_full`, `county.name_short`, `county.parent_city`, and `county.province`
- scene/background presentation and audio are not yet represented in the HTML runtime client
- `system.now_jieqi` is still a placeholder and currently resolves to an empty string
- long-term rule "system variables are runtime-owned and script read-only" is not fully enforced yet
- scheduler state is present in snapshots, but save/load resume is not yet fine-grained enough to restore mid-dialogue playback cursor and branch pending state
- loop scheduling is implemented with `at`, dependency, and priority ordering; future refinement is still needed for richer scheduling policies
- runtime regression coverage exists as script commands, but it is not yet integrated into a broader test runner

## 13. Next recommended steps

- stabilize the long-term variable contract for player creation
- reuse the same player-creation contract in the future Cocos onboarding flow
- persist transient runtime session state so save/load resumes mid-event correctly
- enforce runtime-owned system-variable write protection where appropriate
- expand loop scheduling regression coverage beyond the current script harness
- add scheduler-focused tests around root-event auto discovery
- add scheduler-focused tests around once single-consume behavior
- add scheduler-focused tests around loop due-time promotion
- add scheduler-focused tests around manual pause vs event pause interaction
- add regression tests around bundle -> custom -> save layering
- add regression tests around branch-variable read/write semantics
- add regression tests around dialogue placeholder rendering
- add regression tests around save/load resume behavior
- add regression tests around time progression and system-time synchronization

## 14. Collaboration rules

- prefer direct code changes over discussion-only responses
- when changing data contracts, check `core`, `runtime`, `compiler`, `file-store`, `api`, and `web`
- prefer ASCII in edited files unless non-ASCII is necessary
- 新增代码注释统一使用中文，保持简洁，优先解释关键逻辑与边界
- use `apply_patch` for manual file edits
- do not revert unrelated user changes

