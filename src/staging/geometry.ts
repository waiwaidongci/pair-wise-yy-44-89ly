/**
 * 舞台空间几何与路线规划。
 *
 * 所有空间事实（布景 / 机械区的占用范围与安全间隔）都收敛到这里的
 * 纯函数：舞台平面图、走位重算、打印清单共用同一份规划结果。
 *
 * 坐标系：舞台平面 100 x 100（与 SVG viewBox 一致）。
 */

export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }

/** 障碍：一块登记了占用范围与演员安全间隔的区域。 */
export type PlannerObstacle = {
  id: string
  name: string
  rect: Rect
  /** 演员安全间隔（舞台单位），规划路线时按此膨胀占用范围。 */
  clearance: number
}

export type BlockedSegment = {
  /** 第几条路线段（0 = 入场点到第一个中间节点）。 */
  segment: number
  obstacleId: string
  obstacleName: string
  reason: string
}

export type PlanResult = {
  /** 规划出的完整路线（含入场点与退场点）；无法绕行时为 null。 */
  path: Point[] | null
  /** 入场 / 退场点本身落在安全范围内，或直线段与障碍冲突。 */
  blocked: BlockedSegment[]
  /** 规划路线实际绕过的障碍名称。 */
  avoided: string[]
}

export const STAGE_MIN = 0.6
export const STAGE_MAX = 99.4

export function clampStage(value: number): number {
  return Math.min(STAGE_MAX, Math.max(STAGE_MIN, value))
}

/** 按安全间隔膨胀占用矩形，并限制在舞台边界内。 */
export function inflateRect(rect: Rect, clearance: number): Rect {
  const x1 = clampStage(rect.x - clearance)
  const y1 = clampStage(rect.y - clearance)
  const x2 = clampStage(rect.x + rect.w + clearance)
  const y2 = clampStage(rect.y + rect.h + clearance)
  return { x: x1, y: y1, w: Math.max(0.1, x2 - x1), h: Math.max(0.1, y2 - y1) }
}

export function pointsEqual(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05
}

/** 点是否在矩形内（含边界）。 */
export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/**
 * 线段 a-b 是否穿过矩形内部。
 * 贴矩形边缘、擦角点行走不算穿过（安全走廊沿边界布置）；
 * 对角穿过矩形内部（即使两端都在边界上）算穿过。
 */
export function segmentCrossesRect(a: Point, b: Point, r: Rect): boolean {
  const pad = 0.002
  const strictlyInside = (p: Point) =>
    p.x > r.x + pad && p.x < r.x + r.w - pad && p.y > r.y + pad && p.y < r.y + r.h - pad
  if (strictlyInside(a) || strictlyInside(b)) return true

  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  if (strictlyInside(mid)) return true

  const corners: Point[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ]
  for (let i = 0; i < corners.length; i += 1) {
    const hit = segmentsIntersect(a, b, corners[i], corners[(i + 1) % corners.length])
    if (!hit) continue
    // 交点落在线段端点：贴角/贴边，允许。
    if (pointsEqual(hit, a) || pointsEqual(hit, b)) continue
    // 交点落在矩形角点但不在线段端点：擦角而过，允许。
    if (corners.some((corner) => pointsEqual(hit, corner))) continue
    return true
  }
  return false
}

/** 两线段是否相交（含端点相接），返回交点；平行或不相交返回 null。 */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): Point | null {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-9) return null
  const qpx = c.x - a.x
  const qpy = c.y - a.y
  const t = (qpx * sy - qpy * sx) / denom
  const u = (qpx * ry - qpy * rx) / denom
  const eps = 1e-6
  if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
    return { x: a.x + t * rx, y: a.y + t * ry }
  }
  return null
}

function inBounds(p: Point): boolean {
  return p.x >= STAGE_MIN - 0.05 && p.x <= STAGE_MAX + 0.05 && p.y >= STAGE_MIN - 0.05 && p.y <= STAGE_MAX + 0.05
}

type GraphNode = {
  p: Point
  kind: 'start' | 'goal' | 'corner'
  obstacleId?: string
}

/**
 * 绕障规划：以入场点、退场点、各膨胀矩形四角为节点构造可见图，
 * A* 求最短绕障路径。入场点与退场点固定，只返回中间节点。
 */
