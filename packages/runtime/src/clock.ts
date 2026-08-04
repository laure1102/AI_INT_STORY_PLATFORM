export const DEFAULT_CLOCK_STEP_MINUTES = 10
export const MINUTES_PER_DAY = 24 * 60

export interface RuntimeClockState {
  base_date: string
  base_day: number
  total_minutes: number
  pending_minutes: number
  step_minutes: number
}

export interface RuntimeDateParts {
  year: number
  month: number
  day: number
}

/**
 * 解析故事配置中的 `年-月-日` 文本，并严格检查该日期真实存在。
 * @param value 例如 `2026-8-3` 的日期文本。 @returns 合法时返回年月日，格式或日期无效时返回 null。
 */
export function parseStoryDate(value: string): RuntimeDateParts | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim())
  if (!match) return null

  const year = Number.parseInt(match[1]!, 10)
  const month = Number.parseInt(match[2]!, 10)
  const day = Number.parseInt(match[3]!, 10)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    return null
  }

  return { year, month, day }
}

/** @param parts 年、月、日。 @returns 不补零的 `年-月-日` 故事日期文本。 */
export function formatStoryDate(parts: RuntimeDateParts) {
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** @param parts 故事日期。 @returns 从 Unix 纪元开始计算的 UTC 整天编号，避免本地时区干扰日期运算。 */
export function datePartsToUtcDayNumber(parts: RuntimeDateParts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000)
}

/** @param utcDayNumber UTC 整天编号。 @returns 对应的年、月、日。 */
export function utcDayNumberToDateParts(utcDayNumber: number): RuntimeDateParts {
  const date = new Date(utcDayNumber * 86400000)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  }
}

/**
 * 把小时内的分钟向下对齐到游戏时钟步长。
 * @param minute 原始分钟。 @param stepMinutes 步长，例如 10。 @returns 限制在 0–59 且向下对齐后的分钟。
 */
export function snapMinuteToStep(minute: number, stepMinutes: number) {
  if (!Number.isFinite(minute)) return 0
  const normalizedMinute = Math.max(0, Math.min(59, Math.trunc(minute)))
  return stepMinutes <= 1
    ? normalizedMinute
    : Math.floor(normalizedMinute / stepMinutes) * stepMinutes
}
