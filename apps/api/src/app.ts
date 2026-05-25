import cors from "@koa/cors"
import Koa from "koa"
import bodyParser from "koa-bodyparser"
import { createStoryFileStore, FileStoreError } from "@story-mgr/file-store"
import type { ApiErrorResponse } from "@story-mgr/shared"
import type { ApiConfig } from "./config"
import { createStoriesRouter } from "./routes/stories"

export function createApp(config: ApiConfig) {
  const app = new Koa()
  const store = createStoryFileStore(config.dataDir)
  const storiesRouter = createStoriesRouter(store, config)

  app.use(async (context, next) => {
    try {
      await next()

      if (context.status === 404 && !context.body) {
        context.status = 404
        context.body = {
          error: {
            message: "Route not found.",
            code: "route.not-found"
          }
        } satisfies ApiErrorResponse
      }
    } catch (error) {
      if (error instanceof FileStoreError) {
        context.status = error.statusCode
        context.body = {
          error: {
            message: error.message,
            code: error.code
          }
        } satisfies ApiErrorResponse
        return
      }

      if (error instanceof Error) {
        context.status = 500
        context.body = {
          error: {
            message: error.message,
            code: "internal.error"
          }
        } satisfies ApiErrorResponse
        return
      }

      throw error
    }
  })

  app.use(cors())
  app.use(bodyParser())
  app.use(async (context, next) => {
    const startedAt = Date.now()
    await next()
    const elapsedMs = Date.now() - startedAt

    console.info(
      `[api] ${context.method} ${context.path} -> ${context.status} (${elapsedMs}ms)`
    )
  })

  app.use(storiesRouter.routes())
  app.use(storiesRouter.allowedMethods())

  return app
}
