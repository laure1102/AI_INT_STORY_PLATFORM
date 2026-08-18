import Router from "@koa/router"
import { evolutionScopeSchema, telemetryEventSchema } from "@story-mgr/evolution"
import type { StoryFileStore } from "@story-mgr/file-store"
import type { ApiConfig } from "../config"
import { requireParam } from "./story-route-helpers"
import { EvolutionService } from "../services/evolution"

/** 注册演化任务、内容分发、遥测、评估和回滚端点。 */
export function registerStoryEvolutionRoutes(router: Router, store: StoryFileStore, config: ApiConfig, evolution: EvolutionService) {
  router.post("/stories/:storyId/evolution/jobs", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as Record<string, unknown>
    const instruction = typeof body?.instruction === "string" ? body.instruction : "根据当前世界状态生成下一阶段内容。"
    const scope = evolutionScopeSchema.parse(body?.scope ?? { type: "player", id: String(body?.playerId ?? "default") })
    context.status = 202
    context.body = { job: await evolution.createJob(storyId, instruction, scope, { context: {
      playerId: typeof body?.playerId === "string" ? body.playerId : undefined,
      shardId: typeof body?.shardId === "string" ? body.shardId : undefined
    } }) }
  })
  router.get("/stories/:storyId/evolution/jobs", (context) => {
    context.body = { jobs: evolution.listJobs(requireParam(context.params.storyId, "storyId")) }
  })
  router.get("/stories/:storyId/evolution/jobs/:jobId", (context) => {
    const job = evolution.getJob(requireParam(context.params.storyId, "storyId"), requireParam(context.params.jobId, "jobId"))
    if (!job) context.throw(404, "Evolution job was not found.")
    context.body = { job }
  })
  router.post("/stories/:storyId/evolution/jobs/:jobId/cancel", (context) => {
    const job = evolution.cancelJob(requireParam(context.params.storyId, "storyId"), requireParam(context.params.jobId, "jobId"))
    if (!job) context.throw(404, "Evolution job was not found.")
    context.body = { job }
  })
  router.get("/stories/:storyId/evolution/manifest", async (context) => {
    context.body = await evolution.getManifestAsync(requireParam(context.params.storyId, "storyId"), context.query.playerId?.toString(), context.query.shardId?.toString())
  })
  router.get("/stories/:storyId/evolution/packages/:packageId", async (context) => {
    const pkg = await evolution.readPackage(requireParam(context.params.storyId, "storyId"), requireParam(context.params.packageId, "packageId"))
    if (!pkg) context.throw(404, "Evolution package was not found.")
    context.body = pkg
  })
  router.post("/stories/:storyId/evolution/rollback", (context) => {
    const body = context.request.body as Record<string, unknown>
    const scope = evolutionScopeSchema.parse(body?.scope)
    const packageId = typeof body?.packageId === "string" && body.packageId.trim() ? body.packageId.trim() : null
    context.body = evolution.rollback(requireParam(context.params.storyId, "storyId"), scope, packageId)
  })
  router.post("/stories/:storyId/evolution/telemetry", (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as Record<string, unknown>
    const rawEvents = body?.events
    if (!Array.isArray(rawEvents) || rawEvents.length > 100) {
      context.throw(400, "遥测批次必须是最多 100 条事件的数组。")
      return
    }
    const events = rawEvents.map((event: unknown) => telemetryEventSchema.parse(event)).map((event) => {
      if (event.storyId !== storyId) context.throw(400, "遥测事件 storyId 与路径不匹配。")
      return event
    })
    context.body = evolution.ingestTelemetry(events)
  })
  router.post("/stories/:storyId/evolution/evaluate", async (context) => {
    const body = context.request.body as Record<string, unknown>
    const scope = evolutionScopeSchema.parse(body?.scope ?? { type: "global", id: "global" })
    context.body = await evolution.evaluate(requireParam(context.params.storyId, "storyId"), scope, typeof body?.instruction === "string" ? body.instruction : "根据聚合行为演化世界。", {
      playerId: typeof body?.playerId === "string" ? body.playerId : undefined,
      shardId: typeof body?.shardId === "string" ? body.shardId : undefined
    })
  })
}
