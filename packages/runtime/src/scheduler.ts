export interface RuntimeSchedulableEvent {
  instance_id: string
  source_id: string
  entry_event_id: string
  due_game_minute: number
  priority: number
  after: string[]
  before: string[]
  seq: number
}

/** @param event 候选依赖事件。 @param dependencyId 配置中的 source 或入口事件 id。 @returns 该事件是否匹配依赖 id。 */
function matchesDependency(event: RuntimeSchedulableEvent, dependencyId: string) {
  const normalizedDependencyId = dependencyId.trim()
  return Boolean(
    normalizedDependencyId
    && (event.source_id === normalizedDependencyId || event.entry_event_id === normalizedDependencyId)
  )
}

/** @param left 待判断事件。 @param right 可能的前置事件。 @returns left 是否必须排在 right 之后。 */
function dependsOn(left: RuntimeSchedulableEvent, right: RuntimeSchedulableEvent) {
  return left.after.some((dependencyId) => matchesDependency(right, dependencyId))
    || right.before.some((dependencyId) => matchesDependency(left, dependencyId))
}

/**
 * 原地排序调度事件：先按到期时间分组，同一时刻再按依赖关系拓扑排序。
 *
 * @param events 待排序数组。 @returns 无返回值；传入数组会被排序结果替换。
 *
 * 每个时间组使用 Kahn 拓扑算法：先计算入度，再不断取出没有前置依赖的节点；同级节点按
 * priority、seq 排序保持确定性。静态校验本应拒绝环，但旧数据若仍含环，剩余节点会按同级规则
 * 放到末尾，避免运行时死循环。
 */
export function sortScheduledEvents<T extends RuntimeSchedulableEvent>(events: T[]): void {
  const byDueMinute = new Map<number, T[]>()
  for (const event of events) {
    const group = byDueMinute.get(event.due_game_minute) ?? []
    group.push(event)
    byDueMinute.set(event.due_game_minute, group)
  }

  const sorted: T[] = []
  const dueMinutes = [...byDueMinute.keys()].sort((left, right) => left - right)
  for (const dueMinute of dueMinutes) {
    const group = byDueMinute.get(dueMinute) ?? []
    const outgoing = new Map<string, Set<string>>()
    const indegree = new Map(group.map((event) => [event.instance_id, 0]))
    const byId = new Map(group.map((event) => [event.instance_id, event]))

    for (const left of group) {
      for (const right of group) {
        if (left.instance_id === right.instance_id || !dependsOn(left, right)) continue
        const targets = outgoing.get(right.instance_id) ?? new Set<string>()
        if (targets.has(left.instance_id)) continue
        targets.add(left.instance_id)
        outgoing.set(right.instance_id, targets)
        indegree.set(left.instance_id, (indegree.get(left.instance_id) ?? 0) + 1)
      }
    }

    /** @param left 左侧同级事件。 @param right 右侧同级事件。 @returns 负数表示 left 应排在前面。 */
    const comparePeers = (left: T, right: T) =>
      left.priority !== right.priority ? left.priority - right.priority : left.seq - right.seq
    const ready = group.filter((event) => indegree.get(event.instance_id) === 0).sort(comparePeers)
    const ordered: T[] = []

    while (ready.length > 0) {
      const current = ready.shift()!
      ordered.push(current)
      for (const targetId of outgoing.get(current.instance_id) ?? []) {
        const nextIndegree = (indegree.get(targetId) ?? 0) - 1
        indegree.set(targetId, nextIndegree)
        if (nextIndegree !== 0) continue
        const target = byId.get(targetId)
        if (target) {
          ready.push(target)
          ready.sort(comparePeers)
        }
      }
    }

    if (ordered.length < group.length) {
      const orderedIds = new Set(ordered.map((event) => event.instance_id))
      ordered.push(...group.filter((event) => !orderedIds.has(event.instance_id)).sort(comparePeers))
    }
    sorted.push(...ordered)
  }

  events.splice(0, events.length, ...sorted)
}
