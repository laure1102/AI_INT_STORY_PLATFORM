/**
 * StoryScript 安全 AST 解释器。
 *
 * 解释器只支持白名单 AST 节点，并通过步数和循环次数上限阻止失控脚本。
 * 源码预处理位于 source.ts，对外调用位于 api.ts。本模块不访问浏览器、文件或网络。
 */
import {
  DEFAULT_MAX_CALC_NESTING_DEPTH,
  StoryScriptError,
  type AstNode,
  type StoryScriptExecutionContext,
  type StoryScriptInvocation,
  type StoryScriptInvokeDelay,
  type StoryScriptInvokeDelayUnit,
  type StoryValCalcEvaluation,
  type StoryValDefinition,
  type StoryValEntryDefinition,
  type StoryValsFile
} from "./types"
import { compileSource, INTERNAL_INVOKE, parseProgram } from "./source"
import { asNode, asNodes, asOptionalNode, fail } from "./ast"
import { createBoundMethod, createSafeMath, globalFunctions } from "./safe-globals"
import {
  buildReadableValues,
  cloneValsFile,
  findValueEntry,
  formatTemplateValue,
  isCalcRow,
  normalizeGroupName,
  normalizeRowName,
  toNumericValue
} from "./runtime-values"

type Flow =
  | { kind: "normal" }
  | { kind: "break" }
  | { kind: "continue" }
  | { kind: "return"; value: unknown }

interface InterpreterState {
  valsFile: StoryValsFile
  locals: Record<string, unknown>
  invocations: StoryScriptInvocation[]
  context: StoryScriptExecutionContext
  placeholders: Map<string, string>
  safeMath: Readonly<Record<string, unknown>>
  stepCount: number
  loopIterations: number
  lastExpressionValue: unknown
  maxDepth: number
}

const MAX_STEPS = 20000
const MAX_LOOP_ITERATIONS = 5000

/**
 * 为每次 AST 求值累计一个安全步数。
 *
 * @param state 当前解释器状态，stepCount 会被原地加一。
 * @param node 当前节点，用于超限时报告准确行号。
 * @returns 无返回值。
 * @throws 超过 20000 步时中止脚本，防止超长表达式或语句耗尽线程。
 */
function bumpStep(state: InterpreterState, node: AstNode) {
  state.stepCount += 1
  if (state.stepCount > MAX_STEPS) {
    fail(node, `StoryScript exceeded the maximum step count of ${MAX_STEPS}.`)
  }
}

/**
 * 累计 while/for 循环真正执行的次数。
 *
 * @param state 当前解释器状态。
 * @param node 当前循环节点。
 * @returns 无返回值。
 * @throws 总循环次数超过 5000 时中止，避免死循环卡住编辑器或游戏。
 */
function bumpLoop(state: InterpreterState, node: AstNode) {
  state.loopIterations += 1
  if (state.loopIterations > MAX_LOOP_ITERATIONS) {
    fail(node, `StoryScript exceeded the maximum loop iteration count of ${MAX_LOOP_ITERATIONS}.`)
  }
}

/**
 * 解析一个 `${组.变量}` token 的当前值。
 *
 * @param valsFile 当前脚本使用的变量副本。
 * @param token 不带 `${}` 的完整变量名。
 * @param maxDepth calc 变量递归深度上限。
 * @param contextValues 调用参数、称谓等优先级更高的外部值。
 * @returns 普通变量值，或递归算出的 calc 数字。
 * @throws 引用不存在、calc 形成环或计算结果非法时抛错。
 */
export function resolveValue(
  valsFile: StoryValsFile,
  token: string,
  maxDepth: number,
  contextValues: Record<string, unknown>
): unknown {
  if (Object.prototype.hasOwnProperty.call(contextValues, token)) {
    return contextValues[token]
  }
  const reference = findValueEntry(valsFile, token)
  if (!isCalcRow(reference.row)) {
    return reference.row.value
  }
  return evaluateStoryValCalcRule(reference.group, reference.row.calc_rule, {
    valsFile,
    maxDepth,
    depth: 1,
    visited: new Set([`${reference.groupName}.${reference.rowName}`])
  }).result
}

/**
 * 给占位符引用的变量赋值，并执行只读边界检查。
 *
 * @param state 当前解释器状态。
 * @param token 目标变量名。
 * @param value 已求值的新值。
 * @param node 赋值语法节点。
 * @returns 无返回值；成功时修改变量副本或 assignableValues 副本。
 * @throws 禁止修改 call 参数、system 变量和 calc 变量。
 */
