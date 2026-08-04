/**
 * 协调故事写操作的“进程内互斥锁”和“乐观并发修订号”。
 *
 * 为什么需要两层保护：互斥锁防止同一 Node 进程内两个请求同时改一个故事；revision 防止用户拿着
 * 旧页面、旧弹窗或旧 AI 草稿覆盖已经保存的新内容。同一个 storyId 的操作按进入顺序排队，不同
 * storyId 使用不同队列，仍然可以并行处理。
 *
 * 输入来源：Store 门面的所有读修订号和修改请求。
 * 输出去向：领域写入操作及 `.story-manager/revisions/` 中的 revision 文件。
 * 不负责：业务数据校验和多文件回滚；它们分别由调用方与 persistence 事务层负责。
 */
import type { StoryMutationResult } from "./types"
import { FileStoreError, isFileStoreError } from "./errors"
import {
  createStoryPaths,
  createStoryStatePaths,
  readJson5File,
  recoverStoryTransactions,
  writeJson5File
} from "./persistence"
import { ensureStoryExists } from "./readers"

/**
 * 创建按 storyId 分组的写入协调器。
 * @param dataDir 数据根目录，用于定位 revision 和事务状态文件。
 * @returns 独占执行、读取 revision 和带 revision 修改的四个方法。
 *
 * 队列只保存在当前 Node 进程内；跨请求的旧数据覆盖问题由持久化 revision 再做一次检查。
 */
export function createStoryMutationCoordinator(dataDir: string) {
  // Map 中保存的是“当前故事队列的末尾 Promise”，不是业务操作结果。
  // 这样前一个操作无论成功还是失败，后一个操作都能在它释放后继续执行。
  const storyQueues = new Map<string, Promise<void>>()

  /**
   * 在指定故事的独占队列中运行操作。
   *
   * @param storyId 用作队列键的故事 id；不同 id 互不阻塞。
   * @param operation 获得该故事独占权后执行的异步业务操作。
   * @returns `operation` 的原始结果。
   * @throws `operation` 的错误原样向上传递，但仍会在 finally 中释放队列。
   *
   * `previous` 表示前一个排队项；`current` 是本次操作占用锁期间不会完成的 Promise。先把 current
   * 接到队尾，再等待 previous，能保证几乎同时到达的请求不会同时越过等待点。finally 必须释放
   * 锁，即使业务操作抛错也不能让后续请求永远卡住。
   */
  async function runStoryExclusive<T>(storyId: string, operation: () => Promise<T>): Promise<T> {
    createStoryPaths(dataDir, storyId)
    const previous = storyQueues.get(storyId) ?? Promise.resolve()
    let releaseCurrent: (() => void) | undefined
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    const tail = previous.catch(() => undefined).then(() => current)
    storyQueues.set(storyId, tail)

    await previous.catch(() => undefined)

    try {
      return await operation()
    } finally {
      releaseCurrent?.()
      if (storyQueues.get(storyId) === tail) {
        storyQueues.delete(storyId)
      }
    }
  }

  /**
   * 在调用方已经持有故事锁时读取 revision。
   *
   * @param storyId 要读取版本号的故事 id。
   * @returns 当前非负整数 revision；revision 文件尚不存在时返回 0。
   * @throws 文件存在但结构损坏时抛出 `revision.invalid`。
   *
   * 新故事还没有 revision 文件时按 0 处理；文件存在但内容不是非负整数，说明内部状态损坏，必须
   * 报 500，不能悄悄重置为 0 后允许旧请求覆盖新故事。
   */
  async function readStoryRevisionUnlocked(storyId: string): Promise<number> {
    const { revisionFile } = createStoryStatePaths(dataDir, storyId)

    try {
      const revisionData = await readJson5File<{ revision?: unknown }>(revisionFile)
      if (!Number.isInteger(revisionData.revision) || Number(revisionData.revision) < 0) {
        throw new FileStoreError(
          `Story revision is invalid: ${storyId}`,
          500,
          "revision.invalid"
        )
      }

      return Number(revisionData.revision)
    } catch (error) {
      if (isFileStoreError(error) && error.code === "file-store.not-found") {
        return 0
      }
  
      throw error
    }
  }

  /**
   * 对外安全读取 revision。
   *
   * @param storyId 要读取版本号的故事 id。
   * @returns 恢复未完成事务后的稳定 revision。
   * @throws 故事不存在、事务恢复失败或 revision 损坏时抛错。
   *
   * 即使只是读取，也先进入同一故事队列并恢复未完成事务，确保返回的修订号对应一个已经完成
   * 恢复、可稳定读取的故事状态。
   */
  async function readStoryRevision(storyId: string): Promise<number> {
    return runStoryExclusive(storyId, async () => {
      await ensureStoryExists(dataDir, storyId)
      await recoverStoryTransactions(dataDir, storyId)
      return readStoryRevisionUnlocked(storyId)
    })
  }

  /**
   * 在锁内执行一次带版本检查的故事修改。
   *
   * @param storyId 要修改的故事 id。
   * @param expectedRevision 调用方读取数据时拿到的 revision。
   * @param operation 真正的领域写入操作，只有版本匹配时才会调用。
   * @returns 业务操作结果和提交后递增的新 revision。
   * @throws 版本不一致时抛 409；领域写入或 revision 落盘失败时原样抛错。
   *
   * 顺序不能交换：先恢复旧事务，再读取 revision，再比较 expectedRevision，然后才执行真正写入。
   * operation 成功后 revision 加一；operation 抛错时不会增加 revision。冲突返回 409，让前端重新
   * 加载或提示用户，而不是采用“最后保存的人覆盖前面所有人”的危险策略。
   */
  async function withStoryMutation<T>(
    storyId: string,
    expectedRevision: number,
    operation: () => Promise<T>
  ): Promise<StoryMutationResult<T>> {
    return runStoryExclusive(storyId, async () => {
      await ensureStoryExists(dataDir, storyId)
      await recoverStoryTransactions(dataDir, storyId)
      const currentRevision = await readStoryRevisionUnlocked(storyId)

      if (expectedRevision !== currentRevision) {
        throw new FileStoreError(
          `Story revision conflict: expected ${expectedRevision}, current ${currentRevision}.`,
          409,
          "revision.conflict"
        )
      }

      const value = await operation()
      const revision = currentRevision + 1
      await writeJson5File(createStoryStatePaths(dataDir, storyId).revisionFile, { revision })

      return { value, revision }
    })
  }

  return {
    readStoryRevision,
    readStoryRevisionUnlocked,
    runStoryExclusive,
    withStoryMutation
  }
}
