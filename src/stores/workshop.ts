import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import {
  planRoute,
  routesCross,
  timeWindowsOverlap,
  pointsEqual,
  type Point,
  type Rect,
  type PlannerObstacle,
} from '../staging/geometry'

export type Department = '舞台' | '灯光' | '音响' | '道具'
export type { Point } from '../staging/geometry'
export type { Rect } from '../staging/geometry'

export type Comment = {
  id: string
  author: string
  content: string
  createdAt: string
  resolved: boolean
}

/** 布景 / 机械区登记的空间实体：占用范围 + 演员安全间隔。 */
export type AreaKind = '布景' | '机械区'
export type StageArea = {
  /** 区域编号（离线合并按此编号对齐）。 */
  id: string
  name: string
  kind: AreaKind
  rect: Rect
  /** 演员安全间隔（舞台单位）。 */
  clearance: number
  color: string
  version: number
  updatedAt: string
  updatedBy: string
}

export type RouteState = 'clear' | 'adjusted' | 'blocked' | 'legacy'
export type RouteIssueType = 'blocked' | 'crossing' | 'legacy'
export type RouteIssue = {
  type: RouteIssueType
  /** 第几条路线段（0 = 入场 → 第一个中间节点）。 */
  segment?: number
  areaId?: string
  areaName?: string
  otherCueId?: string
  point?: Point
  detail: string
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
  /** 缺省（旧数据）时保留原路线并标记待复核。 */
  routeState?: RouteState
  routeIssues?: RouteIssue[]
  /** 规划路线实际绕过的障碍名称。 */
  routeInfo?: string[]
}

