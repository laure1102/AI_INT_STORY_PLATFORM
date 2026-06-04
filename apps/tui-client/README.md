# TUI Client

`apps/tui-client` is the Ink-based text UI runtime shell for Story Manager.

It is not meant to be a throwaway debug script. The long-term goal is:

- validate the shared runtime flow before the Cocos client exists
- keep gameplay logic inside shared packages, not inside the UI shell
- make the future `apps/cocos-client` reuse the same runtime session model

## Current scope

The current implementation already includes:

- local story bundle sync from `data/stories/<storyId>`
- local profile storage via `custom.json5`
- player creation driven by `player_override_vals.json5`
- local save slots via `*.json5`
- a bootstrap flow:
  1. sync story bundle
  2. select or create profile
  3. load profile custom values
  4. select save or start new game
  5. create runtime session
  6. enter game
- an Ink-based interactive TUI shell

## Local data layout

By default, runtime data is written under:

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

## Commands

Run the TUI client:

```bash
pnpm --filter @story-mgr/tui-client dev -- --story demo
```

Or from workspace root:

```bash
pnpm tui -- --story demo
```

Useful flags:

- `--story <storyId>`
- `--runtime-dir <path>`
- `--data-dir <path>`
- `--profile <profileId>`
- `--slot <slotId>`
- `--new`

## Notes

- The current TUI is still a runtime validation shell, not the final player-facing UX.
- Player creation already writes `player_setup` into `custom.json5`, while runtime overrides still come from `custom_values`.
- The editor now controls player-input fields through `player_override_vals.json5`; the TUI asks only rows marked `need_player_override: true` and writes answers to `custom_values`.
- `player_setup` is inferred from common custom fields when possible, so existing runtime summaries can still show player name and location.
- `tui-client` must run in a real interactive terminal. If `stdin`/`stdout` is not a TTY, Ink can't enable raw mode and startup will fail.
- The important part today is that `tui-client` already exercises the same runtime session flow that future clients will use.
