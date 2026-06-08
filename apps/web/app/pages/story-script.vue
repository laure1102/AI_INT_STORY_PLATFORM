<script setup lang="ts">
import storyScriptMarkdown from "../../../../StoryScript.md?raw"

type StoryScriptDocBlock =
  | { id: string; level: number; text: string; type: "heading" }
  | { id: string; items: string[]; type: "list" }
  | { id: string; language: string; text: string; type: "code" }
  | { id: string; text: string; type: "paragraph" }
  | { id: string; type: "divider" }

function parseStoryScriptMarkdown(markdown: string) {
  const blocks: StoryScriptDocBlock[] = []
  const lines = markdown.split(/\r?\n/)
  let index = 0
  let blockId = 0

  function nextId() {
    blockId += 1
    return `story-script-block-${blockId}`
  }

  while (index < lines.length) {
    const line = lines[index] ?? ""
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      index += 1
      continue
    }

    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/)

    if (headingMatch) {
      blocks.push({
        id: nextId(),
        level: headingMatch[1].length,
        text: headingMatch[2],
        type: "heading"
      })
      index += 1
      continue
    }

    if (trimmedLine === "---") {
      blocks.push({
        id: nextId(),
        type: "divider"
      })
      index += 1
      continue
    }

    const codeFenceMatch = trimmedLine.match(/^```(\w+)?$/)

    if (codeFenceMatch) {
      const codeLines: string[] = []
      index += 1

      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "")
        index += 1
      }

      blocks.push({
        id: nextId(),
        language: codeFenceMatch[1] ?? "",
        text: codeLines.join("\n"),
        type: "code"
      })
      index += 1
      continue
    }

    if (trimmedLine.startsWith("- ")) {
      const items: string[] = []

      while (index < lines.length) {
        const itemMatch = (lines[index] ?? "").trim().match(/^-\s+(.+)$/)

        if (!itemMatch) {
          break
        }

        items.push(itemMatch[1])
        index += 1
      }

      blocks.push({
        id: nextId(),
        items,
        type: "list"
      })
      continue
    }

    const paragraphLines = [trimmedLine]
    index += 1

    while (index < lines.length) {
      const nextLine = (lines[index] ?? "").trim()

      if (
        !nextLine ||
        nextLine.startsWith("#") ||
        nextLine.startsWith("- ") ||
        nextLine.startsWith("```") ||
        nextLine === "---"
      ) {
        break
      }

      paragraphLines.push(nextLine)
      index += 1
    }

    blocks.push({
      id: nextId(),
      text: paragraphLines.join(" "),
      type: "paragraph"
    })
  }

  return blocks
}

const docBlocks = computed(() => parseStoryScriptMarkdown(storyScriptMarkdown))

useHead({
  title: "StoryScript 规范"
})
</script>

<template>
  <main class="story-script-page page-shell fade-up">
    <article class="story-script-doc glass-panel">
      <div class="story-script-doc__header">
        <span class="eyebrow">StoryScript</span>
        <h1 class="story-script-doc__title">StoryScript 规范</h1>
      </div>

      <template v-for="block in docBlocks" :key="block.id">
        <h1
          v-if="block.type === 'heading' && block.level === 1"
          class="story-script-doc__heading story-script-doc__heading--h1"
        >
          {{ block.text }}
        </h1>
        <h2
          v-else-if="block.type === 'heading' && block.level === 2"
          class="story-script-doc__heading story-script-doc__heading--h2"
        >
          {{ block.text }}
        </h2>
        <h3
          v-else-if="block.type === 'heading'"
          class="story-script-doc__heading story-script-doc__heading--h3"
        >
          {{ block.text }}
        </h3>

        <ul v-else-if="block.type === 'list'" class="story-script-doc__list">
          <li v-for="item in block.items" :key="item">{{ item }}</li>
        </ul>

        <pre v-else-if="block.type === 'code'" class="story-script-doc__code"><code>{{ block.text }}</code></pre>

        <hr v-else-if="block.type === 'divider'" class="story-script-doc__divider">

        <p v-else class="story-script-doc__paragraph">{{ block.text }}</p>
      </template>
    </article>
  </main>
</template>

<style scoped>
.story-script-page {
  max-width: 960px;
}

.story-script-doc {
  padding: 28px;
}

.story-script-doc__header {
  display: grid;
  gap: 10px;
  margin-bottom: 24px;
}

.story-script-doc__title,
.story-script-doc__heading {
  margin: 0;
  color: var(--text);
}

.story-script-doc__title {
  font-family: "Space Grotesk", "Noto Sans SC", sans-serif;
  font-size: 2rem;
}

.story-script-doc__heading {
  scroll-margin-top: 24px;
}

.story-script-doc__heading--h1 {
  display: none;
}

.story-script-doc__heading--h2 {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
  font-size: 1.25rem;
}

.story-script-doc__heading--h3 {
  margin-top: 20px;
  color: var(--accent);
  font-size: 1rem;
}

.story-script-doc__paragraph,
.story-script-doc__list {
  color: var(--text-muted);
  font-size: 0.95rem;
  line-height: 1.75;
}

.story-script-doc__paragraph {
  margin: 10px 0 0;
}

.story-script-doc__list {
  display: grid;
  gap: 6px;
  margin: 10px 0 0;
  padding-left: 22px;
}

.story-script-doc__code {
  margin: 12px 0 0;
  padding: 14px 16px;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.24);
  color: #dff7ff;
  font-family: "Space Grotesk", "Noto Sans SC", monospace;
  font-size: 0.9rem;
  line-height: 1.6;
  white-space: pre;
}

.story-script-doc__divider {
  margin: 26px 0;
  border: 0;
  border-top: 1px solid var(--line);
}

@media (max-width: 700px) {
  .story-script-doc {
    padding: 20px;
  }

  .story-script-doc__title {
    font-size: 1.6rem;
  }
}
</style>
