<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useWorkshopStore, type Cue, type Department } from '../stores/workshop'
import type { AreaKind, CueSpatialStatus, StageArea } from '../spatial/types'

const store = useWorkshopStore()
const commentText = ref('')
const showRouteEditor = ref(true)
const departments: Array<'全部' | Department> = ['全部', '舞台', '灯光', '音响', '道具']
const acts = ['全部', '第一幕', '第二幕', '第三幕']

const cue = computed(() => store.selectedCue)
const conflictCues = computed(() => new Set(store.conflicts.map((item) => item.id)))

const statusMeta: Record<CueSpatialStatus, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  ok: { label: '路线畅通', type: 'success' },
  rerouted: { label: '已自动绕行', type: 'warning' },
  blocked: { label: '排不出来', type: 'danger' },
  review: { label: '待复核（旧路线保留）', type: 'warning' },
  fixed: { label: '非走位提示', type: 'info' },
}

function statusOf(id: string): CueSpatialStatus {
  return store.statusOf(id)
}

function polyPoints(id: string): string {
  return store.effectiveRoute(id).map((point) => `${point.x},${point.y}`).join(' ')
}

function selectCue(item: Cue) {
  store.selectedId = item.id
}

function addWaypoint(event: MouseEvent) {
  if (!showRouteEditor.value || store.locked) return
  const current = cue.value
  if (!current) return
  if (current.kind !== '演员走位') {
    ElMessage.warning('机械动作与固定灯位不走演员路径，不能追加走位节点')
    return
  }
  const status = statusOf(current.id)
  if (status === 'blocked') {
    ElMessage.warning('当前路线排不出来，请先看右侧说明：挪动布景或调整入/退场门位')
    return
  }
  if (status === 'rerouted') {
    ElMessage.info('中间节点已由系统按当前范围重算；如需手改，请先标记待复核后编辑原路线')
    return
  }
  const target = event.currentTarget as SVGElement
  const rect = target.getBoundingClientRect()
  const x = Math.round(((event.clientX - rect.left) / rect.width) * 100)
  const y = Math.round(((event.clientY - rect.top) / rect.height) * 100)
  store.addWaypoint({ x, y })
  ElMessage.success('已在入/退场点之间插入中间节点（入退场点不动）')
}

function saveCue() {
  localStorage.setItem('stage-scheduler-last-action', new Date().toISOString())
  ElMessage.success(store.isOffline ? '已保存到离线草稿' : `已同步 ${store.revision}`)
}

function submitComment() {
  if (!commentText.value.trim()) return
  store.addComment(commentText.value.trim(), '制作人 · 陈曦')
  commentText.value = ''
  ElMessage.success('留言已加入待办')
}

function updateCue(key: keyof Cue, value: unknown) {
  store.updateCue({ [key]: value } as Partial<Cue>)
}

// ---------- 布景 / 机械区登记 ----------

const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('edit')
const dialogLockHint = ref('')

type AreaForm = {
  id: string
  name: string
  kind: AreaKind
  x: number
  y: number
  width: number
  height: number
  clearance: number
  timed: boolean
  start: string
  end: string
  note: string
}

const form = reactive<AreaForm>({
  id: '',
  name: '',
  kind: '布景',
  x: 20,
  y: 20,
  width: 12,
  height: 12,
  clearance: 2,
  timed: false,
  start: '00:00:00',
  end: '00:10:00',
  note: '',
})

