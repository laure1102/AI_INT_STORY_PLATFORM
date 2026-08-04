import path from "node:path"
import { compileStory } from "../packages/compiler/src/index.ts"
import { createStoryFileStore } from "../packages/file-store/src/index.ts"

async function main() {
  const dataDir = path.resolve(process.cwd(), "data")
  const store = createStoryFileStore(dataDir)
  const summaries = await store.listStorySummaries()
  let errorCount = 0

  for (const summary of summaries) {
    try {
      const document = await store.readStoryDocument(summary.id)
      const { result } = compileStory(document)
      const errors = result.issues.filter((issue) => issue.level === "error")

      if (errors.length === 0) {
        console.info(`[validate:data] ${summary.id}: ok`)
        continue
      }

      errorCount += errors.length
      console.error(`[validate:data] ${summary.id}: ${errors.length} error(s)`)
      for (const issue of errors) {
        console.error(`  ${issue.code} ${issue.path.join(".")}: ${issue.message}`)
      }
    } catch (error) {
      errorCount += 1
      console.error(`[validate:data] ${summary.id}: failed to read or compile`, error)
    }
  }

  if (errorCount > 0) {
    console.error(`[validate:data] failed with ${errorCount} error(s).`)
    process.exitCode = 1
  } else {
    console.info(`[validate:data] ${summaries.length} story/stories passed.`)
  }
}

void main()
