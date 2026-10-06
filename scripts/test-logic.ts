import { planRoute, routesCross, timeWindowsOverlap, pointsEqual, type Point, type Rect, type PlannerObstacle } from '../src/staging/geometry'

// ---- 复制 store 中的纯逻辑进行验证 ----
type Area = { id: string; name: string; rect: Rect; clearance: number }
type Issue = { type: string; segment?: number; areaId?: string; areaName?: string; otherCueId?: string; point?: Point; detail: string }
type Cue = {
  id: string; scene: string; time: string; duration: number
  entry: Point; exit: Point; route: Point[]
  routeState?: string; routeIssues?: Issue[]; routeInfo?: string[]
}

const seedAreas: Area[] = [
  { id: 'A-01', name: '码头箱', rect: { x: 24, y: 50, w: 18, h: 14 }, clearance: 3 },
  { id: 'A-02', name: '升降台', rect: { x: 43, y: 37, w: 12, h: 14 }, clearance: 3 },
  { id: 'A-03', name: '救生艇', rect: { x: 76, y: 44, w: 12, h: 12 }, clearance: 3 },
]

const seedCues: Cue[] = [
  { id: 'C-01', scene: '启航前夜', time: '00:04:20', duration: 95, entry: { x: 10, y: 70 }, exit: { x: 64, y: 38 }, route: [] },
  { id: 'C-02', scene: '启航前夜', time: '00:06:10', duration: 40, entry: { x: 28, y: 30 }, exit: { x: 62, y: 56 }, route: [] },
  { id: 'C-03', scene: '风暴', time: '00:21:35', duration: 120, entry: { x: 72, y: 82 }, exit: { x: 42, y: 46 }, route: [] },
  { id: 'C-04', scene: '风暴', time: '00:23:05', duration: 18, entry: { x: 50, y: 12 }, exit: { x: 50, y: 12 }, route: [{ x: 50, y: 12 }], routeState: 'legacy', routeIssues: [{ type: 'legacy', detail: '旧提示' }] },
  { id: 'C-05', scene: '守望', time: '00:37:42', duration: 70, entry: { x: 18, y: 82 }, exit: { x: 82, y: 18 }, route: [] },
  { id: 'C-06', scene: '守望', time: '00:38:20', duration: 50, entry: { x: 88, y: 64 }, exit: { x: 64, y: 30 }, route: [] },
]

function obstaclesOf(areas: Area[]): PlannerObstacle[] {
  return areas.map((a) => ({ id: a.id, name: a.name, rect: a.rect, clearance: a.clearance }))
}

function replanCue(cue: Cue, areas: Area[]): Cue {
  const result = planRoute(cue.entry, cue.exit, obstaclesOf(areas))
  if (result.path) {
    const changed = result.path.length !== cue.route.length || result.path.some((p, i) => !pointsEqual(p, cue.route[i] ?? { x: -1, y: -1 }))
    return { ...cue, route: result.path, routeState: changed ? 'adjusted' : 'clear', routeIssues: [], routeInfo: result.avoided }
  }
  return { ...cue, routeState: 'blocked', routeIssues: result.blocked.map((b) => ({ type: 'blocked', segment: b.segment, areaId: b.obstacleId, areaName: b.obstacleName, detail: b.reason })), routeInfo: [] }
}

function detectCrossings(cues: Cue[]): Cue[] {
  const next = cues.map((c) => ({ ...c, routeIssues: (c.routeIssues ?? []).filter((i) => i.type !== 'crossing') }))
  for (let i = 0; i < next.length; i++) {
    for (let j = i + 1; j < next.length; j++) {
      const a = next[i], b = next[j]
      if (a.scene !== b.scene) continue
      if (!timeWindowsOverlap(a.time, a.duration, b.time, b.duration)) continue
      if (a.route.length < 2 || b.route.length < 2) continue
      const hit = routesCross(a.route, b.route)
      if (!hit) continue
      const point = { x: Number(hit.x.toFixed(1)), y: Number(hit.y.toFixed(1)) }
      a.routeIssues!.push({ type: 'crossing', otherCueId: b.id, point, detail: `与 ${b.id} 交叉于 (${point.x}, ${point.y})` })
      b.routeIssues!.push({ type: 'crossing', otherCueId: a.id, point, detail: `与 ${a.id} 交叉于 (${point.x}, ${point.y})` })
    }
  }
  return next
}

