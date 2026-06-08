# Runtime

`packages/runtime` contains shared runtime behavior that should be reused by:

- `apps/tui-client`
- `apps/cocos-client`
- editor-side validation paths that need the same semantics

## Current responsibilities

- value parsing and formatting
- `calc_rule` evaluation
- boolean trigger expression evaluation
- simple event script execution and validation
- runtime session bootstrapping

## Implemented rules

### `calc_rule`

- supports same-group references with `{row}`
- supports cross-group references with `{group.row}`
- resolves nested calc values recursively
- supports common `Math` functions and constants
- must return a finite number

### `trigger_expr`

- supports `${group.row}` placeholders
- resolves calc variables before comparison
- supports common `Math` functions
- must return `boolean`
- empty expression is treated as `true`

### event scripts

Currently supported statements:

```txt
let temp = expression
temp = expression
temp += expression
temp -= expression
temp *= expression
temp /= expression
temp %= expression
${group.row} = expression
${group.row} += expression
${group.row} -= expression
${group.row} *= expression
${group.row} /= expression
${group.row} %= expression
if (...) { ... } else { ... }
switch (...) { ... }
for (...) { ... }
while (...) { ... }
break
continue
return
```

Restrictions:

- cannot assign to `calc` variables
- cannot assign to `system.xxx`
- cannot assign to `call.xxx`
- no function declarations
- temporary variables must use `let`

## Runtime session

`src/session.ts` currently provides:

- profile custom file type
- save-state type
- session snapshot type
- `createStorySession()`

Layering order:

1. compiled story bundle
2. profile `custom.json5` overrides
3. save snapshot overrides both