function assignValue(state: InterpreterState, token: string, value: unknown, node: AstNode) {
  if (token.startsWith("call.")) {
    fail(node, `Cannot assign to invoke parameter: \${${token}}`)
  }
  if (token.startsWith("system.")) {
    fail(node, `Cannot assign to system variable: \${${token}}`)
  }
  if (Object.prototype.hasOwnProperty.call(state.context.assignableValues ?? {}, token)) {
    state.context.assignableValues![token] = value
    return
  }
  const reference = findValueEntry(state.valsFile, token)
  if (isCalcRow(reference.row)) {
    fail(node, `Cannot assign to calc variable: \${${token}}`)
  }
  reference.row.value = value
}

/**
 * 替换字符串字面量里预编译的变量标识符。
 *
 * @param value AST 中的字符串值。
 * @param state 保存标识符到原 token 的映射。
 * @param node 当前字面量节点，用于错误定位。
 * @returns 插入当前变量值后的字符串。
 */
function renderLiteralString(value: string, state: InterpreterState, node: AstNode) {
  return value.replace(/__story_ref_\d+/g, (identifier) => {
    const token = state.placeholders.get(identifier)
    if (!token) {
      return identifier
    }
    return formatTemplateValue(resolveValue(state.valsFile, token, state.maxDepth, buildReadableValues(state.context)))
  })
}

/**
 * 按严格白名单解析一个标识符。
 *
 * @param name AST 中出现的名字。
 * @param state 当前解释器状态。
 * @param node 当前节点。
 * @returns 局部值、上下文值、占位符值、安全 Math 成员或允许调用的函数。
 * @throws 名字未声明或不在白名单中时抛错；因此脚本无法接触全局对象。
 */
function identifierValue(name: string, state: InterpreterState, node: AstNode) {
  if (Object.prototype.hasOwnProperty.call(state.locals, name)) {
    return state.locals[name]
  }
  if (Object.prototype.hasOwnProperty.call(state.context.values ?? {}, name)) {
    return state.context.values![name]
  }
  const token = state.placeholders.get(name)
  if (token) {
    return resolveValue(state.valsFile, token, state.maxDepth, buildReadableValues(state.context))
  }
  if (name === "Math") {
    return state.safeMath
  }
  if (name === "random") {
    return state.safeMath.random
  }
  if (Object.prototype.hasOwnProperty.call(state.safeMath, name)) {
    return state.safeMath[name]
  }
  if (Object.prototype.hasOwnProperty.call(globalFunctions, name)) {
    return globalFunctions[name]
  }
  const contextFunction = state.context.functions?.[name]
  if (contextFunction) {
    return contextFunction
  }
  fail(node, `Unsupported identifier in StoryScript: ${name}`)
}

/**
 * 执行 StoryScript 支持的二元运算。
 *
 * @param operator Acorn 解析出的运算符。
 * @param left 左操作数。
 * @param right 右操作数。
 * @param node 运算节点，用于错误行号。
 * @returns 运算结果；加号遇到字符串时做拼接，其余算术运算转成 number。
 * @throws 运算符不在白名单时抛错。
 */
function binary(operator: string, left: unknown, right: unknown, node: AstNode): unknown {
  switch (operator) {
    case "+": return typeof left === "string" || typeof right === "string" ? String(left) + String(right) : Number(left) + Number(right)
    case "-": return Number(left) - Number(right)
    case "*": return Number(left) * Number(right)
    case "/": return Number(left) / Number(right)
    case "%": return Number(left) % Number(right)
    case "**": return Number(left) ** Number(right)
    case "<": return (left as string | number) < (right as string | number)
    case "<=": return (left as string | number) <= (right as string | number)
    case ">": return (left as string | number) > (right as string | number)
    case ">=": return (left as string | number) >= (right as string | number)
    case "==": return left === right
    case "!=": return left !== right
    case "===": return left === right
    case "!==": return left !== right
    default: return fail(node, `Unsupported StoryScript operator: ${operator}`)
  }
}

/**
 * 把赋值左侧收窄为“脚本局部变量”或“故事变量占位符”。
 *
 * @param node 等号左边的 AST 节点。
 * @param state 用于识别预编译占位符的解释器状态。
 * @returns 带 kind 和真实名称的赋值目标描述。
 * @throws 左侧不是简单 Identifier 时抛错，禁止任意对象属性写入。
 */