/** 离线期间积压的区域变更，回网后按区域编号合并。 */
export type OutboxChange = {
  op: 'upsert' | 'remove'
  area: StageArea
  baseVersion: number
  clientId: string
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

export const seedAreas: StageArea[] = [
  {
    id: 'A-01',
    name: '码头箱',
    kind: '布景',
    rect: { x: 24, y: 50, w: 18, h: 14 },
    clearance: 3,
    color: '#c8794a',
    version: 1,
    updatedAt: '2026-09-27 14:20',
    updatedBy: '王灯控',
  },
  {
    id: 'A-02',
    name: '升降台',
    kind: '机械区',
    rect: { x: 43, y: 37, w: 12, h: 14 },
    clearance: 3,
    color: '#4f7fb0',
    version: 1,
    updatedAt: '2026-09-27 14:22',
    updatedBy: '舞台机械',
  },
  {
    id: 'A-03',
    name: '救生艇',
    kind: '布景',
    rect: { x: 76, y: 44, w: 12, h: 12 },
    clearance: 3,
    color: '#5a8f6b',
    version: 1,
    updatedAt: '2026-09-27 14:25',
    updatedBy: '道具组',
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
    route: [
      { x: 10, y: 70 },
      { x: 45, y: 67 },
      { x: 58, y: 54 },
      { x: 64, y: 38 },
    ],
    note: '灯位切换后 2 秒入场，停在码头箱前。',
    status: '已确认',
    routeState: 'adjusted',
    routeInfo: ['码头箱', '升降台'],
    comments: [
      { id: 'c1', author: '王灯控', content: '面光需要延长 4 秒，保证转身动作可见。', createdAt: '2026-09-27 14:20', resolved: false },
    ],
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
    exit: { x: 62, y: 56 },
    route: [
      { x: 28, y: 30 },
      { x: 58, y: 34 },
      { x: 62, y: 56 },
    ],
    note: '使用 B 版信封，背台侧完成交接。',
    status: '待确认',
    routeState: 'adjusted',
    routeInfo: ['升降台'],
    comments: [],
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
    exit: { x: 42, y: 46 },
    route: [
      { x: 72, y: 82 },
      { x: 60, y: 70 },
      { x: 42, y: 46 },
    ],
    note: '先确认演员离开危险半径，再启动升降台。',
    status: '草稿',
    routeState: 'blocked',
    routeIssues: [
      { type: 'blocked', segment: -2, areaId: 'A-01', areaName: '码头箱', detail: '退场点落在安全间隔内' },
      { type: 'blocked', segment: -2, areaId: 'A-02', areaName: '升降台', detail: '退场点落在安全间隔内' },
      { type: 'blocked', segment: 0, areaId: 'A-01', areaName: '码头箱', detail: '第 1 段（入场 → 退场）与 码头箱 冲突' },
      { type: 'blocked', segment: 0, areaId: 'A-02', areaName: '升降台', detail: '第 1 段（入场 → 退场）与 升降台 冲突' },
    ],
    comments: [],
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
    // 旧提示：缺少范围数据，保留原路线并标记待复核。
    routeState: 'legacy',
    routeIssues: [{ type: 'legacy', detail: '旧提示缺少范围数据，保留原路线，待复核' }],
    comments: [],
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
    route: [
      { x: 18, y: 82 },
      { x: 45, y: 67 },
      { x: 58, y: 54 },
      { x: 82, y: 18 },
    ],
    note: '群演保持第二条对角线，不遮挡主视线。',
    status: '草稿',
    routeState: 'adjusted',
    routeInfo: ['码头箱', '升降台'],
    comments: [],
  },
  {
    id: 'C-06',
    act: '第三幕',
    scene: '守望',
    time: '00:38:20',
    title: '救生艇推入',
    department: '道具',
    owner: '道具组 / 群演乙组',
    duration: 50,
    entry: { x: 88, y: 64 },
    exit: { x: 64, y: 30 },
    route: [
      { x: 88, y: 64 },
      { x: 73, y: 59 },
      { x: 64, y: 30 },
    ],
    note: '与演员横穿路线冲突，需调整优先权。',
    status: '待确认',
    routeState: 'adjusted',
    routeInfo: ['救生艇'],
    comments: [],
  },
]

const STORAGE_KEY = 'stage-scheduler-draft-v2'
const LEGACY_KEY = 'stage-scheduler-draft-v1'

function nowStamp(): string {
  return new Date().toLocaleString('zh-CN')
}

function obstaclesOf(areas: StageArea[]): PlannerObstacle[] {
  return areas.map((area) => ({ id: area.id, name: area.name, rect: area.rect, clearance: area.clearance }))
}

/** 对单条提示重算路线：入场 / 退场点固定，只替换中间节点。 */
function replanCue(cue: Cue, areas: StageArea[]): Cue {
  const result = planRoute(cue.entry, cue.exit, obstaclesOf(areas))
  if (result.path) {
    const changed =
      result.path.length !== cue.route.length ||
      result.path.some((point, index) => !pointsEqual(point, cue.route[index] ?? { x: -1, y: -1 }))
    return {
      ...cue,
      route: result.path,
      routeState: changed ? 'adjusted' : 'clear',
      routeIssues: [],
      routeInfo: result.avoided,
    }
  }
  return {
    ...cue,
    routeState: 'blocked',
    routeIssues: result.blocked.map((item) => ({
      type: 'blocked' as const,
      segment: item.segment,
      areaId: item.obstacleId,
      areaName: item.obstacleName,
      detail: item.reason,
    })),
    routeInfo: [],
  }
}

/** 同场景、同时段的走位交叉检测（沿用当前路线，无法绕行的提示也参与）。 */
function detectCrossings(cues: Cue[]): Cue[] {
  const next = cues.map((cue) => ({ ...cue, routeIssues: (cue.routeIssues ?? []).filter((issue) => issue.type !== 'crossing') }))
  for (let i = 0; i < next.length; i += 1) {
    for (let j = i + 1; j < next.length; j += 1) {
      const a = next[i]
      const b = next[j]
      if (a.scene !== b.scene) continue
      if (!timeWindowsOverlap(a.time, a.duration, b.time, b.duration)) continue
      if (a.route.length < 2 || b.route.length < 2) continue
      const hit = routesCross(a.route, b.route)
      if (!hit) continue
      const point = { x: Number(hit.x.toFixed(1)), y: Number(hit.y.toFixed(1)) }
      a.routeIssues!.push({
        type: 'crossing',
        otherCueId: b.id,
        point,
        detail: `与 ${b.id} 的走位在同时段交叉于 (${point.x}, ${point.y})`,
      })
      b.routeIssues!.push({
        type: 'crossing',
        otherCueId: a.id,
        point,
        detail: `与 ${a.id} 的走位在同时段交叉于 (${point.x}, ${point.y})`,
      })
    }
  }
  return next
}

/** 综合路线状态：无法绕行 > 待复核 > 交叉待确认 > 已绕行 / 正常。 */
export function routeStatusOf(cue: Cue): RouteState | 'crossing' {
  if (cue.routeState === 'blocked') return 'blocked'
  if (cue.routeState === 'legacy') return 'legacy'
  if (cue.routeIssues?.some((issue) => issue.type === 'crossing')) return 'crossing'
  return cue.routeState ?? 'legacy'
}

export const routeStatusLabel: Record<string, string> = {
  clear: '正常',
  adjusted: '已绕行',
  blocked: '无法绕行',
  legacy: '待复核',
  crossing: '交叉待确认',
}

function restoreDraft(): { cues: Cue[]; areas: StageArea[]; outbox: OutboxChange[]; revision: number } {
  const fallback = {
    cues: structuredClone(seedCues),
    areas: structuredClone(seedAreas),
    outbox: [] as OutboxChange[],
    revision: 12,
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { cues?: Cue[]; areas?: StageArea[]; outbox?: OutboxChange[]; revision?: number }
      if (parsed.cues?.length) {
        return {
          cues: parsed.cues,
          areas: parsed.areas?.length ? parsed.areas : structuredClone(seedAreas),
          outbox: parsed.outbox ?? [],
          revision: parsed.revision ?? 12,
        }
      }
    }
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as { cues?: Cue[]; revision?: number }
      if (parsed.cues?.length) {
        // 旧版本草稿：没有范围数据，也没有路线元数据 → 全部保留原路线、待复核。
        const cues = parsed.cues.map((cue) => ({ ...cue, routeState: 'legacy' as const, routeIssues: [{ type: 'legacy' as const, detail: '旧提示缺少范围数据，保留原路线，待复核' }] }))
        return { cues, areas: structuredClone(seedAreas), outbox: [], revision: parsed.revision ?? 12 }
      }
    }
  } catch {
    // 草稿损坏时回退到种子数据。
  }
  return fallback
}

