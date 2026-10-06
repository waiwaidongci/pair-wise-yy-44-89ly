import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { areaServer, type CommitResult } from '../spatial/collab'
import { validateSpatial, type SpatialCue, type ValidationResult } from '../spatial/validate'
import type { CueKind, Point, StageArea } from '../spatial/types'

export type { Point, StageArea } from '../spatial/types'

export type Department = '舞台' | '灯光' | '音响' | '道具'

export type Comment = {
  id: string
  author: string
  content: string
  createdAt: string
  resolved: boolean
}

export type Cue = {
  id: string
  act: string
  scene: string
  time: string
  title: string
  department: Department
  owner: string
  duration: number
  entry: Point
  exit: Point
  route: Point[]
  note: string
  status: '草稿' | '待确认' | '已确认'
  comments: Comment[]
  /** 演员走位参与绕障与交叉检查；机械动作 / 固定灯位不占演员路线。 */
  kind: CueKind
  /** 旧提示缺范围数据时为 false：保留原路线并标记待复核，不自动改线。 */
  spatialVerified: boolean
}

export const seedProject = {
  name: '潮汐来信',
  venue: '上海大剧院 · 大剧场',
  rehearsalDate: '2026-10-08',
  company: '远岸剧团',
}

export const seedMovers = [
  { id: 'M-01', alias: '林默', role: '父亲', group: '主要演员', color: '#d96b45' },
  { id: 'M-02', alias: '周予', role: '女儿', group: '主要演员', color: '#2f8d88' },
  { id: 'M-03', alias: '顾川', role: '灯塔守望者', group: '主要演员', color: '#4f6fb0' },
  { id: 'M-04', alias: '群演甲组', role: '旅客', group: '群演', color: '#ba8c2f' },
  { id: 'M-05', alias: '群演乙组', role: '码头工人', group: '群演', color: '#735ca8' },
]

/** 布景与机械区登记：每块区域都带物理占用范围和演员安全间隔，是全工作台唯一的空间事实。 */
export const seedAreas: StageArea[] = [
  {
    id: 'A-01',
    name: '码头箱组',
    kind: '布景',
    bounds: { x: 30, y: 52, width: 14, height: 12 },
    clearance: 3,
    timeWindow: null,
    note: '三层木箱固定堆位，整场占用。',
    updatedAt: '2026-09-30 10:12',
    updatedBy: '舞美 · 赵珂',
    revision: 3,
  },
  {
    id: 'A-02',
    name: '灯塔基座',
    kind: '布景',
    bounds: { x: 40, y: 26, width: 12, height: 10 },
    clearance: 2,
    timeWindow: null,
    note: '基座边缘有灯具，演员间隔不少于 2 格。',
    updatedAt: '2026-09-29 16:40',
    updatedBy: '舞美 · 赵珂',
    revision: 2,
  },
  {
    id: 'A-03',
    name: '升降台',
    kind: '机械区',
    bounds: { x: 56, y: 62, width: 18, height: 16 },
    clearance: 4,
    timeWindow: { start: '00:21:00', end: '00:24:30' },
    note: '第二幕风暴段落升降，仅升降窗口内对演员路线生效。',
    updatedAt: '2026-10-01 09:05',
    updatedBy: '舞台机械 · 孙启',
    revision: 4,
  },
  {
    id: 'A-04',
    name: '转台',
    kind: '机械区',
    bounds: { x: 6, y: 6, width: 20, height: 16 },
    clearance: 3,
    timeWindow: { start: '00:36:00', end: '00:42:00' },
    note: '第三幕守望段落转动，当前走位不经过其安全间隔。',
    updatedAt: '2026-10-01 09:20',
    updatedBy: '舞台机械 · 孙启',
    revision: 1,
  },
]

