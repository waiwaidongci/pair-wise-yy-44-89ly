import type { CueKind, CrossingMark, Point, RouteIssue, StageArea } from './types'
import { polylineSegments, segmentHitsArea, segmentIntersection } from './geometry'
import { cueInterval, intervalsOverlap, overlapSeconds, windowInterval } from './time'
import { reroutePath } from './pathfind'

/** 校验所需的最小提示形状（store 中的 Cue 是它的超集）。 */
export type SpatialCue = {
  id: string
  title: string
  time: string
  duration: number
  route: Point[]
  kind: CueKind
  /** 是否已经登记过范围数据；旧提示为 false 时保留原路线并标记待复核。 */
  spatialVerified: boolean
}

export type SpatialReport = {
  status: 'ok' | 'rerouted' | 'blocked' | 'review' | 'fixed'
  /** 舞台平面与打印清单实际使用的路线 */
  effectiveRoute: Point[]
  issues: RouteIssue[]
  /** 本次重算实际生效的区域（时间窗内） */
  activeAreaIds: string[]
}

function isActor(cue: SpatialCue): boolean {
  return cue.kind === '演员走位'
}

function areaActiveFor(area: StageArea, cue: SpatialCue): boolean {
  if (!area.timeWindow) return true
  const cueWindow = cueInterval(cue.time, cue.duration)
  const areaWindow = windowInterval(area.timeWindow)
  if (!cueWindow || !areaWindow) return true // 时间码异常时按整场占用保守处理
  return intervalsOverlap(cueWindow, areaWindow)
}

/** 找原路线各段穿过的区域；入场点 / 退场点本身落在边界内不算（门位不动）。 */
function findBlocking(cue: SpatialCue, areas: StageArea[]): RouteIssue[] {
  const issues: RouteIssue[] = []
  const segments = polylineSegments(cue.route)
  segments.forEach(([a, b], index) => {
    let first: { t: number; area: StageArea } | null = null
    for (const area of areas) {
      const t = segmentHitsArea(a, b, area)
      if (t !== null && (!first || t < first.t)) first = { t, area }
    }
    if (first) {
      issues.push({
        type: 'blocking',
        severity: 'blocked',
        segmentIndex: index + 1,
        areaId: first.area.id,
        areaName: first.area.name,
        message: `第 ${index + 1} 段路线（${index + 1}→${index + 2} 号点）穿过「${first.area.name}」${first.area.kind}的占用范围（含 ${first.area.clearance} 格安全间隔）`,
      })
    }
  })
  return issues
}

function timeOverlap(a: SpatialCue, b: SpatialCue): number | null {
  const wa = cueInterval(a.time, a.duration)
  const wb = cueInterval(b.time, b.duration)
  if (!wa || !wb || !intervalsOverlap(wa, wb)) return null
  return overlapSeconds(wa, wb)
}

/** 在给定路线（实际生效路线）上找同一时段交叉。 */
function findCrossings(
  cues: SpatialCue[],
  routes: Record<string, Point[]>,
): { issues: Map<string, RouteIssue[]>; marks: CrossingMark[] } {
  const issues = new Map<string, RouteIssue[]>()
  const marks: CrossingMark[] = []
  const actors = cues.filter(isActor)
  for (let i = 0; i < actors.length; i += 1) {
    for (let j = i + 1; j < actors.length; j += 1) {
      const a = actors[i]
      const b = actors[j]
      const overlap = timeOverlap(a, b)
      if (overlap === null) continue
      const segmentsA = polylineSegments(routes[a.id] ?? a.route)
      const segmentsB = polylineSegments(routes[b.id] ?? b.route)
      let hit: Point | null = null
      outer: for (const [p1, p2] of segmentsA) {
        for (const [p3, p4] of segmentsB) {
          const point = segmentIntersection(p1, p2, p3, p4)
          if (point) {
            hit = point
            break outer
          }
        }
      }
      if (!hit) continue
      marks.push({ cueId: a.id, otherCueId: b.id, point: hit })
      const makeIssue = (self: SpatialCue, other: SpatialCue): RouteIssue => ({
        type: 'crossing',
        severity: 'blocked',
        otherCueId: other.id,
        otherCueTitle: other.title,
        overlapSeconds: overlap,
        message: `与「${other.id} · ${other.title}」在同一时段（重叠 ${overlap} 秒）路线交叉，交叉点约 (${Math.round(
          hit!.x,
        )}, ${Math.round(hit!.y)})；布景绕障已重算，需错开触发时间或调整中间节点`,
      })
      issues.set(a.id, [...(issues.get(a.id) ?? []), makeIssue(a, b)])
      issues.set(b.id, [...(issues.get(b.id) ?? []), makeIssue(b, a)])
    }
  }
  return { issues, marks }
}