export function planRoute(entry: Point, exit: Point, obstacles: PlannerObstacle[]): PlanResult {
  const inflated = obstacles.map((o) => ({ ...o, inflated: inflateRect(o.rect, o.clearance) }))
  const blocked: BlockedSegment[] = []

  // 入场与退场重合（单点提示）：路线就是该点，检查是否落在安全范围内。
  if (pointsEqual(entry, exit)) {
    for (const o of inflated) {
      if (pointInRect(entry, o.inflated)) {
        blocked.push({ segment: -1, obstacleId: o.id, obstacleName: o.name, reason: '入场点落在安全间隔内' })
      }
    }
    return { path: blocked.length ? null : [{ ...entry }], blocked, avoided: [] }
  }

  // 1. 入场 / 退场点本身就在安全范围内 —— 无法可走。
  for (const o of inflated) {
    if (pointInRect(entry, o.inflated)) {
      blocked.push({ segment: -1, obstacleId: o.id, obstacleName: o.name, reason: '入场点落在安全间隔内' })
    }
    if (pointInRect(exit, o.inflated)) {
      blocked.push({ segment: -2, obstacleId: o.id, obstacleName: o.name, reason: '退场点落在安全间隔内' })
    }
  }

  // 2. 直线段（入 → 出）与障碍的冲突，用于排不出时说明"哪段跟谁打架"。
  for (const o of inflated) {
    if (segmentCrossesRect(entry, exit, o.inflated)) {
      blocked.push({
        segment: 0,
        obstacleId: o.id,
        obstacleName: o.name,
        reason: `第 1 段（入场 → 退场）与 ${o.name} 冲突`,
      })
    }
  }

  if (blocked.length > 0 && blocked.some((b) => b.segment < 0)) {
    return { path: null, blocked, avoided: [] }
  }

  // 3. 构造可见图：起点、终点、各障碍膨胀矩形的四个角。
  const nodes: GraphNode[] = [
    { p: { ...entry }, kind: 'start' },
    { p: { ...exit }, kind: 'goal' },
  ]
  for (const o of inflated) {
    const r = o.inflated
    nodes.push(
      { p: { x: r.x, y: r.y }, kind: 'corner', obstacleId: o.id },
      { p: { x: r.x + r.w, y: r.y }, kind: 'corner', obstacleId: o.id },
      { p: { x: r.x + r.w, y: r.y + r.h }, kind: 'corner', obstacleId: o.id },
      { p: { x: r.x, y: r.y + r.h }, kind: 'corner', obstacleId: o.id },
    )
  }

  const edgeClear = (a: Point, b: Point): boolean => {
    if (!inBounds(a) || !inBounds(b)) return false
    for (const o of inflated) {
      if (segmentCrossesRect(a, b, o.inflated)) return false
    }
    return true
  }

  const goalIndex = 1
  const open = new Map<number, number>()
  const gScore = new Array<number>(nodes.length).fill(Infinity)
  const cameFrom = new Array<number>(nodes.length).fill(-1)
  gScore[0] = 0
  open.set(0, Math.hypot(exit.x - entry.x, exit.y - entry.y))

  while (open.size > 0) {
    let current = -1
    let bestF = Infinity
    for (const [index, f] of open) {
      if (f < bestF) {
        bestF = f
        current = index
      }
    }
    if (current === goalIndex) break
    open.delete(current)

    for (let next = 0; next < nodes.length; next += 1) {
      if (next === current) continue
      if (!edgeClear(nodes[current].p, nodes[next].p)) continue
      const tentative = gScore[current] + Math.hypot(nodes[next].p.x - nodes[current].p.x, nodes[next].p.y - nodes[current].p.y)
      if (tentative < gScore[next]) {
        gScore[next] = tentative
        cameFrom[next] = current
        const h = Math.hypot(exit.x - nodes[next].p.x, exit.y - nodes[next].p.y) + Math.abs(nodes[next].p.x - exit.x) * 0.001
        open.set(next, tentative + h)
      }
    }
  }

  if (cameFrom[goalIndex] < 0) {
    // 4. 绕不出来：返回直线段冲突说明。
    return { path: null, blocked, avoided: [] }
  }

  const middle: Point[] = []
  let cur = goalIndex
  while (cur !== 0 && cur >= 0) {
    const node = nodes[cur]
    if (node.kind === 'corner') middle.push({ ...node.p })
    cur = cameFrom[cur]
  }
  middle.reverse()

  const path = [{ ...entry }, ...middle, { ...exit }]
  const avoided = [...new Set(blocked.filter((b) => b.segment === 0).map((b) => b.obstacleName))]
  return { path, blocked: [], avoided }
}

/** 两条走位路线是否交叉（含端点相接），返回交点。 */
export function routesCross(a: Point[], b: Point[]): Point | null {
  for (let i = 0; i < a.length - 1; i += 1) {
    for (let j = 0; j < b.length - 1; j += 1) {
      const hit = segmentsIntersect(a[i], a[i + 1], b[j], b[j + 1])
      if (hit) return hit
    }
  }
  return null
}

/** 解析 HH:MM:SS 时间码为秒。 */
export function parseTimecode(time: string): number {
  const parts = time.split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  const [h = 0, m = 0, s = 0] = parts
  return h * 3600 + m * 60 + s
}

/** 两条提示的执行时段是否重叠（同一秒内算重叠）。 */
export function timeWindowsOverlap(timeA: string, durationA: number, timeB: string, durationB: number): boolean {
  const a0 = parseTimecode(timeA)
  const b0 = parseTimecode(timeB)
  return a0 < b0 + durationB && b0 < a0 + durationA
}
