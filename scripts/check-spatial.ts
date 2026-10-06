import { validateSpatial, type SpatialCue } from '../src/spatial/validate'
import { reroutePath } from '../src/spatial/pathfind'
import { seedAreas, seedCues } from '../src/stores/workshop'
import type { StageArea } from '../src/spatial/types'

let failures = 0
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    console.error(`  ✗ ${message}`)
    failures += 1
  }
}

// 1. 种子数据：C-01 撞码头箱组应被绕行；C-02 旧路线保留待复核；C-05/C-06 同时段交叉
const result = validateSpatial(seedCues as SpatialCue[], seedAreas)
console.log('种子场景：')
for (const cue of seedCues) {
  const report = result.reports[cue.id]
  console.log(`  ${cue.id} [${cue.kind}] => ${report.status}, issues=${report.issues.length}, nodes=${report.effectiveRoute.length}`)
}
assert(result.reports['C-01'].status === 'rerouted', 'C-01 穿过码头箱组 → 自动绕行（入/退场不动）')
assert(
  JSON.stringify(result.reports['C-01'].effectiveRoute[0]) === JSON.stringify(seedCues[0].route[0]) &&
    JSON.stringify(result.reports['C-01'].effectiveRoute.at(-1)) === JSON.stringify(seedCues[0].route.at(-1)),
  'C-01 入场点/退场点保持不动，只改中间节点',
)
assert(result.reports['C-02'].status === 'review', 'C-02 缺范围数据 → 保留原路线并标记待复核')
assert(
  JSON.stringify(result.reports['C-02'].effectiveRoute) === JSON.stringify(seedCues[1].route),
  'C-02 待复核期间原路线原样保留',
)
assert(result.reports['C-03'].status === 'fixed' && result.reports['C-04'].status === 'fixed', 'C-03/C-04 非演员走位 → fixed')
assert(result.reports['C-05'].status === 'blocked' && result.reports['C-06'].status === 'blocked', 'C-05/C-06 同时段交叉 → blocked')
assert(
  result.reports['C-05'].issues.some((i) => i.type === 'crossing' && i.otherCueId === 'C-06'),
  '冲突说明指出“哪段路线跟谁打架”（C-05 ← C-06）',
)
assert(result.marks.length >= 1, '平面图能拿到交叉点坐标')

// 绕行后路线不能再进任何区域的安全间隔
import('../src/spatial/geometry').then(({ segmentHitsArea }) => {
  const r1 = result.reports['C-01']
  const hit = seedAreas.some((area) => {
    if (!area.timeWindow) return r1.effectiveRoute.some((_, idx) => idx < r1.effectiveRoute.length - 1 && segmentHitsArea(r1.effectiveRoute[idx], r1.effectiveRoute[idx + 1], area) !== null)
    return false
  })
  assert(!hit, 'C-01 绕行后路线不压任何整场区域的安全间隔')
})

// 2. 范围一变即重算：把码头箱组挪到角落，C-01 应变畅通
console.log('范围变更：')
const moved = structuredClone(seedAreas)
moved[0] = { ...moved[0], bounds: { x: 0, y: 0, width: 8, height: 8 }, revision: 5 }
const result2 = validateSpatial(seedCues as SpatialCue[], moved)
assert(result2.reports['C-01'].status === 'ok', '码头箱组挪开后 C-01 恢复畅通')

// 3. 排不出来：三面布景 + 台边把入口围成死胡同
console.log('死路场景：')
const wallAreas: StageArea[] = [
  { id: 'X-1', name: '封死顶墙', kind: '布景', bounds: { x: 0, y: 42, width: 16, height: 2 }, clearance: 0, timeWindow: null, note: '', updatedAt: '', updatedBy: '', revision: 1 },
  { id: 'X-2', name: '封死底墙', kind: '布景', bounds: { x: 0, y: 56, width: 16, height: 2 }, clearance: 0, timeWindow: null, note: '', updatedAt: '', updatedBy: '', revision: 1 },
  { id: 'X-3', name: '封死侧墙', kind: '布景', bounds: { x: 14, y: 42, width: 2, height: 16 }, clearance: 0, timeWindow: null, note: '', updatedAt: '', updatedBy: '', revision: 1 },
  { id: 'X-4', name: '封死左墙', kind: '布景', bounds: { x: 0, y: 42, width: 2, height: 16 }, clearance: 0, timeWindow: null, note: '', updatedAt: '', updatedBy: '', revision: 1 },
]
const trapped: SpatialCue = {
  id: 'T-1',
  title: '死路走位',
  time: '00:01:00',
  duration: 10,
  kind: '演员走位',
  spatialVerified: true,
  route: [
    { x: 5, y: 50 },
    { x: 95, y: 50 },
  ],
}
const result3 = validateSpatial([trapped], wallAreas)
assert(result3.reports['T-1'].status === 'blocked', '入口被布景与台边围成死胡同 → blocked')
assert(/封死/.test(result3.reports['T-1'].issues.at(-1)!.message), '排不出来时说明跟哪块布景打架')

// 4. 时间窗：机械区只在窗口内挡路
console.log('时间窗场景：')
const lift = seedAreas.find((a) => a.id === 'A-03')!
const crossingCue: SpatialCue = {
  id: 'T-2',
  title: '穿过升降台',
  time: '00:21:40',
  duration: 30,
  kind: '演员走位',
  spatialVerified: true,
  route: [
    { x: 50, y: 90 },
    { x: 70, y: 70 },
  ],
}
const during = validateSpatial([crossingCue], [lift])
assert(during.reports['T-2'].status === 'rerouted', '窗口内穿过升降台 → 绕行')
const outside = validateSpatial([{ ...crossingCue, time: '00:30:00' }], [lift])
assert(outside.reports['T-2'].status === 'ok', '窗口外升降台不挡路 → 畅通')

// 5. 路径规划：直线不挡时不应改线
console.log('直连场景：')
const direct = reroutePath({ x: 40, y: 80 }, { x: 80, y: 80 }, [])
assert(direct.found && direct.path.length === 2, '无遮挡时中间不产生多余节点')

setTimeout(() => {
  console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
  process.exit(failures ? 1 : 0)
}, 100)