export const useWorkshopStore = defineStore('workshop', () => {
  const restored = restoreDraft()
  const areas = ref<StageArea[]>(restored.areas)
  // 非旧数据提示在入水时统一重算，保证路线 / 状态 / 问题与登记范围一致。
  const cues = ref<Cue[]>(
    restored.cues.map((cue) => (cue.routeState === 'legacy' ? cue : replanCue(cue, restored.areas))),
  )
  const areaOutbox = ref<OutboxChange[]>(restored.outbox)
  const selectedId = ref('C-01')
  const zoom = ref(100)
  const actFilter = ref('全部')
  const departmentFilter = ref('全部')
  const rev = ref(restored.revision)
  const revision = computed(() => `R${rev.value}`)
  const lastSaved = ref('刚刚自动保存')
  const isOffline = ref(false)
  const locked = ref(false)
  const undoStack = ref<Cue[][]>([])
  const redoStack = ref<Cue[][]>([])
  // 种子数据首次入水时不触发重算（种子路线已规划好）。
  const areasHydrated = ref(false)
  queueMicrotask(() => {
    areasHydrated.value = true
  })

  const selectedCue = computed(() => cues.value.find((cue) => cue.id === selectedId.value) ?? cues.value[0])
  const filteredCues = computed(() =>
    cues.value.filter(
      (cue) =>
        (actFilter.value === '全部' || cue.act === actFilter.value) &&
        (departmentFilter.value === '全部' || cue.department === departmentFilter.value),
    ),
  )
  const conflicts = computed(() =>
    cues.value.filter((cue, index) =>
      cues.value.some((other, otherIndex) => otherIndex !== index && other.time === cue.time && other.scene === cue.scene),
    ),
  )
  /** 路线无法绕行 / 待复核 / 交叉的提示（打印清单与工作台共用）。 */
  const routeAlerts = computed(() =>
    cues.value.filter((cue) => {
      const status = routeStatusOf(cue)
      return status === 'blocked' || status === 'legacy' || status === 'crossing'
    }),
  )

  watch(
    [cues, areas, areaOutbox, rev, isOffline],
    () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ cues: cues.value, areas: areas.value, outbox: areaOutbox.value, revision: rev.value }),
      )
      lastSaved.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    { deep: true },
  )

  /** 范围一变，重算所有受影响提示（旧提示保留原路线，不自动重算）。 */
  watch(
    areas,
    () => {
      if (!areasHydrated.value) return
      recomputeRoutes()
    },
    { deep: true },
  )

  function snapshot() {
    undoStack.value.push(structuredClone(cues.value))
    if (undoStack.value.length > 20) undoStack.value.shift()
    redoStack.value = []
  }

  /** 重算全部路线：入场 / 退场点不动，只调整中间节点。 */
  function recomputeRoutes() {
    snapshot()
    const next = cues.value.map((cue) => (cue.routeState === 'legacy' ? cue : replanCue(cue, areas.value)))
    cues.value = detectCrossings(next)
    rev.value += 1
  }

  /** 手动复核单条提示（含旧提示）。 */
  function reviewCue(id: string) {
    const index = cues.value.findIndex((cue) => cue.id === id)
    if (index < 0) return
    snapshot()
    const replanned = replanCue({ ...cues.value[index], routeState: 'clear' }, areas.value)
    cues.value = detectCrossings(cues.value.map((cue) => (cue.id === id ? replanned : cue)))
    rev.value += 1
  }

  function updateCue(patch: Partial<Cue>, addRevision = true) {
    if (locked.value) return
    snapshot()
    const index = cues.value.findIndex((cue) => cue.id === selectedId.value)
    if (index < 0) return
    cues.value[index] = { ...cues.value[index], ...patch }
    if (patch.entry !== undefined || patch.exit !== undefined) {
      cues.value[index] = replanCue(cues.value[index], areas.value)
    }
    if (patch.time !== undefined || patch.duration !== undefined || patch.entry !== undefined || patch.exit !== undefined) {
      cues.value = detectCrossings(cues.value)
    }
    if (addRevision) rev.value += 1
  }

  function addWaypoint(point: { x: number; y: number }) {
    const cue = selectedCue.value
    if (!cue) return
    updateCue({ route: [...cue.route, point] })
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
    }
    const planned = replanCue(cue, areas.value)
    cues.value.push(planned)
    selectedId.value = planned.id
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

  function toggleOffline() {
    const goingOnline = isOffline.value
    isOffline.value = !isOffline.value
    if (goingOnline) {
      void flushOutbox()
    }
  }

  // ---- 区域登记与并发控制（先到者生效） ----

  function nextAreaId(): string {
    let max = 0
    for (const area of areas.value) {
      const match = /^A-(\d+)$/.exec(area.id)
      if (match) max = Math.max(max, Number(match[1]))
    }
    return `A-${String(max + 1).padStart(2, '0')}`
  }

  function applyArea(area: StageArea) {
    const index = areas.value.findIndex((item) => item.id === area.id)
    if (index >= 0) areas.value[index] = area
    else areas.value.push(area)
  }

  function queueOutbox(change: OutboxChange) {
    const index = areaOutbox.value.findIndex((item) => item.clientId === change.clientId && item.op === change.op)
    if (index >= 0) areaOutbox.value[index] = change
    else areaOutbox.value.push(change)
  }

  async function addArea(input: Partial<StageArea> = {}): Promise<{ ok: boolean }> {
    if (locked.value) return { ok: false }
    const palette = ['#c8794a', '#4f7fb0', '#5a8f6b', '#b06a8f', '#8a7ab0']
    const area: StageArea = {
      id: input.id ?? nextAreaId(),
      name: input.name ?? '新区域',
      kind: input.kind ?? '布景',
      rect: input.rect ?? { x: 42, y: 42, w: 16, h: 12 },
      clearance: input.clearance ?? 3,
      color: input.color ?? palette[areas.value.length % palette.length],
      version: 1,
      updatedAt: nowStamp(),
      updatedBy: '当前用户',
    }
    if (isOffline.value) {
      areas.value.push(area)
      queueOutbox({ op: 'upsert', area, baseVersion: 0, clientId: area.id })
      rev.value += 1
      return { ok: true }
    }
    try {
      const { data } = await axios.post('/api/areas', { area })
      applyArea(data as StageArea)
    } catch {
      applyArea(area)
    }
    rev.value += 1
    return { ok: true }
  }

  async function updateArea(id: string, patch: Partial<StageArea>): Promise<{ ok: boolean; conflict?: boolean }> {
    if (locked.value) return { ok: false }
    const area = areas.value.find((item) => item.id === id)
    if (!area) return { ok: false }
    const baseVersion = area.version
    const updated: StageArea = { ...area, ...patch, version: baseVersion + 1, updatedAt: nowStamp(), updatedBy: '当前用户' }
    applyArea(updated)
    if (isOffline.value) {
      queueOutbox({ op: 'upsert', area: updated, baseVersion, clientId: id })
      return { ok: true }
    }
    try {
      const { data } = await axios.put(`/api/areas/${id}`, { area: updated, baseVersion })
      applyArea(data as StageArea)
      return { ok: true }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        // 先到者生效：回滚本地修改为服务端当前版本。
        applyArea(error.response.data.current as StageArea)
        return { ok: false, conflict: true }
      }
      return { ok: true }
    }
  }

  async function removeArea(id: string): Promise<{ ok: boolean; conflict?: boolean }> {
    if (locked.value) return { ok: false }
    const area = areas.value.find((item) => item.id === id)
    if (!area) return { ok: false }
    const baseVersion = area.version
    areas.value = areas.value.filter((item) => item.id !== id)
    if (isOffline.value) {
      queueOutbox({ op: 'remove', area, baseVersion, clientId: id })
      return { ok: true }
    }
    try {
      await axios.delete(`/api/areas/${id}`, { data: { baseVersion } })
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        applyArea(error.response.data.current as StageArea)
        return { ok: false, conflict: true }
      }
    }
    return { ok: true }
  }

  /** 模拟协作者先保存同一区域：后到者再保存时将收到 409。 */
  async function simulateCollaboratorEdit(id: string) {
    const area = areas.value.find((item) => item.id === id)
    if (!area) return
    const collaborator: StageArea = {
      ...area,
      name: `${area.name}·协作者挪动`,
      rect: {
        ...area.rect,
        x: Math.min(80, area.rect.x + 2),
        y: Math.min(80, area.rect.y + 2),
      },
      version: area.version + 1,
      updatedAt: nowStamp(),
      updatedBy: '协作者',
    }
    try {
      const { data } = await axios.put(`/api/areas/${id}`, { area: collaborator, baseVersion: area.version })
      applyArea(data as StageArea)
      ElMessage.warning(`协作者已先保存 ${id} 的范围（先到者生效），你的下一次保存将被拒绝`)
    } catch {
      ElMessage.info('离线模拟：协作者冲突需在联网时演示')
    }
  }

  /** 回网后按区域编号合并离线积压的变更。 */
  async function flushOutbox() {
    const changes = [...areaOutbox.value]
    if (!changes.length) return
    try {
      const { data } = await axios.post('/api/areas/sync', { changes }) as {
        data: { merged: StageArea[]; conflicts: { id: string; reason: string }[] }
      }
      for (const area of data.merged) applyArea(area)
      areaOutbox.value = []
      if (data.conflicts.length) {
        ElMessage.warning(
          `离线范围已合并 ${data.merged.length} 块；${data.conflicts.length} 块因先到者已更新未合并：${data.conflicts.map((item) => item.id).join('、')}`,
        )
      } else {
        ElMessage.success(`离线范围已按区域编号合并，共 ${data.merged.length} 块`)
      }
    } catch {
      ElMessage.warning('合并失败，离线变更已保留，稍后重试')
    }
  }

  return {
    cues,
    areas,
    areaOutbox,
    selectedId,
    selectedCue,
    filteredCues,
    conflicts,
    routeAlerts,
    zoom,
    actFilter,
    departmentFilter,
    revision,
    lastSaved,
    isOffline,
    locked,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    updateCue,
    addWaypoint,
    addCue,
    undo,
    redo,
    addComment,
    toggleComment,
    lockBaseline,
    unlockBaseline,
    toggleOffline,
    recomputeRoutes,
    reviewCue,
    addArea,
    updateArea,
    removeArea,
    simulateCollaboratorEdit,
    flushOutbox,
  }
})