export const seedCues: Cue[] = [
  {
    id: 'C-01',
    act: '第一幕',
    scene: '启航前夜',
    time: '00:04:20',
    title: '林默从左侧门入场',
    department: '舞台',
    owner: '林默 / 周予',
    duration: 95,
    entry: { x: 10, y: 70 },
    exit: { x: 64, y: 38 },
    route: [{ x: 10, y: 70 }, { x: 35, y: 60 }, { x: 64, y: 38 }],
    note: '灯位切换后 2 秒入场，停在码头箱前。',
    status: '已确认',
    comments: [
      { id: 'c1', author: '王灯控', content: '面光需要延长 4 秒，保证转身动作可见。', createdAt: '2026-09-27 14:20', resolved: false },
    ],
    kind: '演员走位',
    spatialVerified: true,
  },
  {
    id: 'C-02',
    act: '第一幕',
    scene: '启航前夜',
    time: '00:06:10',
    title: '信件道具交接',
    department: '道具',
    owner: '周予 / 道具组',
    duration: 40,
    entry: { x: 28, y: 30 },
    exit: { x: 55, y: 47 },
    route: [{ x: 28, y: 30 }, { x: 44, y: 40 }, { x: 55, y: 47 }],
    note: '使用 B 版信封，背台侧完成交接。',
    status: '待确认',
    comments: [],
    // 旧版本留下的走位，建立范围登记前就存在：保留原路线，标记待复核。
    kind: '演员走位',
    spatialVerified: false,
  },
  {
    id: 'C-03',
    act: '第二幕',
    scene: '风暴',
    time: '00:21:35',
    title: '升降台上升 / 码头位移',
    department: '舞台',
    owner: '舞台机械',
    duration: 120,
    entry: { x: 72, y: 82 },
    exit: { x: 42, y: 50 },
    route: [{ x: 72, y: 82 }, { x: 60, y: 70 }, { x: 42, y: 50 }],
    note: '先确认演员离开危险半径，再启动升降台。',
    status: '草稿',
    comments: [],
    kind: '机械动作',
    spatialVerified: true,
  },
  {
    id: 'C-04',
    act: '第二幕',
    scene: '风暴',
    time: '00:23:05',
    title: '爆闪与低频重音',
    department: '灯光',
    owner: '王灯控 / 声场',
    duration: 18,
    entry: { x: 50, y: 12 },
    exit: { x: 50, y: 12 },
    route: [{ x: 50, y: 12 }],
    note: '与机械动作互锁，机械未到位禁止触发。',
    status: '待确认',
    comments: [],
    kind: '固定灯位',
    spatialVerified: true,
  },
  {
    id: 'C-05',
    act: '第三幕',
    scene: '守望',
    time: '00:37:42',
    title: '三人灯塔调度',
    department: '舞台',
    owner: '主要演员组',
    duration: 70,
    entry: { x: 18, y: 82 },
    exit: { x: 82, y: 18 },
    route: [{ x: 18, y: 82 }, { x: 45, y: 66 }, { x: 68, y: 35 }, { x: 82, y: 18 }],
    note: '群演保持第二条对角线，不遮挡主视线。',
    status: '草稿',
    comments: [],
    kind: '演员走位',
    spatialVerified: true,
  },
  {
    id: 'C-06',
    act: '第三幕',
    scene: '守望',
    time: '00:38:10',
    title: '救生艇推入',
    department: '道具',
    owner: '道具组 / 群演乙组',
    duration: 50,
    entry: { x: 88, y: 64 },
    exit: { x: 52, y: 40 },
    route: [{ x: 88, y: 64 }, { x: 80, y: 54 }, { x: 52, y: 40 }],
    note: '与三人灯塔调度在同一时段横穿，需舞台监督确认优先权或错开 10 秒。',
    status: '待确认',
    comments: [],
    kind: '演员走位',
    spatialVerified: true,
  },
]

const STORAGE_KEY = 'stage-scheduler-draft-v2'
const COLLAB_USERS = ['舞台监督 · 陈曦', '舞美 · 赵珂', '舞台机械 · 孙启'] as const
const REMOTE_USER = '舞美 · 赵珂（模拟同事）'

type Persisted = {
  cues?: Cue[]
  areas?: StageArea[]
  revision?: number
  pendingAreaChanges?: Array<{ base: StageArea; next: StageArea; author: string }>
  currentUser?: string
}

