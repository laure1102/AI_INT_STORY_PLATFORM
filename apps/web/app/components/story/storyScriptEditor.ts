import type { StoryValsFile } from "@story-mgr/core"

export interface StoryScriptAutocompleteItem {
  name: string
  description: string
}

export interface StoryScriptHighlightToken {
  text: string
  highlighted: boolean
}

const STORY_SCRIPT_HIGHLIGHT_PATTERN =
  /\b(let|if|else|switch|case|default|for|while|break|continue|return|invoke_once|true|false|null)\b|\bMath\b|\b(?:abs|acos|asin|atan2|atan|ceil|clamp|cos|exp|floor|log10|log2|log|max|min|pow|round|sign|sin|sqrt|tan|trunc)\b(?=\s*\()/g

export const STORY_SCRIPT_TEMPLATE_PLACEHOLDER =
  "例如：今天是第 ${system.now_day} 天，账上还有 ${player.money}。"

export function openStoryScriptReferencePage() {
  if (typeof document === "undefined") {
    return
  }

  const link = document.createElement("a")
  link.href = "/story-script"
  link.target = "_blank"
  link.rel = "noopener noreferrer"
  link.style.display = "none"

  document.body.append(link)
  link.click()
  link.remove()
}

export function normalizeStoryScriptAutocompleteText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function buildStoryScriptValAutocompleteItems(vals: StoryValsFile) {
  const seen = new Set<string>()

  return vals.variables.flatMap((group) => {
    const groupName = normalizeStoryScriptAutocompleteText(group.name)
    const groupDescription = normalizeStoryScriptAutocompleteText(group.description)

    if (!groupName) {
      return []
    }

    return group.vals.flatMap((row) => {
      const rowName = normalizeStoryScriptAutocompleteText(row.name)

      if (!rowName) {
        return []
      }

      const name = `${groupName}.${rowName}`

      if (seen.has(name)) {
        return []
      }

      seen.add(name)

      return [{
        name,
        description: [groupDescription, normalizeStoryScriptAutocompleteText(row.description)]
          .filter(Boolean)
          .join(" / ")
      }]
    })
  })
}

export function mergeStoryScriptAutocompleteItems(
  ...itemGroups: Array<StoryScriptAutocompleteItem[] | undefined>
) {
  const mergedItems: StoryScriptAutocompleteItem[] = []
  const itemMap = new Map<string, number>()

  for (const group of itemGroups) {
    for (const item of group ?? []) {
      const name = normalizeStoryScriptAutocompleteText(item.name)

      if (!name) {
        continue
      }

      const description = normalizeStoryScriptAutocompleteText(item.description)
      const existingIndex = itemMap.get(name)

      if (existingIndex === undefined) {
        itemMap.set(name, mergedItems.length)
        mergedItems.push({
          name,
          description
        })
        continue
      }

      if (!mergedItems[existingIndex]?.description && description) {
        mergedItems[existingIndex] = {
          ...mergedItems[existingIndex],
          description
        }
      }
    }
  }

  return mergedItems
}

export function filterStoryScriptAutocompleteItems(
  queryText: string,
  sourceItems: StoryScriptAutocompleteItem[]
) {
  const query = queryText.trim().toLowerCase()

  if (!query) {
    return sourceItems
  }

  return sourceItems.filter((item) => {
    return (
      item.name.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)
    )
  })
}

function escapeStoryScriptHighlightHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function pushStoryScriptPlainHighlightToken(
  tokens: StoryScriptHighlightToken[],
  text: string
) {
  if (!text) {
    return
  }

  tokens.push({
    text: escapeStoryScriptHighlightHtml(text),
    highlighted: false
  })
}

function pushStoryScriptCodeHighlightTokens(
  tokens: StoryScriptHighlightToken[],
  text: string
) {
  if (!text) {
    return
  }

  let lastIndex = 0

  for (const match of text.matchAll(STORY_SCRIPT_HIGHLIGHT_PATTERN)) {
    const matchIndex = match.index ?? 0
    const matchedText = match[0] ?? ""

    pushStoryScriptPlainHighlightToken(tokens, text.slice(lastIndex, matchIndex))

    tokens.push({
      text: escapeStoryScriptHighlightHtml(matchedText),
      highlighted: true
    })

    lastIndex = matchIndex + matchedText.length
  }

  pushStoryScriptPlainHighlightToken(tokens, text.slice(lastIndex))
}

export function buildStoryScriptHighlightTokens(value: string): StoryScriptHighlightToken[] {
  const tokens: StoryScriptHighlightToken[] = []
  let segmentStart = 0
  let index = 0
  let activeQuote: "'" | "\"" | "`" | null = null
  let escaping = false

  while (index < value.length) {
    const char = value[index] ?? ""
    const nextChar = value[index + 1] ?? ""

    if (activeQuote) {
      if (escaping) {
        escaping = false
        index += 1
        continue
      }

      if (char === "\\") {
        escaping = true
        index += 1
        continue
      }

      if (char === activeQuote) {
        activeQuote = null
      }

      index += 1
      continue
    }

    if (char === "'" || char === "\"" || char === "`") {
      activeQuote = char
      index += 1
      continue
    }

    if (char === "/" && nextChar === "/") {
      pushStoryScriptCodeHighlightTokens(tokens, value.slice(segmentStart, index))
      const commentStart = index
      index += 2

      while (index < value.length) {
        const commentChar = value[index] ?? ""
        index += 1
        if (commentChar === "\r" || commentChar === "\n") {
          break
        }
      }

      pushStoryScriptPlainHighlightToken(tokens, value.slice(commentStart, index))
      segmentStart = index
      continue
    }

    if (char === "/" && nextChar === "*") {
      pushStoryScriptCodeHighlightTokens(tokens, value.slice(segmentStart, index))
      const commentStart = index
      index += 2

      while (index < value.length) {
        const commentChar = value[index] ?? ""
        const commentNextChar = value[index + 1] ?? ""

        if (commentChar === "*" && commentNextChar === "/") {
          index += 2
          break
        }

        index += 1
      }

      pushStoryScriptPlainHighlightToken(tokens, value.slice(commentStart, index))
      segmentStart = index
      continue
    }

    index += 1
  }

  pushStoryScriptCodeHighlightTokens(tokens, value.slice(segmentStart))

  if (tokens.length === 0) {
    tokens.push({
      text: "",
      highlighted: false
    })
  }

  return tokens
}

export function resolveStoryScriptAutocompletePlacement(element: HTMLElement | null) {
  if (!element || typeof window === "undefined") {
    return "bottom" as const
  }

  const rect = element.getBoundingClientRect()
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
  const spaceBelow = viewportHeight - rect.bottom
  const spaceAbove = rect.top

  return spaceBelow < 260 && spaceAbove > spaceBelow ? "top" : "bottom"
}
