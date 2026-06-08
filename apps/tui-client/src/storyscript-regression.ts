import {
  evaluateStoryBooleanExpression,
  executeStoryScript,
  renderStoryTextTemplate,
  validateStoryScript,
  validateStoryTextTemplate,
  type StoryValsFile
} from "@story-mgr/runtime"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function createRegressionVals(): StoryValsFile {
  return {
    variables: [{
      name: "player",
      vals: [
        {
          name: "money",
          value_type: "value",
          value: 100,
          calc_rule: ""
        },
        {
          name: "flag",
          value_type: "value",
          value: 0,
          calc_rule: ""
        },
        {
          name: "bonus",
          value_type: "calc",
          value: 0,
          calc_rule: "{money} * 2"
        }
      ]
    }, {
      name: "county",
      vals: [{
        name: "level",
        value_type: "value",
        value: 3,
        calc_rule: ""
      }]
    }]
  }
}

function readValue(valsFile: StoryValsFile, token: string) {
  const [groupName, rowName] = token.split(".")
  const group = valsFile.variables.find((item) => item.name === groupName)
  const row = group?.vals.find((item) => item.name === rowName)
  return row?.value
}

function testPredicateReadOnly() {
  const vals = createRegressionVals()

  let errorMessage = ""
  try {
    evaluateStoryBooleanExpression(vals, "if (${county.level} > 0) { ${player.money} += 1; return true } return false")
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  assert(
    errorMessage.includes("read-only"),
    `Expected predicate assignment to be rejected, received: ${errorMessage}`
  )
}

function testPredicateInvokeRejected() {
  const vals = createRegressionVals()

  let errorMessage = ""
  try {
    evaluateStoryBooleanExpression(
      vals,
      [
        "if (${county.level} > 0) {",
        "  invoke_once test1 mama=${county.level}",
        "  return true",
        "}",
        "return false"
      ].join("\n")
    )
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  assert(
    errorMessage.includes("cannot invoke events"),
    `Expected predicate invoke_once to be rejected, received: ${errorMessage}`
  )
}

function testProcedureControlFlowAndAssignments() {
  const vals = createRegressionVals()
  const result = executeStoryScript(
    vals,
    [
      "let total = 0",
      "for (let index = 0; index < 3; index += 1) {",
      "  total += index",
      "}",
      "if (total === 3) {",
      "  ${player.money} += total",
      "  ${player.flag} = 1",
      "}",
      "while (${player.flag} < 3) {",
      "  ${player.flag} += 1",
      "}",
      "invoke_once test1 mama=${county.level} money=${player.money}"
    ].join("\n")
  )

  assert(readValue(result.vals, "player.money") === 103, "Expected player.money to become 103.")
  assert(readValue(result.vals, "player.flag") === 3, "Expected player.flag to become 3.")
  assert(result.invocations.length === 1, "Expected one invoke_once invocation.")
  assert(result.invocations[0]?.eventId === "test1", "Expected invoke_once event id to be test1.")
  assert(result.invocations[0]?.args.mama === 3, "Expected invoke_once arg mama to be 3.")
  assert(result.invocations[0]?.args.money === 103, "Expected invoke_once arg money to be 103.")
}

function testSwitchBreakContinue() {
  const vals = createRegressionVals()
  const result = executeStoryScript(
    vals,
    [
      "let total = 0",
      "for (let index = 0; index < 5; index += 1) {",
      "  if (index === 1) {",
      "    continue",
      "  }",
      "  switch (index) {",
      "    case 0:",
      "      total += 10",
      "      break",
      "    case 2:",
      "      total += 20",
      "      break",
      "    default:",
      "      total += 1",
      "      break",
      "  }",
      "  if (index === 3) {",
      "    break",
      "  }",
      "}",
      "${player.money} += total"
    ].join("\n")
  )

  assert(readValue(result.vals, "player.money") === 131, "Expected switch/break/continue flow to add 31 money.")
}

function testCalcAssignmentRejected() {
  const vals = createRegressionVals()
  const issues = validateStoryScript(vals, "${player.bonus} = 1")

  assert(issues.length === 1, "Expected calc assignment to produce one validation issue.")
  assert(
    issues[0]?.message.includes("Cannot assign to calc variable"),
    `Expected calc assignment error message, received: ${issues[0]?.message ?? ""}`
  )
}

function testLoopLimit() {
  const vals = createRegressionVals()

  let errorMessage = ""
  try {
    executeStoryScript(vals, "while (true) { }")
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  assert(
    errorMessage.includes("maximum iteration count"),
    `Expected loop limit error, received: ${errorMessage}`
  )
}

function testTemplateSyntax() {
  const vals = createRegressionVals()
  const issues = validateStoryTextTemplate("现在等级是 {county.level}")

  assert(issues.length === 1, "Expected legacy template placeholder to produce one validation issue.")
  assert(
    issues[0]?.message.includes("must use ${...}"),
    `Expected legacy template error message, received: ${issues[0]?.message ?? ""}`
  )

  const rendered = renderStoryTextTemplate(
    vals,
    "账上还有 ${player.money}，县城等级 ${county.level}。",
    undefined
  )
  assert(rendered === "账上还有 100，县城等级 3。", `Unexpected rendered template: ${rendered}`)
}

function main() {
  testPredicateReadOnly()
  testPredicateInvokeRejected()
  testProcedureControlFlowAndAssignments()
  testSwitchBreakContinue()
  testCalcAssignmentRejected()
  testLoopLimit()
  testTemplateSyntax()
  console.log("StoryScript regression passed.")
}

main()
