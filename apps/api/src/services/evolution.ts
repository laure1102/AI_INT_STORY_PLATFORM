import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import Database from "better-sqlite3"
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite"
import { compileEffectiveStory, compileStory } from "@story-mgr/compiler"
import { validateEvolutionPackageDependencies } from "@story-mgr/core"
import type { StoryFileStore } from "@story-mgr/file-store"
import {
  evolutionPackageSchema,
  hashEvolutionPackage,
  orderEvolutionPackages,
  validateEvolutionPackage,
  type StoryEvolutionManifest,
  type StoryEvolutionPackage,
  type StoryEvolutionScope,
  type StoryTelemetryEvent,
} from "@story-mgr/evolution"
import { runEvolutionWorkflow, type EvolutionWorkflowInput } from "./evolution-workflow"
import { XenovaEvolutionEmbeddingProvider, type EvolutionEmbeddingProvider } from "./evolution-embedding"

export type EvolutionJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export interface EvolutionJobContext {
  playerId?: string
  shardId?: string
}

export interface EvolutionServiceOptions {
  model?: { apiKey?: string; baseUrl?: string; model?: string }
  embeddingModel?: string
  embeddingProvider?: EvolutionEmbeddingProvider
  workflowRunner?: (input: EvolutionWorkflowInput) => Promise<StoryEvolutionPackage>
}

const TELEMETRY_PAYLOAD_KEYS: Record<StoryTelemetryEvent["type"], readonly string[]> = {
  "event.completed": ["eventId", "durationMs"],
  "choice.selected": ["eventId", "choiceId"],
  "doing.used": ["doingId"],
  "contact.intent_matched": ["roleKey", "intentId", "score"],
  "contact.intent_fallback": ["roleKey"],
  "milestone.reached": ["milestoneId"],
  "package.installed": ["packageId", "queued"],
  "package.rejected": ["packageId", "reason"]
}

/** 按事件类型校验遥测 payload 白名单和值类型。 */
function isTelemetryPayloadAllowed(event: StoryTelemetryEvent): boolean {
  const allowed = new Set(TELEMETRY_PAYLOAD_KEYS[event.type])
  if (!Object.keys(event.payload).every((key) => allowed.has(key)) || Object.keys(event.payload).length > 16) return false
  /** 判断指定 payload 字段是否为非空字符串。 */
  const text = (key: string) => typeof event.payload[key] === "string" && String(event.payload[key]).length > 0
  switch (event.type) {
    case "event.completed": return text("eventId") && (event.payload.durationMs === undefined || typeof event.payload.durationMs === "number")
    case "choice.selected": return text("eventId") && text("choiceId")
    case "doing.used": return text("doingId")
    case "contact.intent_matched": return text("roleKey") && text("intentId") && typeof event.payload.score === "number" && event.payload.score >= -1 && event.payload.score <= 1
    case "contact.intent_fallback": return text("roleKey")
    case "milestone.reached": return text("milestoneId")
    case "package.installed": return text("packageId") && (event.payload.queued === undefined || typeof event.payload.queued === "boolean")
    case "package.rejected": return text("packageId") && text("reason")
  }
}

export interface EvolutionJob {
  id: string
  storyId: string
  status: EvolutionJobStatus
  instruction: string
  scope: StoryEvolutionScope
  context: EvolutionJobContext
  packageId?: string
  error?: string
  createdAt: string
  updatedAt: string
}

interface JobRow { id: string; story_id: string; status: EvolutionJobStatus; instruction: string; scope_json: string; context_json: string; package_id: string | null; error: string | null; created_at: string; updated_at: string }

/** 把 SQLite 行转换成公开 Evolution job。 */
function rowToJob(row: JobRow): EvolutionJob {
  return { id: row.id, storyId: row.story_id, status: row.status, instruction: row.instruction, scope: JSON.parse(row.scope_json) as StoryEvolutionScope, context: JSON.parse(row.context_json || "{}") as EvolutionJobContext, ...(row.package_id ? { packageId: row.package_id } : {}), ...(row.error ? { error: row.error } : {}), createdAt: row.created_at, updatedAt: row.updated_at }
}

/** 本地 Evolution 服务：持久化行为、版本包和任务，并提供可替换的分布式存储边界。 */
export class EvolutionService {
  private readonly db: Database.Database
  private readonly packageRoot: string
  private readonly checkpointer: SqliteSaver
  private readonly controllers = new Map<string, AbortController>()
  private readonly runningJobs = new Set<Promise<void>>()
  private readonly embeddingProvider: EvolutionEmbeddingProvider
  private readonly ownsEmbeddingProvider: boolean
  private readonly workflowRunner: (input: EvolutionWorkflowInput) => Promise<StoryEvolutionPackage>
  private shuttingDown = false