function openCreate() {
  if (store.locked) return
  dialogMode.value = 'create'
  const nextNumber = store.areas.reduce((max, area) => {
    const n = Number(area.id.replace('A-', ''))
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0) + 1
  Object.assign(form, {
    id: `A-${String(nextNumber).padStart(2, '0')}`,
    name: '新布景',
    kind: '布景',
    x: 20,
    y: 20,
    width: 12,
    height: 12,
    clearance: 2,
    timed: false,
    start: '00:00:00',
    end: '00:10:00',
    note: '',
  })
  dialogLockHint.value = ''
  dialogVisible.value = true
}

function openEdit(area: StageArea) {
  if (store.locked) return
  dialogMode.value = 'edit'
  const holder = store.areaLockHolder(area.id)
  dialogLockHint.value = holder && holder !== store.currentUser ? `该区域正被 ${holder} 编辑（先到者持锁）` : ''
  Object.assign(form, {
    id: area.id,
    name: area.name,
    kind: area.kind,
    x: area.bounds.x,
    y: area.bounds.y,
    width: area.bounds.width,
    height: area.bounds.height,
    clearance: area.clearance,
    timed: Boolean(area.timeWindow),
    start: area.timeWindow?.start ?? '00:00:00',
    end: area.timeWindow?.end ?? '00:10:00',
    note: area.note,
  })
  dialogVisible.value = true
}

function boundsFromForm() {
  const x = Math.max(0, Math.min(99, Math.round(form.x)))
  const y = Math.max(0, Math.min(99, Math.round(form.y)))
  const width = Math.max(1, Math.min(100 - x, Math.round(form.width)))
  const height = Math.max(1, Math.min(100 - y, Math.round(form.height)))
  return { x, y, width, height }
}

function submitArea() {
  if (!form.id.trim() || !form.name.trim()) {
    ElMessage.warning('区域编号和名称都要填写')
    return
  }
  const existing = store.areas.find((area) => area.id === form.id)
  const timeWindow = form.timed ? { start: form.start, end: form.end } : null
  if (timeWindow && timeWindow.start >= timeWindow.end) {
    ElMessage.warning('启用时间窗时，结束时间必须晚于开始时间')
    return
  }
  if (dialogMode.value === 'create') {
    const result = store.addArea({
      id: form.id.trim(),
      name: form.name.trim(),
      kind: form.kind,
      bounds: boundsFromForm(),
      clearance: Math.max(0, Math.round(form.clearance)),
      timeWindow,
      note: form.note,
    })
    if (!result.ok) {
      ElMessage.error(result.message)
      return
    }
    ElMessage.success(result.message)
    dialogVisible.value = false
    return
  }
  if (!existing) return
  const result = store.saveArea({
    ...existing,
    name: form.name.trim(),
    kind: form.kind,
    bounds: boundsFromForm(),
    clearance: Math.max(0, Math.round(form.clearance)),
    timeWindow,
    note: form.note,
  })
  if (!result.ok) {
    ElMessage.error(result.message)
    dialogLockHint.value = result.message
    return
  }
  ElMessage.success(result.message)
  dialogVisible.value = false
}

async function simulateLock(area: StageArea) {
  store.simulateOtherLock(area.id)
  ElMessage.info(`已让同事抢先锁住 ${area.id}（先到者生效），你现在点“编辑并保存”会被拒绝`)
}

async function simulateRemoteMove(area: StageArea) {
  const result = store.simulateRemoteMove(area.id)
  if (result.ok) ElMessage.success(result.message)
  else ElMessage.warning(result.message)
}

function releaseLock(area: StageArea) {
  store.releaseLock(area.id)
  ElMessage.success(`已释放 ${area.id} 的编辑锁`)
}

function areaPhysical(area: StageArea) {
  return area.bounds
}

// 安全间隔外扩框（路线必须在它之外）
function areaSafety(area: StageArea) {
  const c = area.clearance
  const x = Math.max(0, area.bounds.x - c)
  const y = Math.max(0, area.bounds.y - c)
  return {
    x,
    y,
    width: Math.min(100, area.bounds.x + area.bounds.width + c) - x,
    height: Math.min(100, area.bounds.y + area.bounds.height + c) - y,
  }
}

function selectedAreaOnMap() {
  return store.areas.find((area) => area.id === store.selectedAreaId)
}

function focusArea(area: StageArea) {
  store.selectedAreaId = area.id
}

const mergeReport = computed(() => store.mergeReport)
</script>

<template>
  <section class="page stage-page">
    <div class="page-head">
      <div>
        <p class="eyebrow">STAGING / 走位编排</p>
        <h1>舞台平面与执行提示</h1>
        <p class="muted">布景、机械区、走位节点、执行提示与打印清单共用一套空间事实；范围一变自动重算绕行。</p>
      </div>
      <div class="actions">
        <el-button :disabled="!store.canUndo || store.locked" @click="store.undo()">撤销</el-button>
        <el-button :disabled="!store.canRedo || store.locked" @click="store.redo()">重做</el-button>
        <el-button type="primary" @click="saveCue">{{ store.isOffline ? '保存草稿' : '同步版本' }}</el-button>
      </div>
    </div>

    <el-alert
      v-if="store.recomputeNotice"
      class="notice-alert"
      type="success"
      show-icon
      :closable="true"
      title="范围变更，走位已重算"
      :description="store.recomputeNotice"
      @close="store.recomputeNotice = ''"
    />
    <el-alert
      v-if="mergeReport"
      class="notice-alert"
      :type="mergeReport.conflicts.length ? 'warning' : 'success'"
      show-icon
      :closable="true"
      :title="`离线改动已回网合并：${mergeReport.merged} 块区域按编号对齐`"
      :description="
        mergeReport.conflicts.length
          ? mergeReport.conflicts.map((c) => `区域 ${c.area} 的「${c.field}」与先提交者冲突，已采用先到者版本`).join('；')
          : '无字段冲突，全部合并成功。'
      "
      @close="store.mergeReport = null"
    />
    <el-alert
      v-if="store.conflicts.length"
      class="conflict-alert"
      type="warning"
      show-icon
      :closable="false"
      :title="`发现 ${store.conflicts.length} 个空间 / 时间问题（打印清单会逐条标出）`"
      description="在右侧“空间校验”里看具体是哪段路线跟哪块布景、或哪条走位打架。"
    />

    <div class="toolbar panel">
      <div class="filter-group">
        <span>幕次</span>
        <el-select v-model="store.actFilter" size="small" style="width: 112px">
          <el-option v-for="act in acts" :key="act" :label="act" :value="act" />
        </el-select>
        <span>部门</span>
        <el-select v-model="store.departmentFilter" size="small" style="width: 112px">
          <el-option v-for="department in departments" :key="department" :label="department" :value="department" />
        </el-select>
      </div>
      <div class="zoom-control">
        <span>缩放 {{ store.zoom }}%</span>
        <el-slider v-model="store.zoom" :min="70" :max="150" :step="5" style="width: 150px" />
      </div>
      <el-switch v-model="showRouteEditor" active-text="路线编辑" />
      <el-select :model-value="store.currentUser" size="small" style="width: 190px" @update:model-value="store.setCurrentUser($event)">
        <el-option v-for="user in store.users" :key="user" :label="user" :value="user" />
      </el-select>
      <el-button @click="store.addCue" :disabled="store.locked">新增提示</el-button>
      <el-tag :type="store.locked ? 'success' : 'info'" effect="plain">{{ store.locked ? '基线已锁定' : '草稿编辑中' }}</el-tag>
    </div>

    <div class="work-grid">
      <section class="panel stage-panel">
        <div class="panel-head">
          <h3>舞台平面图 · 主视图</h3>
          <span class="muted">实色块＝占用范围，虚线框＝安全间隔，红叉＝同时段走位交叉</span>
        </div>
        <div class="stage-scroll">
          <div class="stage-canvas" :style="{ transform: `scale(${store.zoom / 100})` }">
            <div class="stage-label">观众席</div>
            <div class="led-strip">LED 背景幕</div>
            <svg class="stage-svg" viewBox="0 0 100 100" preserveAspectRatio="none" @click="addWaypoint">
              <defs>
                <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
                  <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#cbd6da" stroke-width="0.15" />
                </pattern>
                <marker id="arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                  <path d="M0,0 L5,2.5 L0,5 z" fill="#287d7c" />
                </marker>
              </defs>
              <rect width="100" height="100" fill="url(#grid)" />
              <rect x="3" y="2" width="94" height="12" rx="1" class="backstage" />
              <rect x="5" y="88" width="90" height="9" rx="1" class="apron" />
              <line x1="50" y1="14" x2="50" y2="88" class="center-line" />

              <!-- 布景 / 机械区：唯一空间事实的可视化 -->
              <g v-for="area in store.areas" :key="area.id" class="area-group" @click.stop="focusArea(area)">
                <rect
                  v-bind="areaSafety(area)"
                  rx="0.8"
                  :class="['area-safety', { active: selectedAreaOnMap()?.id === area.id, mechanical: area.kind === '机械区' }]"
                />
                <rect
                  v-bind="areaPhysical(area)"
                  rx="0.6"
                  :class="['area-body', { active: selectedAreaOnMap()?.id === area.id, mechanical: area.kind === '机械区' }]"
                />
                <text :x="area.bounds.x + 1" :y="area.bounds.y + 3.2" class="area-label">{{ area.id }} {{ area.name }}</text>
              </g>

              <!-- 走位路线：画的是空间校验后的实际生效路线 -->
              <template v-for="item in store.filteredCues" :key="item.id">
                <polyline
                  v-if="polyPoints(item.id).length > 1"
                  :points="polyPoints(item.id)"
                  :class="['route', `route-${statusOf(item.id)}`, { selected: item.id === store.selectedId, conflict: conflictCues.has(item.id) }]"
                  marker-end="url(#arrow)"
                />
                <g class="cue-point" :class="{ selected: item.id === store.selectedId }" @click.stop="selectCue(item)">
                  <circle :cx="item.entry.x" :cy="item.entry.y" r="2.8" />
                  <text :x="item.entry.x + 3.2" :y="item.entry.y + 1">{{ item.id }}</text>
                </g>
              </template>

              <!-- 同时段交叉点 -->
              <g v-for="(mark, index) in store.spatial.marks" :key="`mark-${index}`" class="crossing-mark">
                <circle :cx="mark.point.x" :cy="mark.point.y" r="2.4" />
                <line :x1="mark.point.x - 1.6" :y1="mark.point.y - 1.6" :x2="mark.point.x + 1.6" :y2="mark.point.y + 1.6" />
                <line :x1="mark.point.x - 1.6" :y1="mark.point.y + 1.6" :x2="mark.point.x + 1.6" :y2="mark.point.y - 1.6" />
              </g>

              <template v-if="cue">
                <circle
                  v-for="(point, index) in store.effectiveRoute(cue.id).slice(1, -1)"
                  :key="index"
                  :cx="point.x"
                  :cy="point.y"
                  r="1.5"
                  :class="['waypoint', `waypoint-${statusOf(cue.id)}`]"
                />
                <circle :cx="cue.exit.x" :cy="cue.exit.y" r="2.5" class="exit-point" />
              </template>
            </svg>
            <div class="stage-legend">
              <span><i class="entry" />入场</span>
              <span><i class="way" />路线</span>
              <span><i class="exit" />退场</span>
              <span><i class="area-legend" />布景/机械占用</span>
              <span><i class="safety-legend" />安全间隔</span>
              <span><i class="cross-legend" />交叉点</span>
            </div>
          </div>
        </div>
      </section>

      <aside class="panel editor-panel">
        <div v-if="cue" class="editor">
          <div class="editor-title">
            <div>
              <span>{{ cue.id }} · {{ cue.act }}</span>
              <h3>{{ cue.title }}</h3>
            </div>
            <el-tag :type="cue.status === '已确认' ? 'success' : 'warning'" effect="plain">{{ cue.status }}</el-tag>
          </div>

          <!-- 空间校验结果：执行提示跟着空间事实走 -->
          <div class="spatial-box" :class="`is-${statusOf(cue.id)}`">
            <div class="spatial-head">
              <strong>空间校验</strong>
              <el-tag :type="statusMeta[statusOf(cue.id)].type" size="small" effect="dark">
                {{ statusMeta[statusOf(cue.id)].label }}
              </el-tag>
            </div>
            <ul v-if="store.reportOf(cue.id)?.issues.length" class="issue-list">
              <li v-for="(issue, index) in store.reportOf(cue.id)?.issues" :key="index" :class="issue.severity">
                {{ issue.message }}
              </li>
            </ul>
            <p v-else class="spatial-ok">入场 → 退场路径与当前所有布景、机械区安全间隔不冲突。</p>
            <div class="spatial-actions">
              <el-button v-if="cue.kind === '演员走位' && !cue.spatialVerified" size="small" type="warning" plain @click="store.setSpatialVerified(true)">
                已核对范围，标记复核通过（自动重算）
              </el-button>
              <el-button v-if="cue.kind === '演员走位' && cue.spatialVerified" size="small" link @click="store.setSpatialVerified(false)">
                撤回为待复核（保留原路线）
              </el-button>
            </div>
          </div>

          <el-form label-position="top" size="small" :disabled="store.locked">
            <div class="form-grid">
              <el-form-item label="场景">
                <el-input :model-value="cue.scene" @update:model-value="updateCue('scene', $event)" />
              </el-form-item>
              <el-form-item label="时间码">
                <el-input :model-value="cue.time" @update:model-value="updateCue('time', $event)" />
              </el-form-item>
              <el-form-item label="执行部门">
                <el-select :model-value="cue.department" @update:model-value="updateCue('department', $event)">
                  <el-option v-for="department in departments.slice(1)" :key="department" :label="department" :value="department" />
                </el-select>
              </el-form-item>
              <el-form-item label="提示类型">
                <el-select :model-value="cue.kind" @update:model-value="updateCue('kind', $event)">
                  <el-option label="演员走位（参与绕障/交叉检查）" value="演员走位" />
                  <el-option label="机械动作（不走演员路径）" value="机械动作" />
                  <el-option label="固定灯位（不走演员路径）" value="固定灯位" />
                </el-select>
              </el-form-item>
              <el-form-item label="责任角色">
                <el-input :model-value="cue.owner" @update:model-value="updateCue('owner', $event)" />
              </el-form-item>
            </div>
            <el-form-item label="执行说明">
              <el-input type="textarea" :rows="3" :model-value="cue.note" @update:model-value="updateCue('note', $event)" />
            </el-form-item>
            <el-form-item label="入场 / 退场点（固定不动）">
              <div class="route-summary">
                <span class="anchor-point">入 ({{ cue.route[0]?.x }},{{ cue.route[0]?.y }})</span>
                <span class="anchor-point">出 ({{ cue.route[cue.route.length - 1]?.x }},{{ cue.route[cue.route.length - 1]?.y }})</span>
              </div>
            </el-form-item>
            <el-form-item :label="`实际生效路线节点（${store.effectiveRoute(cue.id).length} 个，重算只改中间）`">
              <div class="route-summary">
                <span v-for="(point, index) in store.effectiveRoute(cue.id)" :key="index">
                  {{ index === 0 ? '入' : index === store.effectiveRoute(cue.id).length - 1 ? '出' : index }} ({{ point.x }},{{ point.y }})
                </span>
              </div>
            </el-form-item>
          </el-form>

          <div class="comment-block">
            <div class="comment-head">
              <strong>部门留言 · {{ cue.comments.filter((item) => !item.resolved).length }} 待处理</strong>
            </div>
            <div class="comment-list">
              <div v-for="comment in cue.comments" :key="comment.id" class="comment" :class="{ resolved: comment.resolved }">
                <div>
                  <strong>{{ comment.author }}</strong>
                  <time>{{ comment.createdAt }}</time>
                </div>
                <p>{{ comment.content }}</p>
                <el-button link type="primary" @click="store.toggleComment(comment.id)">
                  {{ comment.resolved ? '重新打开' : '标记解决' }}
                </el-button>
              </div>
              <el-empty v-if="cue.comments.length === 0" description="暂无留言" :image-size="46" />
            </div>
            <div class="comment-input">
              <el-input v-model="commentText" placeholder="输入需其他部门处理的意见" @keyup.enter="submitComment" />
              <el-button type="primary" @click="submitComment">发送</el-button>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- 布景与机械区登记 -->
    <section class="panel area-panel">
      <div class="panel-head">
        <h3>布景与机械区登记（空间事实源）</h3>
        <div class="area-head-actions">
          <el-tag :type="store.isOffline ? 'warning' : 'success'" effect="plain">
            {{ store.isOffline ? `离线 · ${store.pendingAreaChanges.length} 项待合并` : '在线' }}
          </el-tag>
          <el-button size="small" @click="store.toggleOffline()">{{ store.isOffline ? '恢复在线并合并' : '模拟离线' }}</el-button>
          <el-button size="small" type="primary" :disabled="store.locked" @click="openCreate">登记新区域</el-button>
        </div>
      </div>
      <div class="area-table-wrap">
        <table class="area-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>名称 / 类型</th>
              <th>占用范围 (x,y,w,h)</th>
              <th>安全间隔</th>
              <th>占用时段</th>
              <th>版本 / 编辑锁</th>
              <th>协同操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="area in store.areas" :key="area.id" :class="{ selected: store.selectedAreaId === area.id }" @click="focusArea(area)">
              <td class="mono">{{ area.id }}</td>
              <td>
                <strong>{{ area.name }}</strong>
                <el-tag size="small" :type="area.kind === '机械区' ? 'danger' : 'info'" effect="plain">{{ area.kind }}</el-tag>
                <small v-if="store.pendingAreaIds.has(area.id)" class="pending-badge">离线待合并</small>
              </td>
              <td class="mono">{{ area.bounds.x }}, {{ area.bounds.y }}, {{ area.bounds.width }}, {{ area.bounds.height }}</td>
              <td>{{ area.clearance }} 格</td>
              <td>{{ area.timeWindow ? `${area.timeWindow.start}–${area.timeWindow.end}` : '整场' }}</td>
              <td>
                <div>v{{ area.revision }} · {{ area.updatedBy }}</div>
                <small v-if="store.areaLockHolder(area.id)" class="lock-badge">
                  🔒 {{ store.areaLockHolder(area.id) === store.currentUser ? '你持锁' : store.areaLockHolder(area.id) + ' 持锁' }}
                </small>
                <small v-else class="muted">无锁</small>
              </td>
              <td class="area-actions" @click.stop>
                <el-button size="small" :disabled="store.locked" @click="openEdit(area)">编辑范围</el-button>
                <el-dropdown trigger="click" @command="(cmd: string) => cmd === 'lock' ? simulateLock(area) : cmd === 'remote' ? simulateRemoteMove(area) : releaseLock(area)">
                  <el-button size="small" plain>协同模拟 ▾</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="lock">让同事抢先锁这块</el-dropdown-item>
                      <el-dropdown-item command="remote">同事挪位并提交（触发重算）</el-dropdown-item>
                      <el-dropdown-item command="release">释放编辑锁</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="area-foot muted">
        规则：两人同时改同一块区域时先到者持锁生效；离线改动回网后按区域编号做三方合并，同字段冲突采用先提交者版本；旧走位缺范围数据时保留原路线并标记待复核。
      </p>
    </section>

    <section class="panel cue-strip">
      <div class="panel-head">
        <h3>脚本节点（{{ store.filteredCues.length }}）</h3>
        <span class="muted">按执行时间排序</span>
      </div>
      <div class="cue-cards">
        <button
          v-for="item in [...store.filteredCues].sort((a, b) => a.time.localeCompare(b.time))"
          :key="item.id"
          class="cue-card"
          :class="{ active: item.id === store.selectedId, conflict: conflictCues.has(item.id) }"
          @click="selectCue(item)"
        >
          <span>{{ item.id }} · {{ item.department }}</span>
          <strong>{{ item.title }}</strong>
          <small>{{ item.time }} · {{ item.duration }} 秒</small>
          <el-tag size="small" :type="statusMeta[statusOf(item.id)].type" effect="plain">{{ statusMeta[statusOf(item.id)].label }}</el-tag>
        </button>
      </div>
    </section>

    <!-- 区域编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="dialogMode === 'create' ? '登记布景 / 机械区' : `编辑范围 · ${form.id}`" width="560px">
      <el-alert v-if="dialogLockHint" type="error" :closable="false" show-icon class="dialog-lock-alert" :title="dialogLockHint" />
      <el-form label-position="top" size="small">
        <div class="dialog-grid">
          <el-form-item label="区域编号（合并主键，创建后不可改）">
            <el-input v-model="form.id" :disabled="dialogMode === 'edit'" placeholder="如 A-05" />
          </el-form-item>
          <el-form-item label="名称">
            <el-input v-model="form.name" />
          </el-form-item>
          <el-form-item label="类型">
            <el-radio-group v-model="form.kind">
              <el-radio value="布景">布景</el-radio>
              <el-radio value="机械区">机械区</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="演员安全间隔（网格单位）">
            <el-input-number v-model="form.clearance" :min="0" :max="20" />
          </el-form-item>
        </div>
        <el-form-item label="占用范围（0–100 相对坐标）">
          <div class="bounds-grid">
            <el-input-number v-model="form.x" :min="0" :max="99" />
            <span>X</span>
            <el-input-number v-model="form.y" :min="0" :max="99" />
            <span>Y</span>
            <el-input-number v-model="form.width" :min="1" :max="100" />
            <span>宽</span>
            <el-input-number v-model="form.height" :min="1" :max="100" />
            <span>高</span>
          </div>
        </el-form-item>
        <el-form-item label="按时间窗占用（机械区常用；关闭＝整场占用）">
          <div class="time-window-row">
            <el-switch v-model="form.timed" />
            <template v-if="form.timed">
              <el-input v-model="form.start" placeholder="00:21:00" style="width: 120px" />
              <span>至</span>
              <el-input v-model="form.end" placeholder="00:24:30" style="width: 120px" />
            </template>
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitArea">{{ store.isOffline ? '离线保存（回网合并）' : '保存并重算走位' }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.stage-page {
  background: #eef2f4;
}

