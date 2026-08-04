/**
 * StoryScript 允许访问的安全全局函数。
 *
 * 普通 JavaScript 可以访问 window、process、网络和动态代码执行；StoryScript 不允许这些能力。
 * 本模块只暴露经过白名单审核的数学、数字与字符串操作，并把实例方法绑定到当前基础值。
 */

/**
 * 创建只读的安全 Math 对象。
 *
 * @param random 由运行时注入的随机函数；存档可用它保证随机序列可复现。
 * @returns 冻结后的 Math 白名单，不包含危险或不可控的额外属性。
 */
export function createSafeMath(random: () => number) {
  return Object.freeze({
    E: Math.E,
    PI: Math.PI,
    abs: Math.abs,
    acos: Math.acos,
    asin: Math.asin,
    atan: Math.atan,
    atan2: Math.atan2,
    ceil: Math.ceil,
    clamp: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max),
    cos: Math.cos,
    exp: Math.exp,
    floor: Math.floor,
    log: Math.log,
    log10: Math.log10,
    log2: Math.log2,
    max: Math.max,
    min: Math.min,
    pow: Math.pow,
    random,
    round: Math.round,
    sign: Math.sign,
    sin: Math.sin,
    sqrt: Math.sqrt,
    tan: Math.tan,
    trunc: Math.trunc
  })
}

/**
 * 校验需要数字的内置函数参数。
 *
 * @param value 调用方传入的原始值。
 * @param functionName 出错时显示的函数名。
 * @returns Number 转换后的有限数字。
 * @throws 转换结果为 NaN 或正负 Infinity 时抛错。
 */
function toFiniteNumber(value: unknown, functionName: string) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new Error(`${functionName} expects a finite number.`)
  }
  return number
}

/** StoryScript 可以直接按名字调用的全局函数白名单。 */
export const globalFunctions: Record<string, (...args: unknown[]) => unknown> = {
  Number: (value) => Number(value),
  String: (value) => String(value),
  Boolean: (value) => Boolean(value),
  parseInt: (value, radix = 10) => Number.parseInt(String(value), Number(radix)),
  parseFloat: (value) => Number.parseFloat(String(value)),
  isNaN: (value) => Number.isNaN(Number(value)),
  isFinite: (value) => Number.isFinite(Number(value)),
  trim: (value) => String(value).trim(),
  includes: (value, search) => String(value).includes(String(search)),
  startsWith: (value, search) => String(value).startsWith(String(search)),
  endsWith: (value, search) => String(value).endsWith(String(search)),
  slice: (value, start, end) => String(value).slice(Number(start), end === undefined ? undefined : Number(end)),
  toLowerCase: (value) => String(value).toLowerCase(),
  toUpperCase: (value) => String(value).toUpperCase(),
  toFixed: (value, digits = 0) => toFiniteNumber(value, "toFixed").toFixed(Number(digits)),
  formatWan: (value, digits = 1) => {
    const number = toFiniteNumber(value, "formatWan")
    const normalizedDigits = Math.max(0, Math.min(100, Math.trunc(Number(digits))))
    return Math.abs(number) < 10000
      ? String(number)
      : `${(number / 10000).toFixed(normalizedDigits).replace(/\.0+$/, "")}万`
  }
}

/**
 * 为数字或字符串创建允许调用的实例方法。
 *
 * @param target 点号左侧已经求值的基础值，例如 `name.trim()` 中的 name。
 * @param property 点号右侧的方法名。
 * @returns 已绑定 target 的函数；类型或方法不在白名单时返回 undefined。
 */
export function createBoundMethod(target: unknown, property: string) {
  if (typeof target === "number" && property === "toFixed") {
    return (digits: unknown = 0) => target.toFixed(Number(digits))
  }
  if (typeof target !== "string") {
    return undefined
  }
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    trim: () => target.trim(),
    includes: (search) => target.includes(String(search)),
    startsWith: (search) => target.startsWith(String(search)),
    endsWith: (search) => target.endsWith(String(search)),
    slice: (start, end) => target.slice(Number(start), end === undefined ? undefined : Number(end)),
    toLowerCase: () => target.toLowerCase(),
    toUpperCase: () => target.toUpperCase()
  }
  return methods[property]
}
