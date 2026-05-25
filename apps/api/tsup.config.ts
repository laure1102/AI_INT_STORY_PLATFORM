import { defineConfig } from "tsup"

export default defineConfig({
  clean: true,
  entry: ["src/server.ts"],
  format: ["esm"],
  noExternal: [/^@story-mgr\//],
  outDir: "dist",
  platform: "node",
  target: "es2022"
})