function assignmentTarget(node: AstNode, state: InterpreterState) {
  if (node.type !== "Identifier") {
    fail(node, "StoryScript assignment target must be a local or placeholder variable.")
  }
  const name = String(node.name ?? "")
  const token = state.placeholders.get(name)
  return token ? { kind: "placeholder" as const, name: token } : { kind: "local" as const, name }
}

/**
 * 读取复合赋值左侧的旧值，例如 `money += 10` 中的 money。
 *
 * @param target 已经分类的赋值目标。
 * @param state 当前解释器状态。
 * @param node 当前赋值节点。
 * @returns 故事变量或局部变量的当前值。
 */
function readAssignmentTarget(target: ReturnType<typeof assignmentTarget>, state: InterpreterState, node: AstNode) {
  return target.kind === "placeholder"
    ? resolveValue(state.valsFile, target.name, state.maxDepth, buildReadableValues(state.context))
    : identifierValue(target.name, state, node)
}

/**
 * 写回普通赋值或复合赋值的最终值。
 *
 * @param target 已分类的赋值目标。
 * @param value 要保存的结果。
 * @param state 当前解释器状态。
 * @param node 当前赋值节点。
 * @returns 原样返回 value，使赋值表达式本身也有求值结果。
 * @throws 局部变量未提前用 let 声明，或故事变量不可写时抛错。
 */
function writeAssignmentTarget(
  target: ReturnType<typeof assignmentTarget>,
  value: unknown,
  state: InterpreterState,
  node: AstNode
) {
  if (target.kind === "placeholder") {
    assignValue(state, target.name, value, node)
  } else {
    if (!Object.prototype.hasOwnProperty.call(state.locals, target.name)) {
      fail(node, `Unknown local variable: ${target.name}`)
    }
    state.locals[target.name] = value
  }
  return value
}

/**
 * 解释 `invoke_once` 参数所需的普通对象字面量。
 *
 * @param node ObjectExpression 节点。
 * @param state 当前解释器状态。
 * @returns 递归求值后的键值对象。
 * @throws 计算属性、getter/setter 等非普通属性会被拒绝，避免扩大语言能力。
 */
function evaluateObject(node: AstNode, state: InterpreterState) {
  const output: Record<string, unknown> = {}
  for (const property of asNodes(node.properties)) {
    if (property.type !== "Property" || property.computed || property.kind !== "init") {
      fail(property, "StoryScript object properties must be plain name/value entries.")
    }
    const keyNode = asNode(property.key)
    const key = keyNode.type === "Identifier" ? String(keyNode.name) : String(keyNode.value)
    output[key] = evaluateExpression(asNode(property.value), state)
  }
  return output
}

/**
 * 记录一次预编译后的 `invoke_once` 调用。
 *
 * @param node 内部函数调用节点，前三个参数分别是类型、事件 id 和参数对象。
 * @param state 当前解释器状态，调用结果会追加到 invocations。
 * @returns null；事件不会在解释器中立即执行，而是交给 Runtime 调度。
 * @throws 参数不是对象、存在多个 delay 或 delay 不是非负整数时抛错。
 */
function executeInvoke(node: AstNode, state: InterpreterState) {
  const args = asNodes(node.arguments)
  const targetType = String(evaluateExpression(args[0]!, state)) as StoryScriptInvocation["targetType"]
  const eventId = String(evaluateExpression(args[1]!, state))
  const rawArgs = evaluateExpression(args[2]!, state)
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    fail(node, "invoke_once arguments must be an object.")
  }
  const invocationArgs = { ...(rawArgs as Record<string, unknown>) }
  const delayFields = ["delay_hours", "delay_days", "delay_months", "delay_years"]
    .filter((field) => Object.prototype.hasOwnProperty.call(invocationArgs, field))
  if (delayFields.length > 1) {
    fail(node, "invoke_once accepts at most one delay field.")
  }
  let delay: StoryScriptInvokeDelay | undefined
  if (delayFields[0]) {
    const field = delayFields[0]
    const value = invocationArgs[field]
    delete invocationArgs[field]
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      fail(node, `invoke_once ${field} must resolve to a non-negative integer.`)
    }
    delay = {
      unit: field.slice("delay_".length) as StoryScriptInvokeDelayUnit,
      value
    }
  }
  state.invocations.push({ targetType, eventId, args: invocationArgs, delay })
  return null
}