  /** 初始化任务、checkpoint、遥测、聚合和不可变包存储。 */
  constructor(private readonly store: StoryFileStore, stateDir: string, private readonly options: EvolutionServiceOptions = {}) {
    this.packageRoot = join(stateDir, "evolution", "stories")
    this.db = new Database(join(stateDir, "evolution.sqlite"))
    this.checkpointer = SqliteSaver.fromConnString(join(stateDir, "evolution-checkpoints.sqlite"))
    this.workflowRunner = options.workflowRunner ?? runEvolutionWorkflow
    this.ownsEmbeddingProvider = !options.embeddingProvider
    this.embeddingProvider = options.embeddingProvider ?? new XenovaEvolutionEmbeddingProvider(join(stateDir, "evolution", "models"), options.embeddingModel)
    this.db.pragma("journal_mode = WAL")
    this.db.pragma("foreign_keys = ON")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evolution_jobs (id TEXT PRIMARY KEY, story_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')), instruction TEXT NOT NULL, scope_json TEXT NOT NULL, context_json TEXT NOT NULL DEFAULT '{}', package_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evolution_packages (package_id TEXT PRIMARY KEY, story_id TEXT NOT NULL, scope_json TEXT NOT NULL, sequence INTEGER NOT NULL, package_json TEXT NOT NULL, published_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evolution_package_heads (story_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, package_id TEXT, PRIMARY KEY(story_id, scope_type, scope_id));
      CREATE TABLE IF NOT EXISTS evolution_package_quarantine (package_id TEXT PRIMARY KEY, story_id TEXT NOT NULL, package_json TEXT NOT NULL, reason TEXT NOT NULL, quarantined_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evolution_telemetry_events (event_id TEXT PRIMARY KEY, story_id TEXT NOT NULL, player_id TEXT NOT NULL, shard_id TEXT NOT NULL, session_id TEXT NOT NULL DEFAULT '', sequence INTEGER NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evolution_telemetry_sequences (story_id TEXT NOT NULL, player_id TEXT NOT NULL, session_id TEXT NOT NULL, last_sequence INTEGER NOT NULL, PRIMARY KEY(story_id, player_id, session_id));
      CREATE TABLE IF NOT EXISTS evolution_world_states (story_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, state_json TEXT NOT NULL DEFAULT '{}', PRIMARY KEY(story_id, scope_type, scope_id));
      CREATE TABLE IF NOT EXISTS evolution_aggregates (story_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, window_key TEXT NOT NULL, metrics_json TEXT NOT NULL, PRIMARY KEY(story_id, scope_type, scope_id, window_key));
      CREATE TABLE IF NOT EXISTS evolution_job_locks (story_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, sequence INTEGER NOT NULL, job_id TEXT NOT NULL, PRIMARY KEY(story_id, scope_type, scope_id, sequence));
      CREATE INDEX IF NOT EXISTS evolution_packages_story ON evolution_packages(story_id, published_at);
      CREATE INDEX IF NOT EXISTS evolution_telemetry_story_time ON evolution_telemetry_events(story_id, occurred_at);
      CREATE INDEX IF NOT EXISTS evolution_aggregates_window ON evolution_aggregates(story_id, window_key, scope_type, scope_id);
    `)
    try { this.db.exec("ALTER TABLE evolution_job_locks ADD COLUMN job_id TEXT NOT NULL DEFAULT ''") } catch { /* 已存在时忽略 */ }
    try { this.db.exec("ALTER TABLE evolution_telemetry_events ADD COLUMN session_id TEXT NOT NULL DEFAULT ''") } catch { /* 已存在时忽略 */ }
    try { this.db.exec("ALTER TABLE evolution_jobs ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}'") } catch { /* 已存在时忽略 */ }
    try { this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS evolution_package_scope_sequence ON evolution_packages(story_id, json_extract(scope_json,'$.type'), json_extract(scope_json,'$.id'), sequence)") } catch { /* 旧数据冲突时由发布前查询拒绝重复 sequence。 */ }
    // 进程重启后释放遗留锁；这些任务会在后台重新排队执行。
    this.db.prepare("DELETE FROM evolution_job_locks WHERE job_id IN (SELECT id FROM evolution_jobs WHERE status IN ('completed','failed','cancelled'))").run()
    this.db.prepare("UPDATE evolution_jobs SET status='queued',updated_at=? WHERE status='running'").run(new Date().toISOString())
    this.db.prepare("DELETE FROM evolution_job_locks WHERE rowid NOT IN (SELECT MIN(rowid) FROM evolution_job_locks GROUP BY story_id,scope_type,scope_id)").run()
    try { this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS evolution_job_scope_lock ON evolution_job_locks(story_id, scope_type, scope_id)") } catch { /* 旧数据库若有冲突，运行时 scope 查询仍可保护任务。 */ }
    void this.resumePendingJobs()
  }

  /** 取消后台任务并关闭模型与 SQLite 资源。 */
  async close(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    for (const controller of this.controllers.values()) controller.abort()
    await Promise.allSettled([...this.runningJobs])
    if (this.ownsEmbeddingProvider) await this.embeddingProvider.close?.()
    this.checkpointer.db.close()
    this.db.close()
  }

  /** 启动一个受 AbortController 管理的后台任务。 */
  private startJob(id: string, storyId: string, instruction: string, scope: StoryEvolutionScope, context: EvolutionJobContext, pkg?: StoryEvolutionPackage, resume = false): void {
    if (this.shuttingDown) return
    const running = this.runJob(id, storyId, instruction, scope, context, pkg, resume)
    this.runningJobs.add(running)
    void running.finally(() => this.runningJobs.delete(running))
  }

  /** 创建持久化 job、锁定 scope 并异步执行工作流。 */
  async createJob(storyId: string, instruction: string, scope: StoryEvolutionScope, options: { package?: StoryEvolutionPackage; context?: EvolutionJobContext } = {}): Promise<EvolutionJob> {
    if (this.shuttingDown) throw new Error("Evolution service is shutting down.")
    const id = randomUUID()
    const now = new Date().toISOString()
    const context: EvolutionJobContext = { ...options.context }
    if (scope.type === "player") context.playerId = scope.id
    if (scope.type === "shard") context.shardId = scope.id
    const job: EvolutionJob = { id, storyId, status: "queued", instruction: instruction.trim(), scope, context, createdAt: now, updatedAt: now }
    const insertJob = this.db.transaction(() => {
      const running = this.db.prepare("SELECT job_id FROM evolution_job_locks WHERE story_id=? AND scope_type=? AND scope_id=?").get(storyId, scope.type, scope.id) as { job_id: string } | undefined
      if (running?.job_id) throw new Error("同一 scope 已有演化任务正在运行。")
      this.db.prepare("INSERT INTO evolution_jobs (id,story_id,status,instruction,scope_json,context_json,package_id,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, storyId, "queued", job.instruction, JSON.stringify(scope), JSON.stringify(context), null, null, now, now)
      this.db.prepare("INSERT INTO evolution_job_locks (story_id,scope_type,scope_id,sequence,job_id) VALUES (?,?,?,?,?)").run(storyId, scope.type, scope.id, Date.now(), id)
    })
    insertJob()
    // HTTP 创建接口只负责入队，耗时的 Agent 工作在后台执行，客户端可通过 GET 观察状态。
    this.startJob(id, storyId, instruction, scope, context, options.package)
    return job
  }

  /** 服务启动时恢复持久化的 queued 任务。 */
  private async resumePendingJobs(): Promise<void> {
    const rows = this.db.prepare("SELECT id,story_id,instruction,scope_json,context_json FROM evolution_jobs WHERE status='queued' ORDER BY created_at ASC").all() as Array<{ id: string; story_id: string; instruction: string; scope_json: string; context_json: string }>
    for (const row of rows) {
      const scope = JSON.parse(row.scope_json) as StoryEvolutionScope
      const context = JSON.parse(row.context_json || "{}") as EvolutionJobContext
      this.startJob(row.id, row.story_id, row.instruction, scope, context, undefined, true)
    }
  }

  /** 执行单个 Evolution job，并保证状态、锁和 quarantine 在所有分支一致更新。 */
  private async runJob(id: string, storyId: string, instruction: string, scope: StoryEvolutionScope, context: EvolutionJobContext, pkg?: StoryEvolutionPackage, resume = false): Promise<void> {
    if (this.controllers.has(id)) return
    const controller = new AbortController()
    this.controllers.set(id, controller)
    const now = new Date().toISOString()
    const started = this.db.prepare("UPDATE evolution_jobs SET status='running',updated_at=? WHERE id=? AND status='queued'").run(now, id)
    if (!started.changes) {
      this.controllers.delete(id)
      return
    }
    let generatedPackage: StoryEvolutionPackage | undefined = pkg
    try {
      generatedPackage = pkg ?? await this.createEmptyPackage(storyId, scope, context, instruction, id, resume, controller.signal)
      const generated = generatedPackage
      const current = this.getJob(storyId, id)
      if (controller.signal.aborted || current?.status === "cancelled") return
      const result = await this.publishPackage(storyId, generated, controller.signal)
      if (controller.signal.aborted || this.getJob(storyId, id)?.status === "cancelled") return
      const completedAt = new Date().toISOString()
      this.db.prepare("UPDATE evolution_jobs SET status='completed',package_id=?,updated_at=? WHERE id=? AND status='running'").run(result.package_id, completedAt, id)
    } catch (error) {
      if (controller.signal.aborted || this.getJob(storyId, id)?.status === "cancelled") return
      const message = error instanceof Error ? error.message : "Evolution job failed."
      const failedAt = new Date().toISOString()
      if (generatedPackage) this.db.prepare("INSERT OR REPLACE INTO evolution_package_quarantine (package_id,story_id,package_json,reason,quarantined_at) VALUES (?,?,?,?,?)").run(generatedPackage.package_id, storyId, JSON.stringify(generatedPackage), message, failedAt)
      this.db.prepare("UPDATE evolution_jobs SET status='failed',error=?,updated_at=? WHERE id=?").run(message, failedAt, id)
    } finally {
      this.controllers.delete(id)
      if (!this.shuttingDown || this.getJob(storyId, id)?.status !== "running") this.db.prepare("DELETE FROM evolution_job_locks WHERE job_id=?").run(id)
    }
  }

  /** 列出故事的全部演化任务。 */
  listJobs(storyId: string) { return (this.db.prepare("SELECT * FROM evolution_jobs WHERE story_id=? ORDER BY created_at DESC").all(storyId) as JobRow[]).map(rowToJob) }
  /** 查询单个演化任务。 */
  getJob(storyId: string, id: string) { const row = this.db.prepare("SELECT * FROM evolution_jobs WHERE story_id=? AND id=?").get(storyId, id) as JobRow | undefined; return row ? rowToJob(row) : null }

  /** 取消尚未完成的后台任务，并释放 scope 锁。 */
  cancelJob(storyId: string, id: string): EvolutionJob | null {
    const current = this.getJob(storyId, id)
    if (!current || current.status === "completed" || current.status === "failed" || current.status === "cancelled") return current
    const updatedAt = new Date().toISOString()
    this.db.prepare("UPDATE evolution_jobs SET status='cancelled',updated_at=? WHERE story_id=? AND id=?").run(updatedAt, storyId, id)
    const controller = this.controllers.get(id)
    controller?.abort()
    if (!controller) this.db.prepare("DELETE FROM evolution_job_locks WHERE job_id=?").run(id)
    return this.getJob(storyId, id)
  }

  /** 幂等接收结构化遥测并更新 player、shard、global 聚合。 */
  ingestTelemetry(events: readonly StoryTelemetryEvent[]) {
    const insert = this.db.prepare("INSERT OR IGNORE INTO evolution_telemetry_events (event_id,story_id,player_id,shard_id,session_id,sequence,event_type,payload_json,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)")
    const updateSequence = this.db.prepare("INSERT INTO evolution_telemetry_sequences (story_id,player_id,session_id,last_sequence) VALUES (?,?,?,?) ON CONFLICT(story_id,player_id,session_id) DO UPDATE SET last_sequence=excluded.last_sequence")
    const transaction = this.db.transaction((items: readonly StoryTelemetryEvent[]) => { let accepted = 0; for (const event of items) {
      if (!event.eventId || event.storyId.length > 128 || event.payload && JSON.stringify(event.payload).length > 8192 || !isTelemetryPayloadAllowed(event)) continue
      const previous = this.db.prepare("SELECT last_sequence FROM evolution_telemetry_sequences WHERE story_id=? AND player_id=? AND session_id=?").get(event.storyId, event.playerId, event.sessionId) as { last_sequence: number } | undefined
      if (previous && event.sequence <= previous.last_sequence) continue
      const result = insert.run(event.eventId, event.storyId, event.playerId, event.shardId, event.sessionId, event.sequence, event.type, JSON.stringify(event.payload), event.occurredAt)
      if (result.changes) {
        updateSequence.run(event.storyId, event.playerId, event.sessionId, event.sequence)
        const windowKey = event.occurredAt.slice(0, 13)
        const scopes: Array<["player" | "shard" | "global", string]> = [["player", event.playerId], ["shard", event.shardId], ["global", "global"]]
        for (const [scopeType, scopeId] of scopes) {
          const current = this.db.prepare("SELECT metrics_json FROM evolution_aggregates WHERE story_id=? AND scope_type=? AND scope_id=? AND window_key=?").get(event.storyId, scopeType, scopeId, windowKey) as { metrics_json: string } | undefined
          const metrics = current ? JSON.parse(current.metrics_json) as Record<string, number> : {}
          metrics[event.type] = (metrics[event.type] ?? 0) + 1
          this.db.prepare("INSERT INTO evolution_aggregates (story_id,scope_type,scope_id,window_key,metrics_json) VALUES (?,?,?,?,?) ON CONFLICT(story_id,scope_type,scope_id,window_key) DO UPDATE SET metrics_json=excluded.metrics_json").run(event.storyId, scopeType, scopeId, windowKey, JSON.stringify(metrics))
        }
        accepted += result.changes
      }
    } return accepted })(events)
    return { accepted: transaction, received: events.length }
  }

  /** 读取当前小时窗口指标，并在达到阈值时创建任务。 */
  async evaluate(storyId: string, scope: StoryEvolutionScope, instruction: string, context: EvolutionJobContext = {}): Promise<{ triggered: boolean; metrics: Record<string, number>; job?: EvolutionJob }> {
    const windowKey = new Date().toISOString().slice(0, 13)
    const row = this.db.prepare("SELECT metrics_json FROM evolution_aggregates WHERE story_id=? AND scope_type=? AND scope_id=? AND window_key=?").get(storyId, scope.type, scope.id, windowKey) as { metrics_json: string } | undefined
    const metrics = row ? JSON.parse(row.metrics_json) as Record<string, number> : {}
    const triggered = (metrics["milestone.reached"] ?? 0) >= 1 || Object.values(metrics).reduce((sum, value) => sum + value, 0) >= 10
    if (!triggered) return { triggered, metrics }
    return { triggered, metrics, job: await this.createJob(storyId, instruction, scope, { context }) }
  }

  /** 为指定玩家和分区生成当前有效包 manifest。 */
  async getManifestAsync(storyId: string, playerId = "", shardId = ""): Promise<StoryEvolutionManifest> {
    const document = await this.store.readStoryDocument(storyId)
    const baseContentHash = compileStory(document).compiled.contentHash
    const rows = this.db.prepare("SELECT package_json FROM evolution_packages WHERE story_id=? ORDER BY sequence ASC, published_at ASC").all(storyId) as Array<{ package_json: string }>
    const heads = this.db.prepare("SELECT scope_type, scope_id, package_id FROM evolution_package_heads WHERE story_id=?").all(storyId) as Array<{ scope_type: string; scope_id: string; package_id: string | null }>
    const headMap = new Map(heads.map((head) => [`${head.scope_type}:${head.scope_id}`, head.package_id]))
    const allPackages = rows.map((row) => JSON.parse(row.package_json) as StoryEvolutionPackage)
    const byId = new Map(allPackages.map((pkg) => [pkg.package_id, pkg]))
    const requestedScopes = this.getRelevantScopes({ type: playerId ? "player" : shardId ? "shard" : "global", id: playerId || shardId || "global" }, { playerId, shardId })
    const requestedKeys = new Set(requestedScopes.map((scope) => `${scope.type}:${scope.id}`))
    const selectedHeads = allPackages.filter((pkg) => headMap.get(`${pkg.scope.type}:${pkg.scope.id}`) === pkg.package_id && requestedKeys.has(`${pkg.scope.type}:${pkg.scope.id}`))
    const selected = new Set<string>()
    /** 递归加入 manifest head 的完整父包链。 */
    const visit = (packageId: string) => {
      if (selected.has(packageId)) return
      const pkg = byId.get(packageId)
      if (!pkg) throw new Error(`Manifest references missing package ${packageId}.`)
      selected.add(packageId)
      for (const parentId of pkg.parent_package_ids) visit(parentId)
    }
    for (const pkg of selectedHeads) visit(pkg.package_id)
    const packages = allPackages.filter((pkg) => selected.has(pkg.package_id))
    if (packages.some((pkg) => pkg.scope.type === "shard" && pkg.scope.id !== shardId) || packages.some((pkg) => pkg.scope.type === "player" && pkg.scope.id !== playerId)) {
      throw new Error("Manifest scope lineage does not match the requested player/shard.")
    }
    const effective = compileEffectiveStory({ document, evolutionPackages: packages })
    if (!effective.result.ok) throw new Error(effective.result.issues.filter((issue) => issue.level === "error").map((issue) => issue.message).join("；"))
    const packageIds = effective.compiled.activePackageIds ?? []
    let worldRevision = 0
    for (const scope of requestedScopes) {
      const row = this.db.prepare("SELECT revision FROM evolution_world_states WHERE story_id=? AND scope_type=? AND scope_id=?").get(storyId, scope.type, scope.id) as { revision: number } | undefined
      worldRevision += row?.revision ?? 0
    }
    return { storyId, baseContentHash, packageIds, effectiveContentHash: effective.compiled.effectiveContentHash ?? baseContentHash, semanticModel: { modelId: "Xenova/bge-small-zh-v1.5", dimension: 512, normalized: true }, worldRevision, generatedAt: new Date().toISOString() }
  }

  /** 读取包文件并与 SQLite 索引及基础 hash 交叉校验。 */
  async readPackage(storyId: string, packageId: string): Promise<StoryEvolutionPackage | null> {
    const row = this.db.prepare("SELECT package_json FROM evolution_packages WHERE story_id=? AND package_id=?").get(storyId, packageId) as { package_json: string } | undefined
    if (!row) return null
    const stored = evolutionPackageSchema.parse(JSON.parse(row.package_json))
    const file = evolutionPackageSchema.parse(JSON.parse(await readFile(join(this.packageRoot, storyId, "packages", `${packageId}.json`), "utf8")))
    if (file.package_hash !== stored.package_hash) throw new Error("内容包文件与索引 hash 不一致。")
    const pkg = file
    const document = await this.store.readStoryDocument(storyId)
    const validation = validateEvolutionPackage(pkg, compileStory(document).compiled.contentHash)
    if (!validation.ok) throw new Error(`内容包校验失败：${validation.errors.join("；")}`)
    return pkg
  }

  /** 将指定 scope 回滚到目标包之前的 head；历史包保持不可变。 */
  rollback(storyId: string, scope: StoryEvolutionScope, packageId: string | null): { storyId: string; scope: StoryEvolutionScope; packageId: string | null } {
    if (packageId) {
      const row = this.db.prepare("SELECT package_json FROM evolution_packages WHERE story_id=? AND package_id=?").get(storyId, packageId) as { package_json: string } | undefined
      if (!row) throw new Error("目标回滚包不存在。")
      const pkg = evolutionPackageSchema.parse(JSON.parse(row.package_json))
      if (pkg.scope.type !== scope.type || pkg.scope.id !== scope.id) throw new Error("回滚包 scope 不匹配。")
    }
    const allowed = new Set(packageId ? this.readPackageClosure(storyId, [packageId]).map((pkg) => pkg.package_id) : [])
    const heads = this.db.prepare("SELECT scope_type,scope_id,package_id FROM evolution_package_heads WHERE story_id=? AND package_id IS NOT NULL").all(storyId) as Array<{ scope_type: StoryEvolutionScope["type"]; scope_id: string; package_id: string }>
    const headUpdates = new Map<string, { scope: StoryEvolutionScope; packageId: string | null }>()
    headUpdates.set(`${scope.type}:${scope.id}`, { scope, packageId })
    for (const head of heads) {
      if (head.scope_type === scope.type && head.scope_id === scope.id) continue
      const closure = this.readPackageClosure(storyId, [head.package_id])
      const dependsOnReplacedLineage = closure.some((pkg) => pkg.scope.type === scope.type && pkg.scope.id === scope.id && !allowed.has(pkg.package_id))
      if (dependsOnReplacedLineage) {
        const dependentScope: StoryEvolutionScope = { type: head.scope_type, id: head.scope_id }
        headUpdates.set(`${dependentScope.type}:${dependentScope.id}`, { scope: dependentScope, packageId: null })
      }
    }
    const worldStateUpdates = [...headUpdates.values()].map((update) => {
      const row = this.db.prepare("SELECT revision FROM evolution_world_states WHERE story_id=? AND scope_type=? AND scope_id=?").get(storyId, update.scope.type, update.scope.id) as { revision: number } | undefined
      return { ...update, revision: (row?.revision ?? 0) + 1, state: this.computeScopeWorldState(storyId, update.scope, update.packageId) }
    })
    const transaction = this.db.transaction(() => {
      for (const update of worldStateUpdates) {
        this.db.prepare("INSERT INTO evolution_package_heads (story_id,scope_type,scope_id,package_id) VALUES (?,?,?,?) ON CONFLICT(story_id,scope_type,scope_id) DO UPDATE SET package_id=excluded.package_id").run(storyId, update.scope.type, update.scope.id, update.packageId)
        this.db.prepare("INSERT INTO evolution_world_states (story_id,scope_type,scope_id,revision,state_json) VALUES (?,?,?,?,?) ON CONFLICT(story_id,scope_type,scope_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json").run(storyId, update.scope.type, update.scope.id, update.revision, JSON.stringify(update.state))
      }
    })
    transaction()
    return { storyId, scope, packageId }
  }

  /** 按 global、shard、player 返回本次任务相关 scope。 */
  private getRelevantScopes(scope: StoryEvolutionScope, context: EvolutionJobContext): StoryEvolutionScope[] {
    const scopes: StoryEvolutionScope[] = [{ type: "global", id: "global" }]
    const shardId = scope.type === "shard" ? scope.id : context.shardId
    const playerId = scope.type === "player" ? scope.id : context.playerId
    if (shardId) scopes.push({ type: "shard", id: shardId })
    if (playerId) scopes.push({ type: "player", id: playerId })
    return scopes.filter((candidate, index, values) => values.findIndex((item) => item.type === candidate.type && item.id === candidate.id) === index)
  }

  /** 合并相关 scope 当前发布 head 对应的世界状态。 */
  private readEffectiveWorldState(storyId: string, scopes: readonly StoryEvolutionScope[]): Record<string, string | number | boolean | null> {
    const state: Record<string, string | number | boolean | null> = {}
    for (const scope of scopes) {
      const row = this.db.prepare("SELECT state_json FROM evolution_world_states WHERE story_id=? AND scope_type=? AND scope_id=?").get(storyId, scope.type, scope.id) as { state_json: string } | undefined
      if (row) Object.assign(state, JSON.parse(row.state_json) as Record<string, string | number | boolean | null>)
    }
    return state
  }

  /** 按目标 head 的不可变包闭包重算一个 scope 的持久化世界状态。 */
  private computeScopeWorldState(storyId: string, scope: StoryEvolutionScope, headPackageId: string | null): Record<string, string | number | boolean | null> {
    if (!headPackageId) return {}
    const state: Record<string, string | number | boolean | null> = {}
    for (const pkg of orderEvolutionPackages(this.readPackageClosure(storyId, [headPackageId]))) {
      if (pkg.scope.type !== scope.type || pkg.scope.id !== scope.id) continue
      Object.assign(state, pkg.patch.world_state_patch, pkg.world_state_patch)
    }
    return state
  }

  /** 汇总相关 scope 当前小时窗口的指标。 */
  private readAggregateContext(storyId: string, scopes: readonly StoryEvolutionScope[]): Record<string, number> {
    const windowKey = new Date().toISOString().slice(0, 13)
    const metrics: Record<string, number> = {}
    for (const scope of scopes) {
      const row = this.db.prepare("SELECT metrics_json FROM evolution_aggregates WHERE story_id=? AND scope_type=? AND scope_id=? AND window_key=?").get(storyId, scope.type, scope.id, windowKey) as { metrics_json: string } | undefined
      if (!row) continue
      for (const [key, value] of Object.entries(JSON.parse(row.metrics_json) as Record<string, number>)) metrics[`${scope.type}.${key}`] = value
    }
    return metrics
  }

  /** 准备父链、世界状态和聚合上下文并执行 Evolution LangGraph。 */
  private async createEmptyPackage(storyId: string, scope: StoryEvolutionScope, context: EvolutionJobContext, instruction: string, jobId: string, resume: boolean, signal: AbortSignal): Promise<StoryEvolutionPackage> {
    const document = await this.store.readStoryDocument(storyId)
    const baseContentHash = compileStory(document).compiled.contentHash
    const allRows = this.db.prepare("SELECT package_id, sequence, scope_json FROM evolution_packages WHERE story_id=? ORDER BY sequence DESC").all(storyId) as Array<{ package_id: string; sequence: number; scope_json: string }>
    const sameScope = allRows.filter((row) => { const value = JSON.parse(row.scope_json) as StoryEvolutionScope; return value.type === scope.type && value.id === scope.id })
    const relevantScopes = this.getRelevantScopes(scope, context)
    const parents: string[] = []
    for (const relevantScope of relevantScopes) {
      const head = this.db.prepare("SELECT package_id FROM evolution_package_heads WHERE story_id=? AND scope_type=? AND scope_id=?").get(storyId, relevantScope.type, relevantScope.id) as { package_id: string | null } | undefined
      if (head?.package_id) parents.push(head.package_id)
    }
    const sequence = (sameScope[0]?.sequence ?? 0) + 1
    const threadId = `evolution:${storyId}:${jobId}`
    const checkpoint = resume ? await this.checkpointer.get({ configurable: { thread_id: threadId } }) : null
    if (this.workflowRunner === runEvolutionWorkflow && (!this.options.model?.apiKey || !this.options.model.baseUrl || !this.options.model.model)) {
      throw new Error("Evolution model requires STORY_AI_AGENT_API_KEY, STORY_AI_AGENT_BASE_URL and STORY_EVOLUTION_MODEL.")
    }
    return this.workflowRunner({
      storyId, instruction, scope, document, baseContentHash, parentPackageIds: parents,
      parentPackages: this.readPackageClosure(storyId, parents), sequence,
      context: { worldState: this.readEffectiveWorldState(storyId, relevantScopes), aggregates: this.readAggregateContext(storyId, relevantScopes) },
      checkpointer: this.checkpointer, threadId, resume: resume && Boolean(checkpoint), signal,
      model: this.options.model, embeddingProvider: this.embeddingProvider
    })
  }

  /** 读取指定包及其全部祖先，供有效内容编译使用。 */
  private readPackageClosure(storyId: string, packageIds: readonly string[]): StoryEvolutionPackage[] {
    const result = new Map<string, StoryEvolutionPackage>()
    /** 递归读取指定包及其全部父包。 */
    const visit = (packageId: string) => {
      if (result.has(packageId)) return
      const row = this.db.prepare("SELECT package_json FROM evolution_packages WHERE story_id=? AND package_id=?").get(storyId, packageId) as { package_json: string } | undefined
      if (!row) throw new Error(`父包不存在：${packageId}`)
      const pkg = evolutionPackageSchema.parse(JSON.parse(row.package_json))
      result.set(packageId, pkg)
      for (const parentId of pkg.parent_package_ids) visit(parentId)
    }
    for (const packageId of packageIds) visit(packageId)
    return [...result.values()]
  }

  /** 完整校验候选包，并用临时文件和原子 rename 发布。 */
  private async publishPackage(storyId: string, pkg: StoryEvolutionPackage, signal?: AbortSignal): Promise<StoryEvolutionPackage> {
    if (signal?.aborted) throw new DOMException("Evolution publish was aborted.", "AbortError")
    const document = await this.store.readStoryDocument(storyId)
    const baseContentHash = compileStory(document).compiled.contentHash
    const parsed = evolutionPackageSchema.parse(pkg)
    if (parsed.story_id !== storyId) throw new Error("内容包 story_id 与发布目标不匹配。")
    const validation = validateEvolutionPackage(parsed, baseContentHash)
    if (!validation.ok) throw new Error(validation.errors.join("；"))
    const duplicate = this.db.prepare("SELECT 1 FROM evolution_packages WHERE story_id=? AND json_extract(scope_json,'$.type')=? AND json_extract(scope_json,'$.id')=? AND sequence=?").get(storyId, parsed.scope.type, parsed.scope.id, parsed.sequence)
    if (duplicate) throw new Error("同一 scope 的 sequence 已经发布。")
    for (const parentId of parsed.parent_package_ids) {
      const parent = this.db.prepare("SELECT package_json FROM evolution_packages WHERE story_id=? AND package_id=?").get(storyId, parentId) as { package_json: string } | undefined
      if (!parent) throw new Error(`父包不存在：${parentId}`)
    }
    const parentPackages = this.readPackageClosure(storyId, parsed.parent_package_ids)
    const dependencyValidation = validateEvolutionPackageDependencies([...parentPackages, parsed], baseContentHash)
    if (!dependencyValidation.ok) throw new Error(dependencyValidation.issues.map((issue) => issue.message).join("；"))
    const effective = compileEffectiveStory({ document, evolutionPackages: [...parentPackages, parsed] })
    if (!effective.result.ok) throw new Error(effective.result.issues.filter((issue) => issue.level === "error").map((issue) => issue.message).join("；"))
    if (signal?.aborted) throw new DOMException("Evolution publish was aborted.", "AbortError")
    const dir = join(this.packageRoot, storyId, "packages")
    await mkdir(dir, { recursive: true })
    const target = join(dir, `${parsed.package_id}.json`)
    const temp = `${target}.${randomUUID()}.tmp`
    const stateRow = this.db.prepare("SELECT state_json, revision FROM evolution_world_states WHERE story_id=? AND scope_type=? AND scope_id=?").get(storyId, parsed.scope.type, parsed.scope.id) as { state_json: string; revision: number } | undefined
    const nextState = { ...(stateRow ? JSON.parse(stateRow.state_json) as Record<string, unknown> : {}), ...parsed.patch.world_state_patch, ...parsed.world_state_patch }
    let renamed = false
    try {
      await writeFile(temp, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
      if (signal?.aborted) throw new DOMException("Evolution publish was aborted.", "AbortError")
      await rename(temp, target)
      renamed = true
      if (signal?.aborted) throw new DOMException("Evolution publish was aborted.", "AbortError")
      const publish = this.db.transaction(() => {
        this.db.prepare("INSERT INTO evolution_packages (package_id,story_id,scope_json,sequence,package_json,published_at) VALUES (?,?,?,?,?,?)").run(parsed.package_id, storyId, JSON.stringify(parsed.scope), parsed.sequence, JSON.stringify(parsed), parsed.created_at)
        this.db.prepare("INSERT INTO evolution_package_heads (story_id,scope_type,scope_id,package_id) VALUES (?,?,?,?) ON CONFLICT(story_id,scope_type,scope_id) DO UPDATE SET package_id=excluded.package_id").run(storyId, parsed.scope.type, parsed.scope.id, parsed.package_id)
        this.db.prepare("INSERT INTO evolution_world_states (story_id,scope_type,scope_id,revision,state_json) VALUES (?,?,?,?,?) ON CONFLICT(story_id,scope_type,scope_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json").run(storyId, parsed.scope.type, parsed.scope.id, (stateRow?.revision ?? 0) + 1, JSON.stringify(nextState))
      })
      publish()
    } catch (error) {
      await unlink(temp).catch(() => undefined)
      const published = this.db.prepare("SELECT 1 FROM evolution_packages WHERE package_id=?").get(parsed.package_id)
      if (renamed && !published) await unlink(target).catch(() => undefined)
      throw error
    }
    return parsed
  }
}
