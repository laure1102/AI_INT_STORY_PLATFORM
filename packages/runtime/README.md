# Runtime

`packages/runtime` contains shared runtime behavior that should be reused by:

- `apps/html-client`
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
- only applies when `trigger_mode` is `condition`
- `condition` events require a non-empty expression
- `default` events do not execute `trigger_expr`

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

### Runtime actions

Clients mutate session state through `RuntimeStorySession.dispatch(action)`.

- `{ type: "shop-buy", productId }` pays for a product and adds it to the player bag.
- `{ type: "shop-gift", productId, roleKey }` pays for a product and sends it directly to a contact without using the bag.
- `{ type: "bag-gift", itemId, roleKey, quantity }` consumes an already-owned player-bag item and sends it to an existing contact.
- `bag-gift` returns `true` on success and `false` after a handled domain rejection, so clients can preserve unfinished form selections.

`bag-gift` resolves gift behavior from the unique `shop.products[]` row whose `item_id` matches and whose `allow_gift` is `true`. It ignores shop enablement, price, purchase predicates, and purchase cooldown, but shares the product/contact `shop.gifts` cooldown with `shop-gift`. Bound items, missing contacts, contact relationship locks, and active plot-contact chat locks are rejected before inventory mutation.