/**
 * 递归解释一个表达式节点。
 *
 * @param node 要求值的 Acorn AST 节点。
 * @param state 当前变量、局部值、白名单函数和安全计数器。
 * @returns 字面量、逻辑/算术结果、赋值结果、函数结果或对象。
 * @throws 节点类型、属性访问或调用目标不在白名单时抛错。
 *
 * 逻辑运算保留 JavaScript 的短路规则：左侧已经能决定结果时不会执行右侧，这对带副作用的领域
 * 函数非常重要。每进入一个节点都先 bumpStep，所以深层表达式也受总步数保护。
 */
function evaluateExpression(node: AstNode, state: InterpreterState): unknown {
  bumpStep(state, node)
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? renderLiteralString(node.value, state, node) : node.value
    case "Identifier":
      return identifierValue(String(node.name ?? ""), state, node)
    case "UnaryExpression": {
      const value = evaluateExpression(asNode(node.argument), state)
      if (node.operator === "!") return !value
      if (node.operator === "+") return +Number(value)
      if (node.operator === "-") return -Number(value)
      return fail(node, `Unsupported unary operator: ${String(node.operator)}`)
    }
    case "ConditionalExpression":
      return evaluateExpression(asNode(node.test), state)
        ? evaluateExpression(asNode(node.consequent), state)
        : evaluateExpression(asNode(node.alternate), state)
    case "LogicalExpression": {
      const left = evaluateExpression(asNode(node.left), state)
      if (node.operator === "&&") return left ? evaluateExpression(asNode(node.right), state) : left
      if (node.operator === "||") return left ? left : evaluateExpression(asNode(node.right), state)
      if (node.operator === "??") return left ?? evaluateExpression(asNode(node.right), state)
      return fail(node, `Unsupported logical operator: ${String(node.operator)}`)
    }
    case "BinaryExpression":
      return binary(
        String(node.operator),
        evaluateExpression(asNode(node.left), state),
        evaluateExpression(asNode(node.right), state),
        node
      )
    case "AssignmentExpression": {
      const target = assignmentTarget(asNode(node.left), state)
      const right = evaluateExpression(asNode(node.right), state)
      const operator = String(node.operator)
      const value = operator === "="
        ? right
        : binary(operator.slice(0, -1), readAssignmentTarget(target, state, node), right, node)
      return writeAssignmentTarget(target, value, state, node)
    }
    case "MemberExpression": {
      if (node.computed) {
        return fail(node, "Computed property access is not supported in StoryScript.")
      }
      const target = evaluateExpression(asNode(node.object), state)
      const property = String(asNode(node.property).name ?? "")
      if (target === state.safeMath && Object.prototype.hasOwnProperty.call(state.safeMath, property)) {
        return state.safeMath[property]
      }
      const method = createBoundMethod(target, property)
      return method ?? fail(node, `Unsupported StoryScript property: ${property}`)
    }
    case "CallExpression": {
      const calleeNode = asNode(node.callee)
      if (calleeNode.type === "Identifier" && calleeNode.name === INTERNAL_INVOKE) {
        return executeInvoke(node, state)
      }
      const callee = evaluateExpression(calleeNode, state)
      if (typeof callee !== "function") {
        return fail(node, "StoryScript call target must be a function.")
      }
      return callee(...asNodes(node.arguments).map((argument) => evaluateExpression(argument, state)))
    }
    case "ObjectExpression":
      return evaluateObject(node, state)
    default:
      return fail(node, `Unsupported StoryScript expression: ${node.type}`)
  }
}

const NORMAL_FLOW: Flow = { kind: "normal" }

/**
 * 顺序执行一组语句，并传播 break/continue/return 控制流。
 *
 * @param nodes 同一 Program 或 Block 中的语句节点。
 * @param state 当前解释器状态。
 * @returns normal 表示全部执行完；其他 Flow 要交给外层循环或 run 处理。
 */
function executeStatements(nodes: AstNode[], state: InterpreterState): Flow {
  for (const node of nodes) {
    const flow = executeStatement(node, state)
    if (flow.kind !== "normal") {
      return flow
    }
  }
  return NORMAL_FLOW
}

/**
 * 执行 `let name = expression` 局部变量声明。
 *
 * @param node VariableDeclaration 节点。
 * @param state 当前解释器状态，locals 会被原地更新。
 * @returns 无返回值。
 * @throws 使用 var/const、解构或其他非简单标识符声明时抛错。
 */
