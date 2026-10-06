import type { Point, Rect, StageArea } from './types'

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function rectContainsPoint(rect: Rect, point: Point, tolerance = 0): boolean {
  return (
    point.x >= rect.x - tolerance &&
    point.x <= rect.x + rect.width + tolerance &&
    point.y >= rect.y - tolerance &&
    point.y <= rect.height + rect.y + tolerance
  )
}

/** 区域的演员禁入范围 = 物理占用外扩安全间隔。 */
export function forbiddenRect(area: StageArea): Rect {
  const c = area.clearance
  return {
    x: Math.max(0, area.bounds.x - c),
    y: Math.max(0, area.bounds.y - c),
    width: Math.min(100, area.bounds.x + area.bounds.width + c) - Math.max(0, area.bounds.x - c),
    height: Math.min(100, area.bounds.y + area.bounds.height + c) - Math.max(0, area.bounds.y - c),
  }
}

/**
 * 线段与轴对齐矩形求交，返回 t∈[0,1] 区间；不相交返回 null。
 * 落在边界上也算相交（安全间隔边界不可压）。
 */
function segmentRectRange(a: Point, b: Point, rect: Rect): [number, number] | null {
  let tMin = 0
  let tMax = 1
  const dx = b.x - a.x
  const dy = b.y - a.y

  const axes: Array<[number, number, number, number]> = [
    [a.x, dx, rect.x, rect.x + rect.width],
    [a.y, dy, rect.y, rect.y + rect.height],
  ]

  for (const [origin, delta, low, high] of axes) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < low || origin > high) return null
    } else {
      let t1 = (low - origin) / delta
      let t2 = (high - origin) / delta
      if (t1 > t2) [t1, t2] = [t2, t1]
      tMin = Math.max(tMin, t1)
      tMax = Math.min(tMax, t2)
      if (tMin > tMax) return null
    }
  }
  return [tMin, tMax]
}

export type SegmentAreaHit = { area: StageArea; t: number }

/** 返回线段 a→b 最先进入的区域（含安全间隔），未命中返回 null。 */
export function segmentHitsArea(a: Point, b: Point, area: StageArea): number | null {
  const range = segmentRectRange(a, b, forbiddenRect(area))
  if (!range) return null
  // 起终点恰好停在区域内时，视为从 0 起就冲突
  return range[0] <= 1 && range[1] >= 0 ? Math.max(0, range[0]) : null
}

/** 两条线段求交，返回交点；共线或不相交返回 null。 */
export function segmentIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const r = { x: p2.x - p1.x, y: p2.y - p1.y }
  const s = { x: p4.x - p3.x, y: p4.y - p3.y }
  const denominator = r.x * s.y - r.y * s.x
  if (Math.abs(denominator) < 1e-9) return null
  const qp = { x: p3.x - p1.x, y: p3.y - p1.y }
  const t = (qp.x * s.y - qp.y * s.x) / denominator
  const u = (qp.x * r.y - qp.y * r.x) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: p1.x + t * r.x, y: p1.y + t * r.y }
}

export function polylineSegments(points: Point[]): Array<[Point, Point]> {
  const result: Array<[Point, Point]> = []
  for (let i = 0; i < points.length - 1; i += 1) {
    result.push([points[i], points[i + 1]])
  }
  return result
}

/** 线段中点到某点的距离比例排序辅助：沿折线累计长度比例。 */
export function pathLength(points: Point[]): number {
  return polylineSegments(points).reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0)
}