function routeStatusOf(cue: Cue): string {
  if (cue.routeState === 'blocked') return 'blocked'
  if (cue.routeState === 'legacy') return 'legacy'
  if (cue.routeIssues?.some((i) => i.type === 'crossing')) return 'crossing'
  return cue.routeState ?? 'legacy'
}

// ---- 测试 1：种子状态 ----
console.log('== 测试 1：种子路线规划 ==')
let cues = seedCues.map((c) => (c.routeState === 'legacy' ? c : replanCue(c, seedAreas)))
cues = detectCrossings(cues)
for (const c of cues) {
  console.log(c.id, routeStatusOf(c), '| 绕过:', c.routeInfo?.join('、') || '-', '| 问题:', c.routeIssues?.map((i) => i.detail).join('；') || '-')
}

// 断言
const status = Object.fromEntries(cues.map((c) => [c.id, routeStatusOf(c)]))
console.assert(status['C-01'] === 'adjusted', 'C-01 应绕行')
console.assert(status['C-02'] === 'adjusted', 'C-02 应绕行')
console.assert(status['C-03'] === 'blocked', 'C-03 应无法绕行')
console.assert(status['C-04'] === 'legacy', 'C-04 应待复核')
console.assert(status['C-05'] === 'crossing', 'C-05 应交叉')
console.assert(status['C-06'] === 'crossing', 'C-06 应交叉')
console.assert(cues.find((c) => c.id === 'C-03')!.routeIssues!.some((i) => i.areaName === '升降台'), 'C-03 问题应指明升降台')
console.assert(cues.find((c) => c.id === 'C-04')!.route.length === 1, 'C-04 原路线应保留')

// ---- 测试 2：范围变更重算 ----
console.log('\n== 测试 2：升降台挪走后重算 ==')
const areasWithoutLift = seedAreas.filter((a) => a.id !== 'A-02')
let cues2 = cues.map((c) => (c.routeState === 'legacy' ? c : replanCue(c, areasWithoutLift)))
cues2 = detectCrossings(cues2)
const status2 = Object.fromEntries(cues2.map((c) => [c.id, routeStatusOf(c)]))
console.log('C-03:', status2['C-03'], '| C-01:', status2['C-01'], '| C-05:', status2['C-05'])
console.assert(status2['C-03'] === 'adjusted' || status2['C-03'] === 'clear', 'C-03 挪走升降台后应可绕行')
console.assert(cues2.find((c) => c.id === 'C-03')!.route[0].x === 72 && cues2.find((c) => c.id === 'C-03')!.route[0].y === 82, 'C-03 入场点不变')
console.assert(cues2.find((c) => c.id === 'C-03')!.route.at(-1)!.x === 42 && cues2.find((c) => c.id === 'C-03')!.route.at(-1)!.y === 46, 'C-03 退场点不变')

// ---- 测试 3：旧提示复核 ----
console.log('\n== 测试 3：旧提示复核 ==')
const reviewed = replanCue({ ...cues.find((c) => c.id === 'C-04')!, routeState: 'clear' }, seedAreas)
console.log('C-04 复核后:', reviewed.routeState, reviewed.routeInfo)
console.assert(reviewed.routeState === 'clear', 'C-04 复核后应正常（单点无冲突）')

// ---- 测试 4：安全间隔调大导致无法绕行 ----
console.log('\n== 测试 4：安全间隔调大 ==')
const bigClearance = seedAreas.map((a) => (a.id === 'A-03' ? { ...a, clearance: 12 } : a))
let cues3 = cues.map((c) => (c.routeState === 'legacy' ? c : replanCue(c, bigClearance)))
cues3 = detectCrossings(cues3)
const c06 = cues3.find((c) => c.id === 'C-06')!
console.log('C-06:', routeStatusOf(c06), c06.routeIssues?.map((i) => i.detail).join('；'))
console.assert(routeStatusOf(c06) === 'blocked', 'C-06 安全间隔过大应无法绕行')

console.log('\n全部断言完成')
