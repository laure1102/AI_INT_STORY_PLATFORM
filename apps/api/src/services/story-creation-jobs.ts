/**
 * 可恢复 AI 创作任务服务。
 *
 * HTTP 路由把“创建、查询、取消、订阅任务”的请求交给这个类。任务基本信息和节点日志保存在
 * SQLite，LangGraph 执行进度由同库中的 checkpointer 保存，实时变化再通过 EventEmitter 发给 SSE。
 * 本模块不生成提示词、不修改正式故事，也不自动应用 AI 草稿。
 */
import { EventEmitter } from "node:events"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite"
import type { StoryFileStore } from "@story-mgr/file-store"
import { FileStoreError } from "@story-mgr/file-store"
import type {
  CreateStoryCreationJobRequest,
  RunStoryCreationAgentResponse,
  StoryCreationAgentRole,
  StoryCreationJob,
  StoryCreationJobNodeLog,
  StoryCreationJobStreamEvent
} from "@story-mgr/shared"
import Database from "better-sqlite3"
import {
  runStoryCreationAgents,
  type StoryCreationWorkflowObserver
} from "./story-creation"

/** Agent 内部角色名到界面中文标题的固定映射。 */
const ROLE_TITLES: Record<StoryCreationAgentRole, string> = {
  chiefEditor: "总主编",
  plotPlanner: "剧情规划",
  assetDesigner: "资产设计",
  eventWriter: "事件写作",
  scriptDoctor: "脚本审校",
  consistencyChecker: "一致性检查"
}

/** SQLite 查询得到的原始行；数据库列使用 snake_case，且 JSON 字段仍是字符串。 */
interface JobRow {
  id: string
  story_id: string
  thread_id: string
  status: StoryCreationJob["status"]
  instruction: string
  base_draft_json: string | null
  logs_json: string
  result_json: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  current_role: StoryCreationAgentRole | null
}

/**
 * 安全解析数据库中的 JSON 字符串。
 *
 * @param value SQLite 文本列；NULL 表示没有保存该值。
 * @param fallback 字段为空或历史数据损坏时使用的默认值。
 * @returns 成功时返回 JSON.parse 的结果，失败时返回 fallback。
 *
 * 任务列表不能因为一条旧日志损坏就让整个 API 崩溃，因此这里选择降级。真正的工作流输入仍会被
 * 后续 Schema 校验；这个函数只负责让历史任务可读取。
 */
function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/**
 * 判断任务是否已经结束。
 *
 * @param status 当前任务状态。
 * @returns completed、failed、cancelled 返回 true；queued、running 返回 false。
 */
function isTerminalStatus(status: StoryCreationJob["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
}

/**
 * 把 SQLite 行转换成可返回给前端的任务对象。
 *
 * @param row 数据库原始行。
 * @returns camelCase 的 `StoryCreationJob`；JSON 文本被解析，可空字段只在有值时加入结果。
 *
 * 所有数据库读取都走这个函数，避免列表接口和详情接口对同一列产生不同解释。
 */
function rowToJob(row: JobRow): StoryCreationJob {
  return {
    id: row.id,
    storyId: row.story_id,
    threadId: row.thread_id,
    status: row.status,
    instruction: row.instruction,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.current_role ? { currentRole: row.current_role } : {}),
    logs: parseJson<StoryCreationJobNodeLog[]>(row.logs_json, []),
    ...(row.result_json
      ? { result: parseJson<RunStoryCreationAgentResponse | undefined>(row.result_json, undefined) }
      : {}),
    ...(row.error_code && row.error_message
      ? { error: { code: row.error_code, message: row.error_message } }
      : {})
  }
}

/**
 * 为任务失败选择稳定的机器可读错误码。
 *
 * @param error 工作流抛出的任意值。
 * @returns File Store 业务错误保留原 code，其余未知异常统一为 `ai.job-failed`。
 */
function errorCode(error: unknown): string {
  return error instanceof FileStoreError ? error.code : "ai.job-failed"
}