.notice-alert,
.conflict-alert {
  margin-bottom: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
  padding: 10px 14px;
}

.filter-group,
.zoom-control {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #5d6b78;
  font-size: 12px;
}

.work-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(320px, 0.75fr);
  gap: 12px;
}

.stage-panel {
  min-width: 0;
}

.stage-scroll {
  overflow: auto;
  padding: 18px;
  background: #182633;
}

.stage-canvas {
  position: relative;
  width: 100%;
  min-width: 540px;
  aspect-ratio: 16 / 9;
  transform-origin: left top;
  background: #eef1eb;
  box-shadow: 0 12px 30px rgb(0 0 0 / 24%);
}

.stage-label,
.led-strip {
  position: absolute;
  z-index: 2;
  left: 50%;
  transform: translateX(-50%);
  color: #67727a;
  font-size: 10px;
  letter-spacing: 0.2em;
}

.stage-label {
  bottom: 1.6%;
}

.led-strip {
  top: 2.7%;
}

.stage-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.backstage {
  fill: #d8ddd6;
  opacity: 0.75;
}

.apron {
  fill: #dfe5df;
  opacity: 0.65;
}

.center-line {
  stroke: #9aa6a2;
  stroke-width: 0.2;
  stroke-dasharray: 1 1;
}

/* 区域 */
.area-body {
  fill: rgb(122 96 58 / 42%);
  stroke: #7a5f34;
  stroke-width: 0.35;
  cursor: pointer;
}