/** 兼容旧版本（v1）数据：没有范围登记字段的走位一律保留原路线、标记待复核。 */
function migrateCue(raw: Cue): Cue {
  if (raw.kind && raw.spatialVerified !== undefined) return raw
  const kind: CueKind =
    raw.department === '灯光' || raw.route.length <= 1
      ? '固定灯位'
      : /升降|机械|转台|台车/.test(raw.title)
        ? '机械动作'
        : '演员走位'
  return { ...raw, kind, spatialVerified: false }
}

export const useWorkshopStore = defineStore('workshop', () => {
  const saved = localStorage.getItem(STORAGE_KEY)
  const restored: Persisted | null = saved ? JSON.parse(saved) : null

  const cues = ref<Cue[]>(restored?.cues?.length ? restored.cues.map(restoreCue) : structuredClone(seedCues))
  const areas = ref<StageArea[]>(
    restored?.areas?.length ? structuredClone(restored.areas) : structuredClone(seedAreas),
  )
  const pendingAreaChanges = ref<NonNullable<Persisted['pendingAreaChanges']>>(
    restored?.pendingAreaChanges ?? [],
  )

  // 模拟服务器以本地最新已知区域为基线（回网后合并仍按区域编号对齐 revision）。
  areaServer.seed(areas.value)

  const selectedId = ref('C-01')
  const selectedAreaId = ref<string | null>(null)
  const zoom = ref(100)
  const actFilter = ref('全部')
  const departmentFilter = ref('全部')
  const rev = ref(restored?.revision ?? 12)
  const revision = computed(() => `R${rev.value}`)
  const lastSaved = ref('刚刚自动保存')
  const isOffline = ref(false)
  const locked = ref(false)
  const currentUser = ref(restored?.currentUser ?? COLLAB_USERS[0])
  const users = COLLAB_USERS
  /** 范围变更后给用户的重算说明。 */
  const recomputeNotice = ref('')
  const mergeReport = ref<{ merged: number; conflicts: Array<{ area: string; field: string }> } | null>(null)
  const undoStack = ref<Cue[][]>([])
  const redoStack = ref<Cue[][]>([])

  const selectedCue = computed(() => cues.value.find((cue) => cue.id === selectedId.value) ?? cues.value[0])
  const selectedArea = computed(() => areas.value.find((area) => area.id === selectedAreaId.value) ?? null)
  const filteredCues = computed(() =>
    cues.value.filter(
      (cue) =>
        (actFilter.value === '全部' || cue.act === actFilter.value) &&
        (departmentFilter.value === '全部' || cue.department === departmentFilter.value),
    ),
  )

  /** 唯一空间校验结果：舞台平面、执行提示、打印清单全部读它。 */
  const spatial = computed<ValidationResult>(() =>
    validateSpatial(cues.value as SpatialCue[], areas.value),
  )

  function reportOf(cueId: string) {
    return spatial.value.reports[cueId]
  }

  function effectiveRoute(cueId: string): Point[] {
    return reportOf(cueId)?.effectiveRoute ?? cues.value.find((cue) => cue.id === cueId)?.route ?? []
  }

  function statusOf(cueId: string) {
    return reportOf(cueId)?.status ?? 'ok'
  }

  const spatialProblemCues = computed(() =>
    cues.value.filter((cue) => spatial.value.problemCueIds.includes(cue.id)),
  )

  const pendingAreaIds = computed(() => new Set(pendingAreaChanges.value.map((item) => item.next.id)))

  function areaLockHolder(areaId: string): string | null {
    return areaServer.lockOf(areaId)?.holder ?? null
  }

  // 锁状态变化后给调用方一个显式的响应式刷新时机（锁本身保存在协同服务器单例中）
  const lockVersion = ref(0)
  function touchLocks() {
    lockVersion.value += 1
  }
  void touchLocks

  const timeConflicts = computed(() =>
    cues.value.filter((cue, index) =>
      cues.value.some((other, otherIndex) => otherIndex !== index && other.time === cue.time && other.scene === cue.scene),
    ),
  )
  // 页面上“冲突”概念统一为：时间撞点或空间打架。
  const conflicts = computed(() => {
    const ids = new Set([...spatialProblemCues.value.map((cue) => cue.id), ...timeConflicts.value.map((cue) => cue.id)])
    return cues.value.filter((cue) => ids.has(cue.id))
  })

  watch(
    [cues, areas, rev, isOffline, pendingAreaChanges, currentUser],
    () => {
      const payload: Persisted = {
        cues: cues.value,
        areas: areas.value,
        revision: rev.value,
        pendingAreaChanges: pendingAreaChanges.value,
        currentUser: currentUser.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      lastSaved.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    { deep: true },
  )

  function snapshot() {
    undoStack.value.push(structuredClone(cues.value))
    if (undoStack.value.length > 20) undoStack.value.shift()
    redoStack.value = []
  }

  function updateCue(patch: Partial<Cue>, addRevision = true) {
    if (locked.value) return
    snapshot()
    const index = cues.value.findIndex((cue) => cue.id === selectedId.value)
    if (index < 0) return
    cues.value[index] = { ...cues.value[index], ...patch }
    if (addRevision) rev.value += 1
  }

  function setSpatialVerified(verified: boolean) {
    const cue = selectedCue.value
    if (!cue) return
    snapshot()
    cue.spatialVerified = verified
    rev.value += 1
  }

  /** 中间节点插在入场点与退场点之间；入/退场点本身不动。 */
  function addWaypoint(point: Point) {
    const cue = selectedCue.value
    if (!cue || cue.kind !== '演员走位') return
    snapshot()
    const route = [...cue.route]
    route.splice(Math.max(1, route.length - 1), 0, point)
    cue.route = route
    rev.value += 1
  }

  function addCue() {
    if (locked.value) return
    snapshot()
    const next = cues.value.length + 1
    const cue: Cue = {
      id: `C-${String(next).padStart(2, '0')}`,
      act: '第一幕',
      scene: '新场景',
      time: '00:00:00',
      title: '新执行提示',
      department: '舞台',
      owner: '待指派',
      duration: 30,
      entry: { x: 10, y: 50 },
      exit: { x: 90, y: 50 },
      route: [{ x: 10, y: 50 }, { x: 90, y: 50 }],
      note: '',
      status: '草稿',
      comments: [],
      kind: '演员走位',
      spatialVerified: true,
    }
    cues.value.push(cue)
    selectedId.value = cue.id
    rev.value += 1
  }

  function undo() {
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push(structuredClone(cues.value))
    cues.value = previous
    rev.value += 1
  }

  function redo() {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(structuredClone(cues.value))
    cues.value = next
    rev.value += 1
  }

  function addComment(content: string, author = '当前用户') {
    const cue = selectedCue.value
    if (!cue) return
    snapshot()
    cue.comments.push({
      id: `local-${Date.now()}`,
      author,
      content,
      createdAt: new Date().toLocaleString('zh-CN'),
      resolved: false,
    })
    rev.value += 1
  }

  function toggleComment(commentId: string) {
    const comment = selectedCue.value?.comments.find((item) => item.id === commentId)
    if (comment) comment.resolved = !comment.resolved
  }

  function lockBaseline() {
    locked.value = true
    cues.value.forEach((cue) => {
      cue.status = '已确认'
    })
    rev.value += 1
  }

  function unlockBaseline() {
    locked.value = false
    rev.value += 1
  }

  // ---------- 布景 / 机械区：先到先得锁 + 离线按区域编号合并 ----------

  function stamp(area: Omit<StageArea, 'updatedAt' | 'updatedBy'> & Partial<Pick<StageArea, 'updatedAt' | 'updatedBy'>>, author: string): StageArea {
    return {
      ...area,
      updatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      updatedBy: author,
    }
  }

  function affectedCueSummary(areaId: string): string {
    const affected = cues.value.filter((cue) => spatial.value.reports[cue.id]?.activeAreaIds.includes(areaId))
    if (!affected.length) return ''
    const parts = affected.map((cue) => {
      const status = spatial.value.reports[cue.id]?.status
      const label: Record<string, string> = {
        ok: '仍可通行',
        rerouted: '已自动绕行',
        blocked: '排不出来',
        review: '待复核',
        fixed: '不涉及走位',
      }
      return `${cue.id}（${label[status ?? 'ok']}）`
    })
    return `受影响走位：${parts.join('、')}`
  }

  /** 在线保存区域：先拿区域锁（先到者生效），提交成功立即重算受影响走位。 */
  function saveArea(next: StageArea): { ok: boolean; message: string; holder?: string } {
    const area = stamp(next, currentUser.value)
    if (isOffline.value) {
      const base = areas.value.find((item) => item.id === area.id)
      pendingAreaChanges.value.push({
        base: base ? structuredClone(base) : structuredClone(area),
        next: structuredClone(area),
        author: currentUser.value,
      })
      upsertLocalArea(area)
      rev.value += 1
      return { ok: true, message: `已离线保存「${area.name}」，回网后按区域编号 ${area.id} 合并` }
    }

    const acquired = areaServer.acquireLock(area.id, currentUser.value)
    if (!acquired) {
      const holder = areaServer.lockOf(area.id)?.holder ?? '他人'
      touchLocks()
      return { ok: false, message: `「${area.name}」正被 ${holder} 编辑：两人同时改同一区域，先到者生效`, holder }
    }
    const base = areas.value.find((item) => item.id === area.id)
    const result: CommitResult = areaServer.commit(base ? structuredClone(base) : structuredClone(area), structuredClone(area), currentUser.value)
    touchLocks()
    if (!result.ok) {
      return {
        ok: false,
        message:
          result.reason === 'locked'
            ? `「${area.name}」正被 ${result.lockHolder} 编辑：先到者生效`
            : `「${area.name}」服务器已有新版本，请刷新后重试`,
      }
    }
    upsertLocalArea(result.area)
    rev.value += 1
    const affected = affectedCueSummary(result.area.id)
    recomputeNotice.value = `「${result.area.name}」范围已更新，相关走位已重算。${affected}`.trim()
    return { ok: true, message: recomputeNotice.value }
  }

  function upsertLocalArea(area: StageArea) {
    const index = areas.value.findIndex((item) => item.id === area.id)
    if (index >= 0) areas.value[index] = structuredClone(area)
    else areas.value.push(structuredClone(area))
  }

  /** 新增区域：编号由用户指定（离线回网靠编号合并）。 */
  function addArea(draft: Omit<StageArea, 'updatedAt' | 'updatedBy' | 'revision'>): { ok: boolean; message: string } {
    if (areas.value.some((area) => area.id === draft.id)) {
      return { ok: false, message: `区域编号 ${draft.id} 已存在` }
    }
    // 新登记区域没有 base 版本：服务器若已有同编号区域，回网时全部字段按先到者处理
    const base: StageArea = {
      ...structuredClone(draft),
      revision: 0,
      updatedAt: '',
      updatedBy: '',
    }
    const area = stamp({ ...draft, revision: 1 }, currentUser.value)
    if (isOffline.value) {
      pendingAreaChanges.value.push({ base, next: structuredClone(area), author: currentUser.value })
      upsertLocalArea(area)
      return { ok: true, message: `已离线登记 ${area.id}，回网后按编号合并` }
    }
    areaServer.acquireLock(area.id, currentUser.value)
    const result = areaServer.commit(base, structuredClone(area), currentUser.value)
    touchLocks()
    if (!result.ok) return { ok: false, message: '登记失败：区域编号冲突' }
    upsertLocalArea(result.area)
    selectedAreaId.value = result.area.id
    recomputeNotice.value = `新区域「${result.area.name}」(${result.area.id}) 已登记，相关走位已重算。${affectedCueSummary(result.area.id)}`.trim()
    return { ok: true, message: recomputeNotice.value }
  }

  /** 演示用：让同事抢先锁住某区域。 */
  function simulateOtherLock(areaId: string) {
    areaServer.acquireLock(areaId, REMOTE_USER)
    touchLocks()
  }

  function releaseLock(areaId: string) {
    areaServer.releaseLock(areaId, REMOTE_USER)
    areaServer.releaseLock(areaId, currentUser.value)
    touchLocks()
  }

  /** 演示用：模拟同事在自己的终端挪动布景并提交成功。 */
  function simulateRemoteMove(areaId: string, shift = { dx: 6, dy: -4 }) {
    const serverArea = areaServer.get(areaId)
    if (!serverArea) return { ok: false, message: '区域不存在' }
    const holder = REMOTE_USER
    if (!areaServer.acquireLock(areaId, holder)) {
      return { ok: false, message: `区域被 ${areaServer.lockOf(areaId)?.holder} 锁定中` }
    }
    const next = stamp(
      {
        ...serverArea,
        bounds: {
          ...serverArea.bounds,
          x: Math.max(0, Math.min(100 - serverArea.bounds.width, serverArea.bounds.x + shift.dx)),
          y: Math.max(0, Math.min(100 - serverArea.bounds.height, serverArea.bounds.y + shift.dy)),
        },
      },
      holder,
    )
    const result = areaServer.commit(structuredClone(serverArea), structuredClone(next), holder)
    touchLocks()
    if (!result.ok) return { ok: false, message: '同事的修改提交失败' }
    upsertLocalArea(result.area)
    rev.value += 1
    recomputeNotice.value = `同事 ${holder} 挪动了「${result.area.name}」，本端已拉取新范围并重算走位。${affectedCueSummary(areaId)}`.trim()
    return { ok: true, message: recomputeNotice.value }
  }

  /** 回网：离线改动逐条按区域编号与服务器三方合并；同字段冲突先到者（服务器）生效。 */
  function syncPendingChanges() {
    if (!pendingAreaChanges.value.length) {
      mergeReport.value = null
      return
    }
    let merged = 0
    const conflicts: Array<{ area: string; field: string }> = []
    for (const change of pendingAreaChanges.value) {
      const { area, conflicts: areaConflicts } = areaServer.mergePending(structuredClone(change))
      upsertLocalArea(area)
      merged += 1
      for (const conflict of areaConflicts) {
        conflicts.push({ area: area.id, field: conflict.field })
      }
    }
    pendingAreaChanges.value = []
    mergeReport.value = { merged, conflicts }
    touchLocks()
    rev.value += 1
  }

  function goOffline() {
    // 断线时释放本端持有的在线锁，不占着别人的区域。
    areaServer.releaseAll(currentUser.value)
    touchLocks()
    isOffline.value = true
  }

  function goOnline() {
    isOffline.value = false
    syncPendingChanges()
  }

  function toggleOffline() {
    if (isOffline.value) goOnline()
    else goOffline()
  }

  function setCurrentUser(user: string) {
    if (user === currentUser.value) return
    if (!isOffline.value) {
      areaServer.releaseAll(currentUser.value)
      touchLocks()
    }
    currentUser.value = user
  }

  return {
    cues,
    areas,
    selectedId,
    selectedAreaId,
    selectedCue,
    selectedArea,
    filteredCues,
    conflicts,
    spatial,
    spatialProblemCues,
    pendingAreaChanges,
    pendingAreaIds,
    reportOf,
    effectiveRoute,
    statusOf,
    areaLockHolder,
    lockVersion,
    recomputeNotice,
    mergeReport,
    zoom,
    actFilter,
    departmentFilter,
    revision,
    lastSaved,
    isOffline,
    locked,
    currentUser,
    users,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    updateCue,
    setSpatialVerified,
    addWaypoint,
    addCue,
    undo,
    redo,
    addComment,
    toggleComment,
    lockBaseline,
    unlockBaseline,
    saveArea,
    addArea,
    simulateOtherLock,
    simulateRemoteMove,
    releaseLock,
    toggleOffline,
    setCurrentUser,
  }
})

/** 恢复数据时补全字段，保持类型完整。 */
function restoreCue(raw: Cue): Cue {
  return migrateCue(raw)
}
