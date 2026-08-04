import { defineConfig } from "tsup"

export default defineConfig({
  clean: true,
  entry: ["src/server.ts"],
  external: ["@langchain/langgraph-checkpoint-sqlite", "better-sqlite3"],
  format: ["esm"],
  noExternal: [/^@story-mgr\//],
  outDir: "dist",
  platform: "node",
  target: "es2022"
})