.area-body.mechanical {
  fill: rgb(167 84 62 / 40%);
  stroke: #a4503c;
}

.area-body.active {
  stroke-width: 0.9;
}

.area-safety {
  fill: rgb(214 166 74 / 12%);
  stroke: #c9912f;
  stroke-width: 0.25;
  stroke-dasharray: 1.2 1;
  cursor: pointer;
}

.area-safety.mechanical {
  fill: rgb(196 75 60 / 10%);
  stroke: #c44b3c;
}

.area-safety.active {
  stroke-width: 0.7;
}

.area-label {
  fill: #3f3320;
  font-size: 2.1px;
  font-weight: 700;
  pointer-events: none;
}

/* 路线状态色 */
.route {
  fill: none;
  stroke: #4a8e8b;
  stroke-width: 0.75;
  stroke-linejoin: round;
}

.route.route-rerouted {
  stroke: #d1842a;
  stroke-dasharray: 2.4 1.3;
}

.route.route-blocked {
  stroke: #cc4f42;
  stroke-dasharray: 2 1.2;
  stroke-width: 0.9;
}

.route.route-review {
  stroke: #8a63c9;
  stroke-dasharray: 1.4 1.4;
}

.route.route-fixed {
  stroke: #93a0aa;
  stroke-width: 0.5;
  opacity: 0.7;
}

