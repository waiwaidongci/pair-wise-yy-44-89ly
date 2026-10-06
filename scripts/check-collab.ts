import { AreaCollabServer } from '../src/spatial/collab'
import { seedAreas } from '../src/stores/workshop'
import type { StageArea } from '../src/spatial/types'

let failures = 0
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    console.error(`  ✗ ${message}`)
    failures += 1
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

// 场景 1：两人同时改同一块区域，先到者持锁生效
console.log('先到先得锁：')
{
  const server = new AreaCollabServer()
  server.seed(clone(seedAreas))
  const base = server.get('A-01')!
  assert(server.acquireLock('A-01', '舞美·赵珂'), '赵珂先抢到 A-01 的锁')
  assert(!server.acquireLock('A-01', '舞台监督·陈曦'), '陈曦同时来改 → 拿不到锁')

  const chenNext: StageArea = { ...clone(base), clearance: 9, updatedBy: '陈曦' }
  const rejected = server.commit(clone(base), chenNext, '舞台监督·陈曦')
  assert(!rejected.ok && rejected.reason === 'locked', '陈曦提交被拒（先到者生效）')

  const zhaoNext = { ...clone(base), bounds: { ...base.bounds, x: 33 }, updatedBy: '舞美·赵珂' }
  const accepted = server.commit(clone(base), zhaoNext, '舞美·赵珂')
  assert(accepted.ok && accepted.area.bounds.x === 33, '赵珂提交成功')
  assert(accepted.area.revision === base.revision + 1, '服务器版本号 +1')
  assert(!server.lockOf('A-01'), '提交成功后锁自动释放')
}

// 场景 2：离线改动回网，按区域编号三方合并
console.log('离线三方合并：')
{
  const server = new AreaCollabServer()
  server.seed(clone(seedAreas))
  const base = server.get('A-02')!

  // 陈曦离线期间改了 clearance（她手里的 base 是旧版）
  const offlineNext: StageArea = { ...clone(base), clearance: 8, updatedBy: '陈曦（离线）' }

  // 赵珂在线先改了 name（先到者），并提交，服务器 revision 前进
  const zhaoNext = { ...clone(base), name: '灯塔基座（加高）', updatedBy: '赵珂' }
  server.acquireLock('A-02', '赵珂')
  server.commit(clone(base), zhaoNext, '赵珂')

  // 陈曦回网合并：字段不重叠 → 两边都保留
  const r1 = server.mergePending({ base: clone(base), next: offlineNext, author: '陈曦' })
  assert(r1.area.name === '灯塔基座（加高）', '服务器先改的名称保留（先到者）')
  assert(r1.area.clearance === 8, '本地离线改的安全间隔合并生效')
  assert(r1.conflicts.length === 0, '改的字段不重叠 → 无冲突')
}

// 场景 3：两边改同一字段 → 先到者（服务器）生效，本地值丢弃
console.log('同字段冲突：')
{
  const server = new AreaCollabServer()
  server.seed(clone(seedAreas))
  const base = server.get('A-03')!

  const zhaoNext = { ...clone(base), clearance: 1, updatedBy: '赵珂' }
  server.acquireLock('A-03', '赵珂')
  server.commit(clone(base), zhaoNext, '赵珂')

  const chenNext = { ...clone(base), clearance: 7, note: '离线时我也改了间隔', updatedBy: '陈曦' }
  const r = server.mergePending({ base: clone(base), next: chenNext, author: '陈曦' })
  assert(r.area.clearance === 1, '同字段冲突 → 先提交的赵珂值（1）生效，本地 7 被丢弃')
  assert(r.conflicts.some((c) => c.field === 'clearance'), '冲突清单明确指出是 clearance 字段')
  assert(r.area.note === '离线时我也改了间隔', '不重叠的 note 字段照常合并')
}

// 场景 4：离线新建区域，回网按编号登记
console.log('离线新区域：')
{
  const server = new AreaCollabServer()
  server.seed(clone(seedAreas))
  const draft: StageArea = {
    id: 'A-99',
    name: '离线新画的舷梯',
    kind: '布景',
    bounds: { x: 80, y: 10, width: 8, height: 8 },
    clearance: 2,
    timeWindow: null,
    note: '',
    updatedAt: '',
    updatedBy: '陈曦（离线）',
    revision: 1,
  }
  const r = server.mergePending({ base: clone(draft), next: clone(draft), author: '陈曦' })
  assert(!!server.get('A-99'), '离线新建区域回网后按编号 A-99 登记')
  assert(r.conflicts.length === 0, '无冲突')
}

console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)
