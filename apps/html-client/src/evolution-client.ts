import { storyEvolutionManifestSchema, validateEvolutionPackage, type StoryEvolutionManifest, type StoryEvolutionPackage, type StoryTelemetryEvent } from "@story-mgr/evolution"
import { ensureDirectory, readJsonFile, writeJsonFile } from "./client-storage"
import { readdir, unlink } from "node:fs/promises"
import path from "node:path"

export interface EvolutionClientOptions {
  apiUrl?: string
  storyId: string
  playerId?: string
  shardId?: string
  pollIntervalMs?: number
  evolutionDir?: string
  onManifest?: (manifest: StoryEvolutionManifest) => void | Promise<void>
}

export class HtmlEvolutionClient {
  private readonly baseUrl: string
  private readonly telemetry: StoryTelemetryEvent[] = []
  private readonly worker: Worker | null
  private requestId = 0
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private initialized = false
  private persistence = Promise.resolve()

  /** 创建 manifest 轮询、包缓存、语义 Worker 和离线遥测客户端。 */
  constructor(private readonly options: EvolutionClientOptions) {
    this.baseUrl = (options.apiUrl ?? "http://localhost:4000/api").replace(/\/$/, "")
    this.worker = typeof Worker === "undefined" ? null : new Worker("/semantic-worker.js")
    if (options.pollIntervalMs && options.pollIntervalMs > 0 && typeof setInterval !== "undefined") {
      this.pollTimer = setInterval(() => { void this.fetchManifest().then((manifest) => options.onManifest?.(manifest)).catch(() => undefined) }, options.pollIntervalMs)
    }
  }

  /** 从本地 telemetry 目录恢复尚未成功上报的事件。 */
  async initialize(): Promise<void> {
    if (this.initialized || !this.options.evolutionDir) return
    this.initialized = true
    const directory = path.join(this.options.evolutionDir, "telemetry")
    await ensureDirectory(directory)
    const entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" })
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
      try {
        const event = await readJsonFile<StoryTelemetryEvent>(path.join(directory, entry.name))
        if (!this.telemetry.some((item) => item.eventId === event.eventId)) this.telemetry.push(event)
      } catch { /* 损坏队列项忽略，避免阻塞主流程 */ }
    }
  }

  /** 获取并校验远端 manifest，失败时回退到本地缓存。 */
  async fetchManifest(): Promise<StoryEvolutionManifest> {
    const params = new URLSearchParams()
    if (this.options.playerId) params.set("playerId", this.options.playerId)
    if (this.options.shardId) params.set("shardId", this.options.shardId)
    let manifest: StoryEvolutionManifest
    try {
      const response = await fetch(`${this.baseUrl}/stories/${encodeURIComponent(this.options.storyId)}/evolution/manifest?${params}`)
      if (!response.ok) throw new Error(`演化 manifest 获取失败：${response.status}`)
      manifest = await response.json() as StoryEvolutionManifest
    } catch (error) {
      if (!this.options.evolutionDir) throw error
      manifest = await readJsonFile<StoryEvolutionManifest>(path.join(this.options.evolutionDir, "manifest.json"))
    }
    const manifestValidation = storyEvolutionManifestSchema.safeParse(manifest)
    if (!manifestValidation.success) throw new Error("演化 manifest 格式无效。")
    if (this.options.evolutionDir) {
      await ensureDirectory(path.join(this.options.evolutionDir, "packages"))
      await writeJsonFile(path.join(this.options.evolutionDir, "manifest.json"), manifest)
    }
    return manifest
  }

  /** 获取、校验并缓存指定不可变内容包。 */
  async fetchPackage(packageId: string, baseContentHash?: string): Promise<StoryEvolutionPackage> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(packageId)) throw new Error("演化内容包 id 无效。")
    let pkg: StoryEvolutionPackage
    if (this.options.evolutionDir) {
      try {
        pkg = await readJsonFile<StoryEvolutionPackage>(path.join(this.options.evolutionDir, "packages", `${packageId}.json`))
        const cachedValidation = validateEvolutionPackage(pkg, baseContentHash)
        if (cachedValidation.ok) return pkg
      } catch { /* 本地没有缓存时继续请求 API。 */ }
    }
    try {
      const response = await fetch(`${this.baseUrl}/stories/${encodeURIComponent(this.options.storyId)}/evolution/packages/${encodeURIComponent(packageId)}`)
      if (!response.ok) throw new Error(`演化内容包获取失败：${response.status}`)
      pkg = await response.json() as StoryEvolutionPackage
    } catch (error) {
      if (!this.options.evolutionDir) throw error
      pkg = await readJsonFile<StoryEvolutionPackage>(path.join(this.options.evolutionDir, "packages", `${packageId}.json`))
    }
    const validation = validateEvolutionPackage(pkg, baseContentHash)
    if (!validation.ok) throw new Error(`演化内容包校验失败：${validation.errors.join("；")}`)
    if (pkg.story_id !== this.options.storyId) throw new Error("演化内容包 story_id 不匹配。")
    if (this.options.evolutionDir) await writeJsonFile(path.join(this.options.evolutionDir, "packages", `${packageId}.json`), pkg)
    return pkg
  }

  /** 停止轮询和 Worker，供 HTML 服务关闭或故事切换时释放浏览器资源。 */
  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    this.worker?.terminate()
  }

  /** 通过浏览器 Worker 计算本地 BGE 文本向量。 */
  async embed(text: string, modelId?: string): Promise<number[]> {
    if (!this.worker) throw new Error("当前环境不支持本地语义模型。")
    const id = ++this.requestId
    return await new Promise<number[]>((resolve, reject) => {
      /** 只处理当前 embedding 请求对应的 Worker 响应。 */
      const handler = (event: MessageEvent<{ id: number; vector?: number[]; error?: string }>) => {
        if (event.data.id !== id) return
        this.worker!.removeEventListener("message", handler)
        if (event.data.error) reject(new Error(event.data.error))
        else resolve(event.data.vector ?? [])
      }
      this.worker!.addEventListener("message", handler)
      this.worker!.postMessage({ id, text, modelId })
    })
  }

  /** 将结构化遥测加入内存队列和本地持久化队列。 */
  record(event: StoryTelemetryEvent) {
    if (this.telemetry.some((item) => item.eventId === event.eventId)) return
    this.telemetry.push(event)
    if (this.options.evolutionDir) {
      const safeId = event.eventId.replace(/[^a-zA-Z0-9._-]/g, "_")
      const directory = path.join(this.options.evolutionDir, "telemetry")
      this.persistence = this.persistence
        .then(async () => {
          await ensureDirectory(directory)
          await writeJsonFile(path.join(directory, `${safeId}.json`), event)
        })
        .catch(() => undefined)
    }
  }

  /** 批量提交遥测，失败时恢复队列供下次重试。 */
  async flushTelemetry(): Promise<{ accepted: number; received: number }> {
    await this.persistence
    if (this.telemetry.length === 0) return { accepted: 0, received: 0 }
    const batch = this.telemetry.splice(0, this.telemetry.length)
    try {
      const response = await fetch(`${this.baseUrl}/stories/${encodeURIComponent(this.options.storyId)}/evolution/telemetry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: batch }) })
      if (!response.ok) throw new Error(`遥测提交失败：${response.status}`)
      const result = await response.json() as { accepted: number; received: number }
      if (this.options.evolutionDir) {
        await Promise.all(batch.map((event) => unlink(path.join(this.options.evolutionDir!, "telemetry", `${event.eventId.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`)).catch(() => undefined)))
      }
      return result
    } catch (error) {
      this.telemetry.unshift(...batch)
      throw error
    }
  }
}