.route.selected {
  stroke-width: 1.3;
}

.route.conflict {
  stroke: #cc4f42;
}

.cue-point circle {
  fill: #fff;
  stroke: #247d7b;
  stroke-width: 0.7;
}

.cue-point text {
  fill: #213d46;
  font-size: 2.2px;
  font-weight: 800;
  cursor: pointer;
}

.cue-point.selected circle {
  fill: #f7b54b;
  stroke: #9f4a17;
  stroke-width: 1;
}

.waypoint {
  fill: #f2a43c;
  stroke: #8a4d12;
  stroke-width: 0.4;
}

.waypoint-blocked,
.waypoint-review {
  fill: #d85c4f;
}

.exit-point {
  fill: #bb4d3e;
  stroke: #fff;
  stroke-width: 0.5;
}

.crossing-mark circle {
  fill: none;
  stroke: #c0271d;
  stroke-width: 0.5;
}

.crossing-mark line {
  stroke: #c0271d;
  stroke-width: 0.7;
}

.stage-legend {
  position: absolute;
  right: 2%;
  bottom: 3%;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  max-width: 62%;
  padding: 6px 8px;
  color: #44515b;
  background: rgb(255 255 255 / 88%);
  font-size: 10px;
}

.stage-legend i {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 4px;
  border-radius: 2px;
}

