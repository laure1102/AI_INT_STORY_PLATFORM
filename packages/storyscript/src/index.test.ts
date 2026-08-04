import { describe, expect, it } from "vitest"
import {
  StoryScriptError,
  evaluateStoryBooleanExpression,
  evaluateStoryValCalcRule,
  executeStoryScript,
  renderStoryTextTemplate,
  validateStoryScript
} from "./index.js"

function createVals() {
  return {
    variables: [
      {
        name: "player",
        vals: [
          { name: "money", value_type: "value" as const, value: 100, calc_rule: "" },
          { name: "name", value_type: "value" as const, value: "  Alice  ", calc_rule: "" },
          { name: "level", value_type: "value" as const, value: 2, calc_rule: "" },
          { name: "double_money", value_type: "calc" as const, calc_rule: "{player.money} * 2" }
        ]
      }
    ]
  }
}

describe("StoryScript", () => {
  it("evaluates calculations and placeholder predicates", () => {
    const vals = createVals()
    expect(evaluateStoryValCalcRule(vals.variables[0]!, "{money} + {player.level}", { valsFile: vals }).result).toBe(102)
    expect(evaluateStoryBooleanExpression(vals, "${player.money} >= 100 && ${player.level} === 2").result).toBe(true)
  })

  it("executes assignments, compound assignments, and control flow", () => {
    const result = executeStoryScript(createVals(), `
      let reward = 0
      for (let index = 0; index < 4; index += 1) {
        if (index === 1) continue
        reward += index
      }
      while (reward < 8) reward += 1
      switch (reward) {
        case 8:
          reward += 2
          break
        default:
          reward = 0
      }
      if (reward === 10) {
        \${player.money} += reward
      }
    `)

    expect(result.vals.variables[0]!.vals[0]!.value).toBe(110)
    expect(result.locals.reward).toBe(10)
  })

  it("only exposes whitelisted string methods and deterministic random", () => {
    const randomValues = [0.25, 0.75]
    const result = executeStoryScript(createVals(), `
      let normalized = \${player.name}.trim().toUpperCase()
      let first = Math.random()
      let second = random()
    `, 5, { random: () => randomValues.shift() ?? 0 })

    expect(result.locals).toMatchObject({ normalized: "ALICE", first: 0.25, second: 0.75 })
    expect(() => executeStoryScript(createVals(), "let value = [1, 2, 3]")).toThrow(/Unsupported StoryScript expression: ArrayExpression/)
    expect(() => executeStoryScript(createVals(), "let value = globalThis.process")).toThrow(/Unsupported identifier/)
  })

  it("records invoke_once arguments and delay metadata", () => {
    const result = executeStoryScript(createVals(), "invoke_once pool reward delay_days=2 amount=${player.money}")
    expect(result.invocations).toEqual([{
      targetType: "pool",
      eventId: "reward",
      args: { amount: 100 },
      delay: { unit: "days", value: 2 }
    }])
  })

  it("enforces the step and loop limits", () => {
    expect(() => executeStoryScript(createVals(), "while (true);"))
      .toThrow(/maximum loop iteration count/)
    const oversized = `let value = 0;\n${"value += 1;\n".repeat(10_001)}`
    expect(() => executeStoryScript(createVals(), oversized)).toThrow(/maximum step count/)
  })

  it("renders templates and reports validation line numbers", () => {
    expect(renderStoryTextTemplate(createVals(), "Hello ${player.name}, money=${player.money}.")).toBe("Hello   Alice  , money=100.")
    expect(validateStoryScript(createVals(), "let ok = 1\nconst blocked = 2")).toEqual([
      expect.objectContaining({ lineNumber: 2, message: expect.stringMatching(/only supports let/) })
    ])
    expect(() => executeStoryScript(createVals(), "\nconst blocked = 2")).toThrow(StoryScriptError)
  })
})