/**
 * 生成可以安全展示给浏览器的错误消息。
 *
 * @param error 工作流抛出的任意错误。
 * @returns 4xx File Store 错误返回原消息；服务端/上游错误返回不含内部细节的通用中文提示。
 */
function publicErrorMessage(error: unknown): string {
  if (error instanceof FileStoreError && error.statusCode < 500) {
    return error.message
  }
  return "AI 创作任务执行失败，请查看服务端日志。"
}

/**
 * 管理 AI 创作任务的持久化状态、后台执行和实时订阅。
 *
 * 一个实例对应一个 API 进程。公开方法供路由调用，私有方法维护以下状态机：
 * `queued → running → completed | failed | cancelled`。正式故事不会在这条状态机中被写入。
 */
export class StoryCreationJobService {
  private readonly database: Database.Database
  private readonly checkpointer: SqliteSaver
  private readonly events = new EventEmitter()
  private readonly controllers = new Map<string, AbortController>()
  private readonly runningJobs = new Map<string, Promise<void>>()
  private shuttingDown = false

  /**
   * 创建任务服务并准备 SQLite 表与 LangGraph checkpointer。
   *
   * @param store File Store 门面，运行任务前用它读取设置和故事快照。
   * @param stateDir 被 `.gitignore` 忽略的运行状态目录。
   * @param runWorkflow 实际工作流函数；默认使用生产实现，测试可以注入可控假实现。
   * @throws 目录创建、SQLite 打开或建表失败时抛错，阻止 API 以不可恢复模式启动。
   *
   * WAL 模式允许读取任务状态和后台写日志更平滑地并行。任务表保存面向 API 的状态；同一个数据库
   * 还交给 SqliteSaver 保存 LangGraph checkpoint，两者通过稳定 threadId 关联。
   */
  constructor(
    private readonly store: StoryFileStore,
    stateDir: string,
    private readonly runWorkflow: typeof runStoryCreationAgents = runStoryCreationAgents
  ) {
    mkdirSync(stateDir, { recursive: true })
    const databasePath = join(stateDir, "creation-jobs.sqlite")
    this.database = new Database(databasePath)
    this.database.pragma("journal_mode = WAL")
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS story_creation_jobs (
        id TEXT PRIMARY KEY,
        story_id TEXT NOT NULL,
        thread_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        instruction TEXT NOT NULL,
        base_draft_json TEXT,
        logs_json TEXT NOT NULL,
        result_json TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        current_role TEXT
      );
      CREATE INDEX IF NOT EXISTS story_creation_jobs_story_created
        ON story_creation_jobs(story_id, created_at DESC);
    `)
    this.checkpointer = SqliteSaver.fromConnString(databasePath)
  }

  /**
   * 创建一条 queued 任务并安排后台执行。
   *
   * @param storyId 任务所属故事 id。
   * @param request 已通过 Zod 的 instruction 和可选 baseDraft。
   * @returns 刚写入数据库的任务，此时状态为 queued。
   * @throws SQLite 写入失败时抛错；不会留下仅存在于内存的假任务。
   *
   * `threadId` 固定为 `<storyId>:<jobId>`，因此进程重启后仍能找到同一份 LangGraph checkpoint。
   * `queueMicrotask` 让 HTTP 创建接口先拿到 201 响应，再在当前事件循环之后启动耗时工作流。
   */
  createJob(storyId: string, request: CreateStoryCreationJobRequest): StoryCreationJob {
    const id = randomUUID()
    const now = new Date().toISOString()
    const job: StoryCreationJob = {
      id,
      storyId,
      threadId: `${storyId}:${id}`,
      status: "queued",
      instruction: request.instruction.trim(),
      createdAt: now,
      updatedAt: now,
      logs: []
    }
    this.database.prepare(`
      INSERT INTO story_creation_jobs (
        id, story_id, thread_id, status, instruction, base_draft_json,
        logs_json, result_json, error_code, error_message, created_at,
        updated_at, started_at, completed_at, current_role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL)
    `).run(
      job.id,
      job.storyId,
      job.threadId,
      job.status,
      job.instruction,
      request.baseDraft ? JSON.stringify(request.baseDraft) : null,
      JSON.stringify(job.logs),
      now,
      now
    )
    queueMicrotask(() => this.startJob(id))
    return job
  }

  /**
   * 查询指定故事中的单个任务。
   *
   * @param storyId 用于限制任务所属故事，防止拿另一个故事的 jobId 越权查询。
   * @param jobId 任务 UUID。
   * @returns 已从 SQLite 行转换好的公开任务对象。
   * @throws 不存在或不属于该故事时抛 `FileStoreError(404)`。
   */
  getJob(storyId: string, jobId: string): StoryCreationJob {
    const row = this.database.prepare(
      "SELECT * FROM story_creation_jobs WHERE id = ? AND story_id = ?"
    ).get(jobId, storyId) as JobRow | undefined
    if (!row) {
      throw new FileStoreError("Creation job was not found.", 404, "ai.job-not-found")
    }
    return rowToJob(row)
  }

  /**
   * 列出某个故事的全部创作任务。
   *
   * @param storyId 要查询的故事 id。
   * @returns 按 created_at 从新到旧排列的任务数组。
   */
  listJobs(storyId: string): StoryCreationJob[] {
    return (this.database.prepare(
      "SELECT * FROM story_creation_jobs WHERE story_id = ? ORDER BY created_at DESC"
    ).all(storyId) as JobRow[]).map(rowToJob)
  }

  /**
   * 取消 queued 或 running 任务。
   *
   * @param storyId 任务所属故事，用于安全查询。
   * @param jobId 待取消任务 id。
   * @returns 最新任务；已是终态时原样返回，取消成功时状态为 cancelled。
   * @throws 任务不存在时抛 404。
   *
   * 先触发 AbortController 让模型/工作流尽快停下，再持久化 cancelled，最后广播 status。即使上游模型
   * 不能立即响应 abort，`runJob` 结束时也会再次读取状态，避免把已取消任务误写成 completed。
   */
  cancelJob(storyId: string, jobId: string): StoryCreationJob {
    const job = this.getJob(storyId, jobId)
    if (isTerminalStatus(job.status)) return job
    this.controllers.get(jobId)?.abort()
    const cancelled = this.updateJob(jobId, {
      status: "cancelled",
      currentRole: undefined,
      completedAt: new Date().toISOString(),
      error: { code: "ai.job-cancelled", message: "AI 创作任务已取消。" }
    })
    this.emit({ type: "status", job: cancelled })
    return cancelled
  }

  /**
   * 订阅某个任务的实时日志和状态变化。
   *
   * @param jobId 要订阅的任务 id。
   * @param listener 每次收到 `log` 或 `status` 事件时调用的函数，SSE 路由会把它写给浏览器。
   * @returns 取消订阅函数；连接关闭时必须调用，防止 EventEmitter 长期保留监听器。
   */
  subscribe(
    jobId: string,
    listener: (event: StoryCreationJobStreamEvent) => void
  ): () => void {
    const eventName = `job:${jobId}`
    this.events.on(eventName, listener)
    /** 无入参、无返回值；只移除本次订阅注册的 listener。 */
    return () => this.events.off(eventName, listener)
  }

  /**
   * 在 API 启动时恢复上次进程未完成的任务。
   *
   * @returns 无返回值；每条 queued/running 记录都会被安排进微任务队列。
   *
   * 这里只决定“哪些任务需要恢复”，checkpoint 是否存在以及从哪里继续由 `runJob` 判断。按创建时间
   * 排序可以让较早任务先启动，行为更容易理解和复现。
   */
  resumePendingJobs(): void {
    const rows = this.database.prepare(
      "SELECT id FROM story_creation_jobs WHERE status IN ('queued', 'running') ORDER BY created_at"
    ).all() as Array<{ id: string }>
    for (const row of rows) {
      queueMicrotask(() => this.startJob(row.id, true))
    }
  }

  /**
   * 停止接受后台工作，并安全关闭数据库。
   *
   * @returns 所有已启动任务结束清理、两个 SQLite 连接关闭后 resolve。
   *
   * 先设置 shuttingDown，随后 abort 所有运行任务，并等待它们的 finally 执行。这样关闭引起的 abort
   * 不会被误记成用户取消；任务仍保留 running 状态，下次启动会从 checkpoint 恢复。
   */
  async close(): Promise<void> {
    this.shuttingDown = true
    for (const controller of this.controllers.values()) controller.abort()
    await Promise.allSettled(this.runningJobs.values())
    this.checkpointer.db.close()
    this.database.close()
  }

  /**
   * 确保同一 jobId 在当前进程最多只有一个执行 Promise。
   *
   * @param jobId 待执行任务 id。
   * @param recovering 是否来自进程启动恢复。
   * @returns 无返回值；任务 Promise 保存到 `runningJobs`，结束时自动移除。
   */
  private startJob(jobId: string, recovering = false): void {
    if (this.runningJobs.has(jobId)) return
    const task = this.runJob(jobId, recovering).finally(() => this.runningJobs.delete(jobId))
    this.runningJobs.set(jobId, task)
  }

  /**
   * 根据事件内容找到 jobId 并广播到对应订阅频道。
   *
   * @param event 任务状态或节点日志事件。
   * @returns 无返回值；所有 `job:<jobId>` 监听器会同步收到该事件。
   *
   * 日志 id 格式为 `<jobId>:<role>:<序号>`，因此 log 事件可以从第一个冒号前还原所属任务。
   */
  private emit(event: StoryCreationJobStreamEvent): void {
    const jobId = event.type === "log" ? event.log.id.split(":", 1)[0] : event.job.id
    this.events.emit(`job:${jobId}`, event)
  }

  /**
   * 合并并持久化一次任务状态更新。
   *
   * @param jobId 要更新的任务 id。
   * @param changes 需要覆盖的公开任务字段。
   * @returns 写入后的完整任务对象，并自动刷新 updatedAt。
   * @throws 数据库中不存在该任务或 UPDATE 失败时抛错。
   *
   * 方法先读出完整当前值再合并，随后把数组/结果重新序列化到 JSON 文本列。所有状态变化都走这里，
   * 避免某个分支忘记更新时间或清理 error/currentRole。
   */
  private updateJob(jobId: string, changes: Partial<StoryCreationJob>): StoryCreationJob {
    const row = this.database.prepare("SELECT * FROM story_creation_jobs WHERE id = ?").get(jobId) as JobRow
    const current = rowToJob(row)
    const next: StoryCreationJob = {
      ...current,
      ...changes,
      updatedAt: new Date().toISOString()
    }
    this.database.prepare(`
      UPDATE story_creation_jobs SET
        status = ?, logs_json = ?, result_json = ?, error_code = ?, error_message = ?,
        updated_at = ?, started_at = ?, completed_at = ?, current_role = ?
      WHERE id = ?
    `).run(
      next.status,
      JSON.stringify(next.logs),
      next.result ? JSON.stringify(next.result) : null,
      next.error?.code ?? null,
      next.error?.message ?? null,
      next.updatedAt,
      next.startedAt ?? null,
      next.completedAt ?? null,
      next.currentRole ?? null,
      jobId
    )
    return next
  }

  /**
   * 创建把 LangGraph 节点生命周期写回任务日志的观察器。
   *
   * @param jobId 当前工作流所属任务。
   * @returns 传给工作流的 observer，负责节点开始、完成、错误、重试和 token 累加。
   *
   * `activeLogIds` 保存每个角色当前日志 id。回调不会持有旧 job 快照，而是每次重新读取 SQLite，
   * 因为其他回调或取消请求可能刚刚更新过同一任务。
   */
  private createObserver(jobId: string): StoryCreationWorkflowObserver {
    const activeLogIds = new Map<StoryCreationAgentRole, string>()

    /**
     * 不可变地更新某个角色正在运行的日志，并广播日志与任务快照。
     *
     * @param role 要更新的 Agent 角色。
     * @param updater 接收旧日志并返回新日志的纯函数。
     * @returns 无返回值；找不到活动日志时忽略迟到的回调。
     */
    const updateLog = (
      role: StoryCreationAgentRole,
      updater: (log: StoryCreationJobNodeLog) => StoryCreationJobNodeLog
    ) => {
      const job = this.getJobById(jobId)
      const logId = activeLogIds.get(role)
      if (!logId) return
      let changed: StoryCreationJobNodeLog | undefined
      const logs = job.logs.map((log) => {
        if (log.id !== logId) return log
        changed = updater(log)
        return changed
      })
      const next = this.updateJob(jobId, { logs })
      if (changed) this.events.emit(`job:${jobId}`, { type: "log", log: changed } satisfies StoryCreationJobStreamEvent)
      this.events.emit(`job:${jobId}`, { type: "status", job: next } satisfies StoryCreationJobStreamEvent)
    }

    return {
      /** 节点开始：创建 running 日志，记录模型，并把 currentRole 切到该角色。 */
      onNodeStart: (role, model) => {
        const job = this.getJobById(jobId)
        const startedAt = new Date().toISOString()
        const log: StoryCreationJobNodeLog = {
          id: `${jobId}:${role}:${job.logs.length + 1}`,
          role,
          title: ROLE_TITLES[role],
          summary: "",
          status: "running",
          model: model || "未配置",
          startedAt,
          retryCount: 0,
          tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null }
        }
        activeLogIds.set(role, log.id)
        const next = this.updateJob(jobId, { currentRole: role, logs: [...job.logs, log] })
        this.events.emit(`job:${jobId}`, { type: "log", log } satisfies StoryCreationJobStreamEvent)
        this.events.emit(`job:${jobId}`, { type: "status", job: next } satisfies StoryCreationJobStreamEvent)
      },
      /** 节点完成：保存摘要、结束时间和由开始时间计算出的耗时。 */
      onNodeComplete: (role, summary) => {
        updateLog(role, (log) => ({
          ...log,
          status: "completed",
          summary,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - Date.parse(log.startedAt)
        }))
      },
      /** 节点异常：根据 AbortSignal 区分用户取消和真正失败，并记录稳定错误码。 */
      onNodeError: (role, error) => {
        const cancelled = this.controllers.get(jobId)?.signal.aborted ?? false
        updateLog(role, (log) => ({
          ...log,
          status: cancelled ? "cancelled" : "failed",
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - Date.parse(log.startedAt),
          errorCode: cancelled ? "ai.job-cancelled" : errorCode(error)
        }))
      },
      /** 模型尝试次数从 1 开始，只有第二次及以后才算 retry。 */
      onModelAttempt: (role, attempt) => {
        if (attempt <= 1) return
        updateLog(role, (log) => ({ ...log, retryCount: log.retryCount + 1 }))
      },
      /** 把一次模型调用的 token 用量累加到当前节点日志。 */
      onTokenUsage: (role, usage) => {
        updateLog(role, (log) => {
          /**
           * 累加一个可能缺失的 token 计数。
           *
           * @param current 日志中已有总数，null 表示上游从未报告。
           * @param next 本次调用报告的数量，null 表示本次也未知。
           * @returns 本次未知时保留旧值，否则按 0 起点累加。
           */
          const add = (current: number | null, next: number | null) => {
            if (next === null) return current
            return (current ?? 0) + next
          }
          return {
            ...log,
            tokenUsage: {
              inputTokens: add(log.tokenUsage.inputTokens, usage.inputTokens),
              outputTokens: add(log.tokenUsage.outputTokens, usage.outputTokens),
              totalTokens: add(log.tokenUsage.totalTokens, usage.totalTokens)
            }
          }
        })
      }
    }
  }

  /**
   * 仅按 jobId 查询内部任务，不做 storyId 所属检查。
   *
   * @param jobId 由服务内部流程传入的任务 UUID。
   * @returns 转换后的任务对象。
   * @throws 数据库中找不到任务时抛 404。
   *
   * HTTP 路由不得使用这个方法；公开的 `getJob` 额外检查 storyId，才能防止跨故事读取。
   */
  private getJobById(jobId: string): StoryCreationJob {
    const row = this.database.prepare("SELECT * FROM story_creation_jobs WHERE id = ?").get(jobId) as JobRow | undefined
    if (!row) throw new FileStoreError("Creation job was not found.", 404, "ai.job-not-found")
    return rowToJob(row)
  }

  /**
   * 执行或恢复一个完整 AI 创作任务。
   *
   * @param jobId 要执行的持久化任务 id。
   * @param recovering true 表示任务来自进程启动扫描，可尝试恢复 checkpoint。
   * @returns Promise；任务进入 completed、failed、cancelled，或因服务关闭保留为 running 后结束。
   * @throws 不向调用方传播工作流异常；异常会记录并转换为持久化 failed 状态。
   *
   * 关键执行顺序：
   * 1. 拒绝终态任务和当前进程已经执行的任务，避免重复模型调用。
   * 2. 建立 AbortController，并先持久化 running，让查询接口立即看到真实状态。
   * 3. 并行读取应用设置、故事快照和同 threadId 的 LangGraph checkpoint。
   * 4. 只有“启动恢复且 checkpoint 存在”才传 resume=true；普通新任务始终从头运行。
   * 5. 工作流成功后写 completed/result；异常时区分取消、关机和真正失败。
   * 6. finally 总会删除 controller，避免完成任务仍被误认为可取消。
   */
  private async runJob(jobId: string, recovering = false): Promise<void> {
    let job = this.getJobById(jobId)
    if (isTerminalStatus(job.status) || this.controllers.has(jobId)) return

    const controller = new AbortController()
    this.controllers.set(jobId, controller)
    const startedAt = job.startedAt ?? new Date().toISOString()
    job = this.updateJob(jobId, {
      status: "running",
      startedAt,
      completedAt: undefined,
      error: undefined
    })
    this.events.emit(`job:${jobId}`, { type: "status", job } satisfies StoryCreationJobStreamEvent)

    try {
      const row = this.database.prepare("SELECT * FROM story_creation_jobs WHERE id = ?").get(jobId) as JobRow
      const [settings, story, checkpoint] = await Promise.all([
        this.store.readAppSettings(),
        this.store.readStoryDocument(job.storyId),
        this.checkpointer.get({ configurable: { thread_id: job.threadId } })
      ])
      if (controller.signal.aborted || this.getJobById(jobId).status === "cancelled") return

      const result = await this.runWorkflow(
        settings,
        story,
        job.instruction,
        parseJson(row.base_draft_json, undefined),
        controller.signal,
        {
          checkpointer: this.checkpointer,
          threadId: job.threadId,
          resume: recovering && Boolean(checkpoint),
          observer: this.createObserver(jobId)
        }
      )
      const completed = this.updateJob(jobId, {
        status: "completed",
        currentRole: undefined,
        completedAt: new Date().toISOString(),
        result,
        error: undefined
      })
      this.events.emit(`job:${jobId}`, { type: "status", job: completed } satisfies StoryCreationJobStreamEvent)
    } catch (error) {
      if (controller.signal.aborted || this.getJobById(jobId).status === "cancelled") {
        if (!this.shuttingDown && this.getJobById(jobId).status !== "cancelled") {
          this.cancelJob(job.storyId, jobId)
        }
        return
      }
      console.error(`[api] creation job ${jobId} failed`, error)
      const failed = this.updateJob(jobId, {
        status: "failed",
        currentRole: undefined,
        completedAt: new Date().toISOString(),
        error: { code: errorCode(error), message: publicErrorMessage(error) }
      })
      this.events.emit(`job:${jobId}`, { type: "status", job: failed } satisfies StoryCreationJobStreamEvent)
    } finally {
      this.controllers.delete(jobId)
    }
  }
}