.stage-legend .entry {
  border-radius: 50%;
  background: #247d7b;
}

.stage-legend .way {
  border-radius: 50%;
  background: #f2a43c;
}

.stage-legend .exit {
  border-radius: 50%;
  background: #bb4d3e;
}

.stage-legend .area-legend {
  background: rgb(122 96 58 / 60%);
  border: 1px solid #7a5f34;
}

.stage-legend .safety-legend {
  background: rgb(214 166 74 / 20%);
  border: 1px dashed #c9912f;
}

.stage-legend .cross-legend {
  background: #c0271d;
}

.editor-panel {
  max-height: 760px;
  overflow: auto;
}

.editor {
  padding: 16px;
}

.editor-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 14px;
}

.editor-title span {
  color: #6b7883;
  font-size: 11px;
}

.editor-title h3 {
  margin: 4px 0 0;
  font-size: 18px;
}

.spatial-box {
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid #d5dee3;
  border-radius: 8px;
  background: #f6f9f9;
}

.spatial-box.is-blocked {
  border-color: #d98a80;
  background: #fdf1ef;
}

.spatial-box.is-rerouted {
  border-color: #dfb166;
  background: #fdf7ea;
}

.spatial-box.is-review {
  border-color: #b39edd;
  background: #f6f2fc;
}

