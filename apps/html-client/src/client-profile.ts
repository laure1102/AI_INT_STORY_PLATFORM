/**
 * HTML 客户端的玩家档案与建角字段适配器。
 *
 * 它把故事变量、旧档案 custom_values 和新的 player_setup 相互转换，输出交给应用门面持久化。
 * 本模块不读写磁盘，也不创建 Runtime Session。
 */
import type {
  RuntimePlayerProfileSetup,
  RuntimeProfileCustomFile,
  RuntimeStoryBundle
} from "@story-mgr/runtime"
import type {
  StoryPlayerOverrideInputOption,
  StoryPlayerOverrideInputType,
  StoryPlayerOverrideValEntry
} from "@story-mgr/core"
import type { HtmlPlayerOverridePrompt } from "./client-contracts"
import { buildPlayerDisplayName } from "./client-paths"

const PLAYER_NAME_TOKENS = [
  "player.name",
  "system.player_name",
  "system.role_name",
  "system.player_display_name"
] as const
const PLAYER_SURNAME_TOKENS = ["player.name_xing", "system.player_surname"] as const
const PLAYER_GIVEN_NAME_TOKENS = ["player.name_ming", "system.player_given_name"] as const
const COUNTY_NAME_TOKENS = ["county.name_full", "system.county_name", "system.county_full_name"] as const
const COUNTY_SHORT_NAME_TOKENS = ["county.name_short", "system.county_short_name"] as const
const CITY_NAME_TOKENS = ["county.parent_city", "system.city_name", "system.parent_city"] as const
const PROVINCE_NAME_TOKENS = ["county.province", "system.province_name"] as const

/** @param countyName 完整县名。 @returns 去空白后第一个 Unicode 字符；空名称返回空串。 */
function deriveCountyShortName(countyName: string): string {
  const trimmedCountyName = countyName.trim()
  return Array.from(trimmedCountyName)[0] ?? ""
}

/** @param playerSetup 玩家结构化资料。 @returns 不共享引用且所有可选姓名字段已补为空串的新对象。 */
export function clonePlayerSetup(playerSetup: RuntimePlayerProfileSetup): RuntimePlayerProfileSetup {
  return {
    player_surname: playerSetup.player_surname ?? "",
    player_given_name: playerSetup.player_given_name ?? "",
    player_name: playerSetup.player_name ?? "",
    county_name: playerSetup.county_name,
    county_short_name: playerSetup.county_short_name,
    city_name: playerSetup.city_name,
    province_name: playerSetup.province_name
  }
}

