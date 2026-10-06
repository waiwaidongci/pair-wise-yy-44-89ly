import type { StageArea } from '../spatial/types'

/**
 * 协同规则（舞台布置专用，按“区域编号”为粒度）：
 * 1. 两人同时修改同一块区域：先取得锁的人生效，后来者提交被拒（first-writer-wins）；
 * 2. 离线期间拿不到锁也能改，提交进入待同步队列；回网后按区域编号与服务器做三方合并：
 *    - 服务器没变（base===server）：本地直接生效；
 *    - 服务器变了但两边改的字段不重叠：字段级合并；
 *    - 改了同一字段：先到者（服务器版本）生效，本地同字段丢弃并登记冲突。
 */

export type CommitResult =
  | { ok: true; area: StageArea }
  | { ok: false; reason: 'locked'; lockHolder: string; server: StageArea }
  | { ok: false; reason: 'stale'; server: StageArea; conflicts: string[] }

type Lock = { areaId: string; holder: string; acquiredAt: number }
type PendingChange = { base: StageArea; next: StageArea; author: string }

export const MERGE_FIELDS = ['name', 'kind', 'bounds', 'clearance', 'timeWindow', 'note'] as const
type MergeField = (typeof MERGE_FIELDS)[number]

function shallowEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 模拟服务器状态；单页演示里它就是“另一个人连得到的那份事实”。 */
export class AreaCollabServer {
  private areas = new Map<string, StageArea>()
  private locks = new Map<string, Lock>()

  seed(areas: StageArea[]) {
    this.areas = new Map(areas.map((area) => [area.id, structuredClone(area)]))
    this.locks.clear()
  }

  list(): StageArea[] {
    return [...this.areas.values()].map((area) => structuredClone(area))
  }

  get(areaId: string): StageArea | undefined {
    const area = this.areas.get(areaId)
    return area ? structuredClone(area) : undefined
  }

  lockOf(areaId: string): Lock | undefined {
    return this.locks.get(areaId)
  }

  acquireLock(areaId: string, holder: string): boolean {
    const existing = this.locks.get(areaId)
    if (existing && existing.holder !== holder) return false
    this.locks.set(areaId, { areaId, holder, acquiredAt: Date.now() })
    return true
  }

  releaseLock(areaId: string, holder: string) {
    const existing = this.locks.get(areaId)
    if (existing && existing.holder === holder) this.locks.delete(areaId)
  }

  releaseAll(holder: string) {
    for (const [id, lock] of this.locks) {
      if (lock.holder === holder) this.locks.delete(id)
    }
  }

  /** 在线提交：必须先持锁；提交成功后锁释放，服务器版本号 +1。 */
  commit(base: StageArea, next: StageArea, author: string): CommitResult {
    const server = this.areas.get(next.id)
    const lock = this.locks.get(next.id)
    if (lock && lock.holder !== author) {
      return { ok: false, reason: 'locked', lockHolder: lock.holder, server: structuredClone(server ?? next) }
    }
    if (!server) {
      // 服务器上还没有（其他人新建），按区域编号登记。
      const created = { ...structuredClone(next), revision: 1 }
      this.areas.set(next.id, created)
      this.locks.delete(next.id)
      return { ok: true, area: structuredClone(created) }
    }
    if (server.revision !== base.revision) {
      // 理论上持锁期间服务器不会变；保险起见仍做版本校验。
      return { ok: false, reason: 'stale', server: structuredClone(server), conflicts: [] }
    }
    const saved = { ...structuredClone(next), revision: server.revision + 1 }
    this.areas.set(next.id, saved)
    this.locks.delete(next.id)
    return { ok: true, area: structuredClone(saved) }
  }

  /**
   * 回网合并：对每条离线改动做 base/server/local 三方比较。
   * 返回合并后的区域和字段级冲突（先到者生效的字段）。
   */
  mergePending(change: PendingChange): { area: StageArea; conflicts: Array<{ field: MergeField; serverValue: unknown; localValue: unknown }> } {
    const { base, next } = change
    const server = this.areas.get(next.id)
    if (!server) {
      const created = { ...structuredClone(next), revision: 1 }
      this.areas.set(next.id, created)
      return { area: structuredClone(created), conflicts: [] }
    }

    const conflicts: Array<{ field: MergeField; serverValue: unknown; localValue: unknown }> = []
    const merged: StageArea = structuredClone(server)
    for (const field of MERGE_FIELDS) {
      const localChanged = !shallowEqual(base[field], next[field])
      if (!localChanged) continue
      const serverChanged = !shallowEqual(base[field], server[field])
      if (!serverChanged) {
        // 只有本地改：本地生效
        ;(merged[field] as unknown) = structuredClone(next[field])
      } else if (!shallowEqual(next[field], server[field])) {
        // 两边都改且值不同：先到者（服务器）生效
        conflicts.push({ field, serverValue: server[field], localValue: next[field] })
      }
    }
    merged.updatedAt = conflicts.length ? server.updatedAt : next.updatedAt
    merged.updatedBy = conflicts.length && MERGE_FIELDS.every((f) => !shallowEqual(base[f], next[f])) ? server.updatedBy : next.updatedBy
    if (!shallowEqual(merged, server)) {
      merged.revision = server.revision + 1
      this.areas.set(next.id, merged)
    }
    return { area: structuredClone(merged), conflicts }
  }
}

/** 进程内单例：MSW 与本地状态共用同一个“服务器”。 */
export const areaServer = new AreaCollabServer()