.spatial-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.issue-list {
  margin: 8px 0 4px;
  padding-left: 16px;
  color: #596673;
  font-size: 12px;
  line-height: 1.6;
}

.issue-list li.blocked {
  color: #b03d31;
}

.issue-list li.review {
  color: #6b4ea8;
}

.spatial-ok {
  margin: 7px 0 0;
  color: #4d8a62;
  font-size: 12px;
}

.spatial-actions {
  margin-top: 6px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.route-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.route-summary span {
  padding: 3px 6px;
  border: 1px solid #dbe2e5;
  border-radius: 4px;
  color: #53606c;
  background: #f6f8f8;
  font-size: 11px;
}

.route-summary .anchor-point {
  border-color: #bcd2d0;
  color: #1d5f5c;
  font-weight: 700;
}

.comment-block {
  padding-top: 12px;
  border-top: 1px solid #e4e9eb;
}

.comment-head {
  margin-bottom: 8px;
  font-size: 13px;
}

.comment-list {
  display: grid;
  gap: 8px;
  max-height: 190px;
  overflow: auto;
}

.comment {
  padding: 9px;
  border: 1px solid #e5eaec;
  border-radius: 6px;
  background: #f9fafa;
}

.comment.resolved {
  opacity: 0.65;
}

.comment div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}