export type ValidationResult = {
  reports: Record<string, SpatialReport>
  marks: CrossingMark[]
  /** 空间状态有问题的提示 id（供打印清单统一标红） */
  problemCueIds: string[]
}

/**
 * 所有空间事实的唯一入口：舞台平面、提示面板、打印清单都读这份结果。
 * 范围一变（areas 变化）整个结果随之重算。
 */
export function validateSpatial(allCues: SpatialCue[], areas: StageArea[]): ValidationResult {
  // 第一遍：按区域占用决定每条演员走位的实际生效路线（入/退场不动，只换中间节点）。
  const draft: Record<string, { status: SpatialReport['status']; effectiveRoute: Point[]; issues: RouteIssue[]; activeAreaIds: string[] }> = {}

  for (const cue of allCues) {
    const activeAreas = areas.filter((area) => areaActiveFor(area, cue))
    const activeAreaIds = activeAreas.map((area) => area.id)

    if (!isActor(cue)) {
      draft[cue.id] = { status: 'fixed', effectiveRoute: cue.route, issues: [], activeAreaIds }
      continue
    }

    if (!cue.spatialVerified) {
      // 旧提示缺范围数据：原路线原样保留，只标记待复核，不擅自改线。
      const blocking = findBlocking(cue, activeAreas)
      draft[cue.id] = {
        status: 'review',
        effectiveRoute: cue.route,
        issues: [
          {
            type: 'blocking',
            severity: 'review',
            message: blocking.length
              ? `旧提示缺范围数据，保留原路线待复核；复核前检测到 ${blocking.length} 处与布景/机械区冲突`
              : '旧提示缺范围数据，保留原路线待复核',
          },
          ...blocking,
        ],
        activeAreaIds,
      }
      continue
    }

    const blocking = findBlocking(cue, activeAreas)
    if (blocking.length === 0) {
      draft[cue.id] = { status: 'ok', effectiveRoute: cue.route, issues: [], activeAreaIds }
      continue
    }

    const entry = cue.route[0]
    const exit = cue.route[cue.route.length - 1]
    const rerouted = entry && exit ? reroutePath(entry, exit, activeAreas) : { found: false as const }
    if (rerouted.found) {
      draft[cue.id] = { status: 'rerouted', effectiveRoute: rerouted.path, issues: blocking, activeAreaIds }
    } else {
      const names = [...new Set(blocking.map((item) => item.areaName).filter(Boolean))].join('、')
      draft[cue.id] = {
        status: 'blocked',
        effectiveRoute: cue.route,
        issues: [
          ...blocking,
          {
            type: 'blocking',
            severity: 'blocked',
            message: `排不出来：入场点 (${entry?.x},${entry?.y}) 与退场点 (${exit?.x},${exit?.y}) 之间被「${names}」的安全间隔完全隔开，需先挪布景或改门位`,
          },
        ],
        activeAreaIds,
      }
    }
  }

  // 第二遍：在实际生效路线上检查同一时段交叉（绕障后出现的新交叉也能抓到）。
  const effectiveRoutes: Record<string, Point[]> = {}
  for (const cue of allCues) effectiveRoutes[cue.id] = draft[cue.id].effectiveRoute
  const crossing = findCrossings(allCues, effectiveRoutes)

  const reports: Record<string, SpatialReport> = {}
  const problemCueIds: string[] = []
  for (const cue of allCues) {
    const base = draft[cue.id]
    const crossingIssues = isActor(cue) ? crossing.issues.get(cue.id) ?? [] : []
    let { status } = base
    if (crossingIssues.length && (status === 'ok' || status === 'rerouted')) status = 'blocked'
    const issues = [...base.issues, ...crossingIssues]
    reports[cue.id] = { status, effectiveRoute: base.effectiveRoute, issues, activeAreaIds: base.activeAreaIds }
    if (status === 'blocked' || status === 'review') problemCueIds.push(cue.id)
  }

  return { reports, marks: crossing.marks, problemCueIds: [...new Set(problemCueIds)] }
}