function executeVariableDeclaration(node: AstNode, state: InterpreterState) {
  if (node.kind !== "let") {
    fail(node, "StoryScript only supports let declarations.")
  }
  for (const declaration of asNodes(node.declarations)) {
    const identifier = asNode(declaration.id)
    if (identifier.type !== "Identifier") {
      fail(identifier, "StoryScript variable declarations require an identifier.")
    }
    const name = String(identifier.name)
    state.locals[name] = declaration.init ? evaluateExpression(asNode(declaration.init), state) : undefined
  }
}

/**
 * 执行 switch，并模拟从首个匹配 case 向下贯穿的语义。
 *
 * @param node SwitchStatement 节点。
 * @param state 当前解释器状态。
 * @returns break 会在本函数内消费为 normal；return/continue 继续向外传播。
 */
function executeSwitch(node: AstNode, state: InterpreterState): Flow {
  const value = evaluateExpression(asNode(node.discriminant), state)
  const cases = asNodes(node.cases)
  let matched = false
  for (const switchCase of cases) {
    if (!matched) {
      matched = switchCase.test === null
        || evaluateExpression(asNode(switchCase.test), state) === value
    }
    if (!matched) continue
    const flow = executeStatements(asNodes(switchCase.consequent), state)
    if (flow.kind === "break") return NORMAL_FLOW
    if (flow.kind !== "normal") return flow
  }
  return NORMAL_FLOW
}

/**
 * 执行一个语句节点，是解释器的控制流总分派器。
 *
 * @param node Program、Block、if、switch、循环、return 等语句节点。
 * @param state 当前解释器状态。
 * @returns 描述正常结束或 break/continue/return 的 Flow。
 * @throws 不支持的 JavaScript 语句立即失败。
 *
 * while/for 每轮先 bumpLoop；return 逐层向上传递；continue 由循环消费。这样无需使用 JavaScript
 * eval/Function，也能明确控制 StoryScript 允许的语义。
 */
function executeStatement(node: AstNode, state: InterpreterState): Flow {
  bumpStep(state, node)
  switch (node.type) {
    case "Program":
    case "BlockStatement":
      return executeStatements(asNodes(node.body), state)
    case "EmptyStatement":
      return NORMAL_FLOW
    case "VariableDeclaration":
      executeVariableDeclaration(node, state)
      return NORMAL_FLOW
    case "ExpressionStatement":
      state.lastExpressionValue = evaluateExpression(asNode(node.expression), state)
      return NORMAL_FLOW
    case "IfStatement":
      return evaluateExpression(asNode(node.test), state)
        ? executeStatement(asNode(node.consequent), state)
        : node.alternate ? executeStatement(asNode(node.alternate), state) : NORMAL_FLOW
    case "SwitchStatement":
      return executeSwitch(node, state)
    case "WhileStatement":
      while (evaluateExpression(asNode(node.test), state)) {
        bumpLoop(state, node)
        const flow = executeStatement(asNode(node.body), state)
        if (flow.kind === "break") break
        if (flow.kind === "return") return flow
      }
      return NORMAL_FLOW
    case "ForStatement": {
      const init = asOptionalNode(node.init)
      if (init?.type === "VariableDeclaration") executeVariableDeclaration(init, state)
      else if (init) evaluateExpression(init, state)
      while (!node.test || evaluateExpression(asNode(node.test), state)) {
        bumpLoop(state, node)
        const flow = executeStatement(asNode(node.body), state)
        if (flow.kind === "break") break
        if (flow.kind === "return") return flow
        if (node.update) evaluateExpression(asNode(node.update), state)
      }
      return NORMAL_FLOW
    }
    case "BreakStatement":
      return { kind: "break" }
    case "ContinueStatement":
      return { kind: "continue" }
    case "ReturnStatement":
      return { kind: "return", value: node.argument ? evaluateExpression(asNode(node.argument), state) : undefined }
    default:
      return fail(node, `Unsupported StoryScript statement: ${node.type}`)
  }
}

/**
 * 完成一次 StoryScript 的“预处理 → 解析 → 建状态 → 解释执行”。
 *
 * @param valsFile 执行前的故事变量文件。
 * @param source 原始 StoryScript 源码。
 * @param maxDepth calc 变量的最大递归深度。
 * @param context 外部只读/可写值、领域函数和可注入随机源。
 * @returns 最终 InterpreterState 与顶层 Flow，供布尔、过程和 calc API 各自解释结果。
 * @throws 任何预处理、解析或执行错误；顶层 break/continue 也会被判为非法。
 *
 * 变量和 context 都先复制，脚本失败不会留下半写入状态。占位符在解析前替换成安全标识符，再通过
 * bindings 映射回来；源码从不交给 eval 或 Function。
 */