/** @param source 自定义值字典。 @param keys 按优先级排列的兼容变量键。 @returns 第一个非空字符串值，否则空串。 */
function getRecordStringValue(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

/** @param source 自定义值字典。 @param key 精确变量键。 @returns 去空白字符串；非字符串返回空串。 */
function getCustomStringValue(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === "string" ? value.trim() : ""
}

/** @param bundle 编译故事。 @param token 完整变量键。 @returns 对应玩家覆盖定义，不存在时为 null。 */
function findPlayerOverrideEntry(bundle: RuntimeStoryBundle, token: string): StoryPlayerOverrideValEntry | null {
  return bundle.playerOverrideVals.entries.find(
    (entry: StoryPlayerOverrideValEntry) => entry.var_key.trim() === token.trim()
  ) ?? null
}

/** @param bundle 编译故事。 @param token `组.变量` 键。 @returns 带变量描述的表单标签，找不到描述时返回 token。 */
function findBundleVarLabel(bundle: RuntimeStoryBundle, token: string): string {
  const [groupName, rowName] = token.split(".")
  if (!groupName || !rowName) return token
  const matchedGroup = bundle.vals.variables.find((group) => group.name.trim() === groupName.trim())
  const matchedRow = matchedGroup?.vals.find((row) => row.name.trim() === rowName.trim())
  const rowDescription = matchedRow?.description?.trim() ?? ""
  return rowDescription ? `${token} - ${rowDescription}` : token
}

/** @param playerSetup 玩家结构化资料或 null。 @returns `省/市/县` 显示文本；没有任何地点字段时为 null。 */
export function buildLocationLabel(playerSetup: RuntimePlayerProfileSetup | null): string | null {
  if (!playerSetup) return null
  const locationParts = [
    playerSetup.province_name.trim(),
    playerSetup.city_name.trim(),
    playerSetup.county_name.trim()
  ].filter(Boolean)
  return locationParts.length > 0 ? locationParts.join("/") : null
}

/**
 * 将新旧两种档案格式统一成结构化玩家资料。
 * @param profile 档案文件。 @returns 规范 player_setup；完全没有结构化信息时返回 null。
 * 新字段优先；旧档案则按兼容变量键提取姓名和行政区，保证已有本地档案仍可打开。
 */
export function normalizePlayerSetup(profile: RuntimeProfileCustomFile): RuntimePlayerProfileSetup | null {
  if (profile.player_setup) {
    const normalizedPlayerSetup = clonePlayerSetup(profile.player_setup)
    return { ...normalizedPlayerSetup, player_name: buildPlayerDisplayName(normalizedPlayerSetup) }
  }
  const explicitPlayerName = getRecordStringValue(profile.custom_values, PLAYER_NAME_TOKENS)
  const explicitPlayerSurname = getRecordStringValue(profile.custom_values, PLAYER_SURNAME_TOKENS)
  const explicitPlayerGivenName = getRecordStringValue(profile.custom_values, PLAYER_GIVEN_NAME_TOKENS)
  const countyName = getRecordStringValue(profile.custom_values, COUNTY_NAME_TOKENS)
  const countyShortName = getRecordStringValue(profile.custom_values, COUNTY_SHORT_NAME_TOKENS) || deriveCountyShortName(countyName)
  const cityName = getRecordStringValue(profile.custom_values, CITY_NAME_TOKENS)
  const provinceName = getRecordStringValue(profile.custom_values, PROVINCE_NAME_TOKENS)
  if (!(explicitPlayerName || countyName || countyShortName || cityName || provinceName)) return null
  return {
    player_surname: explicitPlayerSurname,
    player_given_name: explicitPlayerGivenName,
    player_name: `${explicitPlayerSurname}${explicitPlayerGivenName}` || explicitPlayerName || profile.profile_name,
    county_name: countyName,
    county_short_name: countyShortName,
    city_name: cityName,
    province_name: provinceName
  }
}

/** @param customValues 建角或旧档案的变量字典。 @returns 可识别时构造玩家资料，否则 null。 */
export function buildPlayerSetupFromCustomValues(customValues: Record<string, unknown>): RuntimePlayerProfileSetup | null {
  const explicitPlayerName = getRecordStringValue(customValues, PLAYER_NAME_TOKENS)
  const explicitPlayerSurname = getRecordStringValue(customValues, PLAYER_SURNAME_TOKENS)
  const explicitPlayerGivenName = getRecordStringValue(customValues, PLAYER_GIVEN_NAME_TOKENS)
  const countyName = getRecordStringValue(customValues, COUNTY_NAME_TOKENS)
  const countyShortName = getRecordStringValue(customValues, COUNTY_SHORT_NAME_TOKENS) || deriveCountyShortName(countyName)
  const cityName = getRecordStringValue(customValues, CITY_NAME_TOKENS)
  const provinceName = getRecordStringValue(customValues, PROVINCE_NAME_TOKENS)
  if (!(explicitPlayerName || countyName || countyShortName || cityName || provinceName)) return null
  return {
    player_surname: explicitPlayerSurname,
    player_given_name: explicitPlayerGivenName,
    player_name: `${explicitPlayerSurname}${explicitPlayerGivenName}` || explicitPlayerName,
    county_name: countyName,
    county_short_name: countyShortName,
    city_name: cityName,
    province_name: provinceName
  }
}

/** @param bundle 编译故事。 @returns 普通变量和系统变量中所有 `组.变量` 键的集合。 */
function collectBundleVariableTokens(bundle: RuntimeStoryBundle): Set<string> {
  const tokens = new Set<string>()
  for (const valsFile of [bundle.vals, bundle.systemVals]) {
    for (const group of valsFile.variables) {
      const groupName = group.name.trim()
      for (const row of group.vals) {
        const rowName = row.name.trim()
        if (groupName && rowName) tokens.add(`${groupName}.${rowName}`)
      }
    }
  }
  return tokens
}

/** @param bundle 编译故事。 @param customValues 自定义变量。 @returns 优先从结构化姓名、再从覆盖字段推导的档案名。 */
export function buildProfileNameFromCustomValues(bundle: RuntimeStoryBundle, customValues: Record<string, unknown>): string {
  const playerSetup = buildPlayerSetupFromCustomValues(customValues)
  if (playerSetup) {
    const displayName = buildPlayerDisplayName(playerSetup)
    if (displayName) return displayName
  }
  for (const entry of bundle.playerOverrideVals.entries) {
    const value = getCustomStringValue(customValues, entry.var_key)
    if (value) return value
  }
  return ""
}

/** @param value 表单类型输入。 @returns 仅 select 保留，其余统一为 text。 */
function normalizePlayerOverrideInputType(value: unknown): StoryPlayerOverrideInputType {
  return value === "select" ? "select" : "text"
}

/** @param value 下拉选项输入。 @returns 去除无效项、补齐 label 的选项数组。 */
function normalizePlayerOverrideInputOptions(value: unknown): StoryPlayerOverrideInputOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((option) => {
    if (!option || typeof option !== "object") return []
    const record = option as Record<string, unknown>
    const optionValue = typeof record.value === "string" ? record.value.trim() : ""
    const optionLabel = typeof record.label === "string" ? record.label.trim() : ""
    return optionValue ? [{ label: optionLabel || optionValue, value: optionValue }] : []
  })
}