.comment time {
  color: #87929b;
}

.comment p {
  margin: 6px 0 3px;
  font-size: 12px;
  line-height: 1.5;
}

.comment-input {
  display: flex;
  gap: 7px;
  margin-top: 10px;
}

/* 区域登记 */
.area-panel {
  margin-top: 12px;
}

.area-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.area-table-wrap {
  overflow-x: auto;
}

.area-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.area-table th {
  padding: 9px 12px;
  color: #5c6a76;
  text-align: left;
  background: #f3f6f7;
  border-bottom: 1px solid #e2e8eb;
  font-weight: 600;
}

.area-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #edf1f3;
  vertical-align: middle;
}

.area-table tbody tr {
  cursor: pointer;
}

.area-table tbody tr:hover {
  background: #f7faf9;
}

.area-table tbody tr.selected {
  background: #eef7f5;
}

.area-table td strong {
  margin-right: 8px;
}

.area-table .mono {
  font-family: ui-monospace, monospace;
  color: #31525c;
}

.area-actions {
  display: flex;
  gap: 6px;
  white-space: nowrap;
}

.lock-badge {
  color: #b05a2b;
  font-weight: 700;
}

.pending-badge {
  margin-left: 6px;
  padding: 1px 6px;
  color: #9a6212;
  background: #fbe8c7;
  border-radius: 4px;
}

.area-foot {
  margin: 10px 14px 12px;
  font-size: 11px;
  line-height: 1.6;
}

.dialog-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}

.dialog-lock-alert {
  margin-bottom: 10px;
}

.bounds-grid,
.time-window-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.cue-strip {
  margin-top: 12px;
}

.cue-cards {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 12px;
}

.cue-card {
  display: flex;
  min-width: 200px;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 11px;
  border: 1px solid #dce3e7;
  border-radius: 7px;
  text-align: left;
  background: #fff;
  cursor: pointer;
}

.cue-card.active {
  border-color: #2f8580;
  box-shadow: 0 0 0 2px rgb(47 133 128 / 14%);
}

.cue-card.conflict {
  border-left: 4px solid #cf5b3f;
}

.cue-card span,
.cue-card small {
  display: block;
  color: #76838e;
  font-size: 10px;
}

.cue-card strong {
  display: block;
  margin: 2px 0;
  font-size: 13px;
}

@media (max-width: 1080px) {
  .work-grid {
    grid-template-columns: 1fr;
  }

  .editor-panel {
    max-height: none;
  }
}

@media (max-width: 760px) {
  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .form-grid,
  .dialog-grid {
    grid-template-columns: 1fr;
  }
}
</style>
