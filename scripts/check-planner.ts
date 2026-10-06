import { planRoute, routesCross, type Point, type PlannerObstacle } from '../src/staging/geometry'

const obstacles: PlannerObstacle[] = [
  { id: 'A-01', name: '码头箱', rect: { x: 24, y: 50, w: 18, h: 14 }, clearance: 3 },
  { id: 'A-02', name: '升降台', rect: { x: 43, y: 37, w: 12, h: 14 }, clearance: 3 },
  { id: 'A-03', name: '救生艇', rect: { x: 76, y: 44, w: 12, h: 12 }, clearance: 3 },
]

function pathOf(label: string, entry: Point, exit: Point) {
  const r = planRoute(entry, exit, obstacles)
  if (r.path) {
    console.log(label, 'OK  ', r.path.map((p) => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join(' '), '| 绕过:', r.avoided.join('、') || '无')
    return r.path
  }
  console.log(label, 'BLOCKED', r.blocked.map((b) => b.reason).join('；'))
  return null
}

const r5 = pathOf('C-05', { x: 18, y: 82 }, { x: 82, y: 18 })
for (const [i, ex] of [
  { x: 64, y: 30 },
  { x: 66, y: 34 },
  { x: 60, y: 28 },
  { x: 70, y: 36 },
].entries()) {
  const r6 = pathOf(`C-06 variant ${i} -> (${ex.x},${ex.y})`, { x: 88, y: 64 }, ex)
  if (r5 && r6) {
    const hit = routesCross(r5, r6)
    console.log('   crossing:', hit ? `at ${hit.x.toFixed(1)},${hit.y.toFixed(1)}` : 'none')
  }
}