export function run(
  valsFile: StoryValsFile,
  source: string,
  maxDepth: number,
  context: StoryScriptExecutionContext = {}
) {
  const compiled = compileSource(source)
  const executionContext: StoryScriptExecutionContext = {
    values: { ...(context.values ?? {}) },
    assignableValues: { ...(context.assignableValues ?? {}) },
    functions: { ...(context.functions ?? {}) },
    random: context.random
  }
  const state: InterpreterState = {
    valsFile: cloneValsFile(valsFile),
    locals: {},
    invocations: [],
    context: executionContext,
    placeholders: new Map(compiled.bindings.map((binding) => [binding.identifier, binding.token])),
    safeMath: createSafeMath(executionContext.random ?? Math.random),
    stepCount: 0,
    loopIterations: 0,
    lastExpressionValue: undefined,
    maxDepth
  }
  const flow = executeStatement(parseProgram(compiled.compiled), state)
  if (flow.kind === "break" || flow.kind === "continue") {
    throw new StoryScriptError(1, `StoryScript ${flow.kind} is only valid inside loops.`)
  }
  return { state, flow }
}

/**
 * 计算一条变量 `calc_rule`，并检测递归深度和引用环。
 *
 * @param group 当前 calc 所属变量组；单段 `{name}` 会优先在本组查找。
 * @param calcRule 使用 `{组.变量}` 或 `{变量}` 引用数字的计算表达式。
 * @param options 完整变量文件、visited 路径、当前深度和最大深度。
 * @returns 替换引用后的安全表达式，以及最终有限数字结果。
 * @throws 引用不存在/非数字、形成循环、超过深度或表达式结果不是有限数字时抛错。
 *
 * 算法先把每个引用递归算成数字并绑定为 `__calc_N`，再让同一白名单解释器执行表达式。visited
 * 保存整条引用路径，因此 A → B → A 会在再次遇到 A 时立即报告，而不是等到栈溢出。
 */
export function evaluateStoryValCalcRule(
  group: StoryValDefinition,
  calcRule: string,
  options: {
    visited?: Set<string>
    depth?: number
    maxDepth?: number
    valsFile?: StoryValsFile
    currentGroupName?: string
  } = {}
): StoryValCalcEvaluation {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_CALC_NESTING_DEPTH
  const depth = options.depth ?? 1
  if (depth > maxDepth) throw new Error(`Calculation nesting exceeds the max depth of ${maxDepth}.`)
  const valsFile = options.valsFile ?? { variables: [group] }
  const visited = options.visited ?? new Set<string>()
  let index = 0
  const values: Record<string, unknown> = {}
  const expression = calcRule.replace(/\{([^{}]+)\}/g, (_match, tokenText: string) => {
    const token = tokenText.trim()
    const parts = token.split(".")
    const targetGroup = parts.length === 1 ? group : valsFile.variables.find((item) => normalizeGroupName(item.name) === parts[0])
    const rowName = parts.length === 1 ? parts[0] : parts[1]
    const row = targetGroup?.vals.find((item) => normalizeRowName(item.name) === rowName)
    if (!targetGroup || !row) throw new Error(`Referenced variable was not found: {${token}}`)
    const key = `${normalizeGroupName(targetGroup.name)}.${normalizeRowName(row.name)}`
    if (visited.has(key)) throw new Error(`Circular calc reference detected: ${[...visited, key].join(" -> ")}`)
    const value = isCalcRow(row)
      ? evaluateStoryValCalcRule(targetGroup, row.calc_rule, { valsFile, maxDepth, depth: depth + 1, visited: new Set([...visited, key]) }).result
      : toNumericValue(row.value)
    if (value === null) throw new Error(`Referenced variable is not numeric: {${token}}`)
    const identifier = `__calc_${index++}`
    values[identifier] = value
    return identifier
  })
  const { flow } = run({ variables: [] }, `return (${expression});`, maxDepth, { values })
  const value = flow.kind === "return" ? flow.value : undefined
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("The calculation result must be a finite number.")
  return { expression, result: value }
}