/**
 * 将玩家可覆盖变量转换成浏览器建角表单提示。
 * @param bundle 编译故事。 @returns 按原配置顺序的字段、提示、分组、类型和选项。
 */
export function buildHtmlPlayerOverridePrompts(bundle: RuntimeStoryBundle): HtmlPlayerOverridePrompt[] {
  return bundle.playerOverrideVals.entries
    .filter((entry: StoryPlayerOverrideValEntry) => entry.need_player_override)
    .map((entry: StoryPlayerOverrideValEntry) => {
      const normalizedVarKey = entry.var_key.trim()
      const matchedEntry = findPlayerOverrideEntry(bundle, normalizedVarKey)
      const inputType = normalizePlayerOverrideInputType(matchedEntry?.input_type ?? entry.input_type)
      return {
        varKey: normalizedVarKey,
        label: findBundleVarLabel(bundle, normalizedVarKey),
        tips: (matchedEntry?.tips ?? entry.tips).trim(),
        required: normalizedVarKey !== "county.name_short",
        groupNo: Number.isInteger(entry.group_no) && entry.group_no >= 1 ? entry.group_no : 1,
        inputType,
        options: inputType === "select"
          ? normalizePlayerOverrideInputOptions(matchedEntry?.input_options ?? entry.input_options)
          : []
      }
    })
}

/** @param customValues 输出字典。 @param tokens 故事真实变量键。 @param candidates 兼容候选键。 @param value 待写文本。 @returns 无返回值；只写存在于 bundle 的键。 */
function applyCustomTokenValues(customValues: Record<string, unknown>, tokens: Set<string>, candidates: readonly string[], value: string): void {
  const trimmedValue = value.trim()
  if (!trimmedValue) return
  for (const candidate of candidates) {
    if (tokens.has(candidate)) customValues[candidate] = trimmedValue
  }
}

/**
 * 把结构化建角资料映射成 Runtime 能覆盖的 `组.变量` 字典。
 * @param bundle 编译故事。 @param playerSetup 玩家资料。 @returns 只包含故事真实存在变量的 custom_values。
 */
export function buildPlayerCustomValues(bundle: RuntimeStoryBundle, playerSetup: RuntimePlayerProfileSetup): Record<string, unknown> {
  const customValues: Record<string, unknown> = {}
  const tokens = collectBundleVariableTokens(bundle)
  const playerDisplayName = buildPlayerDisplayName(playerSetup)
  applyCustomTokenValues(customValues, tokens, PLAYER_NAME_TOKENS, playerDisplayName)
  applyCustomTokenValues(customValues, tokens, PLAYER_SURNAME_TOKENS, playerSetup.player_surname)
  applyCustomTokenValues(customValues, tokens, PLAYER_GIVEN_NAME_TOKENS, playerSetup.player_given_name)
  applyCustomTokenValues(customValues, tokens, COUNTY_NAME_TOKENS, playerSetup.county_name)
  applyCustomTokenValues(customValues, tokens, COUNTY_SHORT_NAME_TOKENS, playerSetup.county_short_name)
  applyCustomTokenValues(customValues, tokens, CITY_NAME_TOKENS, playerSetup.city_name)
  applyCustomTokenValues(customValues, tokens, PROVINCE_NAME_TOKENS, playerSetup.province_name)
  return customValues
}
