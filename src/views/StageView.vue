<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  useWorkshopStore,
  routeStatusLabel,
  type Cue,
  type Department,
  type StageArea,
} from '../stores/workshop'
import { inflateRect, type Point, type Rect } from '../staging/geometry'

const store = useWorkshopStore()
const commentText = ref('')
const showRouteEditor = ref(true)
const departments: Array<'全部' | Department> = ['全部', '舞台', '灯光', '音响', '道具']
const acts = ['全部', '第一幕', '第二幕', '第三幕']

const cue = computed(() => store.selectedCue)
const routePoints = computed(() => cue.value?.route.map((point) => `${point.x},${point.y}`).join(' ') ?? '')
const conflictCues = computed(() => new Set(store.conflicts.map((item) => item.id)))

// ---- 区域编辑模式 ----
const editMode = ref<'route' | 'area'>('route')
const svgEl = ref<SVGSVGElement | null>(null)
const selectedAreaId = ref<string | null>(null)
const drawing = ref(false)
const drawStart = ref<Point | null>(null)
const drawRect = ref<Rect | null>(null)

const selectedArea = computed<StageArea | null>(
  () => store.areas.find((area) => area.id === selectedAreaId.value) ?? null,
)

const crossingMarkers = computed(() => {
  const markers: Array<{ x: number; y: number; cueId: string }> = []
  for (const item of store.cues) {
    for (const issue of item.routeIssues ?? []) {
      if (issue.type === 'crossing' && issue.point) {
        markers.push({ x: issue.point.x, y: issue.point.y, cueId: item.id })
      }
    }
  }
  return markers
})

function routeStatus(cueItem: Cue): string {
  // 综合状态：blocked / legacy / crossing / adjusted / clear
  if (cueItem.routeState === 'blocked') return 'blocked'
  if (cueItem.routeState === 'legacy') return 'legacy'
  if (cueItem.routeIssues?.some((issue) => issue.type === 'crossing')) return 'crossing'
  return cueItem.routeState ?? 'legacy'
}

function statusTagType(status: string): 'success' | 'warning' | 'danger' | 'info' | 'primary' {
  if (status === 'clear' || status === 'adjusted') return 'success'
  if (status === 'blocked') return 'danger'
  if (status === 'crossing') return 'warning'
  return 'info'
}

function selectCue(item: Cue) {
  store.selectedId = item.id
}

function toSvgPoint(event: PointerEvent): Point {
  const svg = svgEl.value
  if (!svg) return { x: 0, y: 0 }
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const pt = svg.createSVGPoint()
  pt.x = event.clientX
  pt.y = event.clientY
  const p = pt.matrixTransform(ctm.inverse())
  return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }
}

function onSvgPointerDown(event: PointerEvent) {
  if (editMode.value !== 'area' || store.locked) return
  if ((event.target as SVGElement).closest('.area-shape')) return
  drawing.value = true
  drawStart.value = toSvgPoint(event)
  drawRect.value = null
  selectedAreaId.value = null
}

function onSvgPointerMove(event: PointerEvent) {
  if (!drawing.value || !drawStart.value) return
  const p = toSvgPoint(event)
  drawRect.value = {
    x: Math.min(drawStart.value.x, p.x),
    y: Math.min(drawStart.value.y, p.y),
    w: Math.abs(p.x - drawStart.value.x),
    h: Math.abs(p.y - drawStart.value.y),
  }
}

async function onSvgPointerUp() {
  if (!drawing.value) return
  drawing.value = false
  const rect = drawRect.value
  drawRect.value = null
  if (!rect || rect.w < 2 || rect.h < 2) return
  const result = await store.addArea({ rect })
  if (result.ok) {
    ElMessage.success('区域已登记，路线已按安全间隔重算')
    selectedAreaId.value = store.areas[store.areas.length - 1]?.id ?? null
  }
}

function onSvgClick(event: MouseEvent) {
  if (editMode.value !== 'route' || !showRouteEditor.value || store.locked) return
  const target = event.currentTarget as SVGElement
  const rect = target.getBoundingClientRect()
  const x = Math.round(((event.clientX - rect.left) / rect.width) * 100)
  const y = Math.round(((event.clientY - rect.top) / rect.height) * 100)
  store.addWaypoint({ x, y })
  ElMessage.success('已追加路线节点')
}

function selectArea(area: StageArea) {
  if (editMode.value !== 'area') return
  selectedAreaId.value = area.id
}

async function saveAreaPatch(patch: Partial<StageArea>) {
  if (!selectedArea.value) return
  const result = await store.updateArea(selectedArea.value.id, patch)
  if (result.conflict) {
    ElMessage.error(`先到者已保存该区域，你的修改未生效（版本冲突）`)
  }
}

async function removeSelectedArea() {
  if (!selectedArea.value) return
  try {
    await ElMessageBox.confirm(`删除区域 ${selectedArea.value.id} ${selectedArea.value.name}？受影响路线将立即重算。`, '删除区域', {
      type: 'warning',
    })
  } catch {
    return
  }
  const result = await store.removeArea(selectedArea.value.id)
  if (result.conflict) {
    ElMessage.error('先到者已更新该区域，删除未生效')
  } else {
    selectedAreaId.value = null
    ElMessage.success('区域已删除')
  }
}

async function simulateCollaborator() {
  if (!selectedArea.value) return
  await store.simulateCollaboratorEdit(selectedArea.value.id)
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

function areaRect(area: StageArea): Rect {
  return area.rect
}

function areaHalo(area: StageArea): Rect {
  return inflateRect(area.rect, area.clearance)
}
</script>

<template>
  <section class="page stage-page">
    <div class="page-head">
      <div>
        <p class="eyebrow">STAGING / 走位编排</p>
        <h1>舞台平面与执行提示</h1>
        <p class="muted">布景与机械区登记占用范围和安全间隔，路线自动绕开；入场退场点固定，只调中间节点。</p>
      </div>
      <div class="actions">
        <el-button :disabled="!store.canUndo || store.locked" @click="store.undo()">撤销</el-button>
        <el-button :disabled="!store.canRedo || store.locked" @click="store.redo()">重做</el-button>
        <el-button type="primary" @click="saveCue">{{ store.isOffline ? '保存草稿' : '同步版本' }}</el-button>
      </div>
    </div>

    <el-alert
      v-if="store.routeAlerts.length"
      class="conflict-alert"
      type="warning"
      show-icon
      :closable="false"
      :title="`${store.routeAlerts.length} 条走位待处理：无法绕行 ${store.cues.filter((c) => c.routeState === 'blocked').length} · 待复核 ${store.cues.filter((c) => c.routeState === 'legacy').length} · 交叉 ${store.routeAlerts.filter((c) => c.routeIssues?.some((i) => i.type === 'crossing')).length}`"
      description="范围变化已重算受影响路线；无法绕行的提示已注明冲突路段与区域，打印清单同步标记。"
    />

    <el-alert
      v-if="store.conflicts.length"
      class="conflict-alert"
      type="info"
      show-icon
      :closable="false"
      :title="`发现 ${store.conflicts.length} 个同时触发节点`"
      description="系统已高亮冲突提示，请在右侧检查触发时间与部门优先级。"
    />

    <div class="toolbar panel">
      <el-radio-group v-model="editMode" size="small" :disabled="store.locked">
        <el-radio-button value="route">走位编辑</el-radio-button>
        <el-radio-button value="area">布景 / 机械区</el-radio-button>
      </el-radio-group>
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
      <el-button @click="store.addCue" :disabled="store.locked">新增提示</el-button>
      <el-tag :type="store.locked ? 'success' : 'info'" effect="plain">{{ store.locked ? '基线已锁定' : '草稿编辑中' }}</el-tag>
    </div>

    <div class="work-grid">
      <section class="panel stage-panel">
        <div class="panel-head">
          <h3>舞台平面图 · 主视图</h3>
          <span class="muted">{{ editMode === 'area' ? '在空白处拖拽绘制占用范围，点击区域编辑' : '点击地面追加路线节点' }}</span>
        </div>
        <div class="stage-scroll">
          <div class="stage-canvas" :style="{ transform: `scale(${store.zoom / 100})` }">
            <div class="stage-label">观众席</div>
            <div class="led-strip">LED 背景幕</div>
            <svg
              ref="svgEl"
              class="stage-svg"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              @click="onSvgClick"
              @pointerdown="onSvgPointerDown"
              @pointermove="onSvgPointerMove"
              @pointerup="onSvgPointerUp"
            >
              <defs>
                <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
                  <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#cbd6da" stroke-width="0.15" />
                </pattern>
                <marker id="arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                  <path d="M0,0 L5,2.5 L0,5 z" fill="#287d7c" />
                </marker>
                <marker id="arrow-blocked" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                  <path d="M0,0 L5,2.5 L0,5 z" fill="#cc4f42" />
                </marker>
              </defs>
              <rect width="100" height="100" fill="url(#grid)" />
              <rect x="3" y="2" width="94" height="12" rx="1" class="backstage" />
              <rect x="5" y="88" width="90" height="9" rx="1" class="apron" />
              <line x1="50" y1="14" x2="50" y2="88" class="center-line" />

              <!-- 布景 / 机械区：占用范围 + 安全间隔光晕 -->
              <g
                v-for="area in store.areas"
                :key="area.id"
                class="area-shape"
                :class="{ selected: area.id === selectedAreaId, editable: editMode === 'area' }"
                @click.stop="selectArea(area)"
              >
                <rect
                  :x="areaHalo(area).x"
                  :y="areaHalo(area).y"
                  :width="areaHalo(area).w"
                  :height="areaHalo(area).h"
                  fill="none"
                  :stroke="area.color"
                  stroke-width="0.22"
                  stroke-dasharray="1.3 1.1"
                />
                <rect
                  :x="areaRect(area).x"
                  :y="areaRect(area).y"
                  :width="areaRect(area).w"
                  :height="areaRect(area).h"
                  :fill="area.color"
                  fill-opacity="0.18"
                  :stroke="area.color"
                  stroke-width="0.4"
                />
                <text :x="area.rect.x + 0.8" :y="area.rect.y + 2.6" class="area-label">
                  {{ area.id }} {{ area.name }}
                </text>
                <text :x="area.rect.x + 0.8" :y="area.rect.y + area.rect.h - 0.8" class="area-kind">
                  {{ area.kind }} · 间隔 {{ area.clearance }}
                </text>
              </g>

              <!-- 绘制中的预览矩形 -->
              <rect
                v-if="drawRect"
                :x="drawRect.x"
                :y="drawRect.y"
                :width="drawRect.w"
                :height="drawRect.h"
                fill="#4f7fb0"
                fill-opacity="0.12"
                stroke="#4f7fb0"
                stroke-width="0.35"
                stroke-dasharray="1 0.8"
              />

              <!-- 走位路线 -->
              <template v-for="item in store.filteredCues" :key="item.id">
                <polyline
                  v-if="item.route.length > 1"
                  :points="item.route.map((point) => `${point.x},${point.y}`).join(' ')"
                  :class="['route', `route-${routeStatus(item)}`, { selected: item.id === store.selectedId, conflict: conflictCues.has(item.id) }]"
                  :marker-end="routeStatus(item) === 'blocked' ? 'url(#arrow-blocked)' : 'url(#arrow)'"
                />
                <g v-if="routeStatus(item) === 'blocked'" class="route-blocked-mark">
                  <circle
                    :cx="(item.entry.x + item.exit.x) / 2"
                    :cy="(item.entry.y + item.exit.y) / 2"
                    r="2.2"
                    fill="#cc4f42"
                    stroke="#fff"
                    stroke-width="0.4"
                  />
                  <text :x="(item.entry.x + item.exit.x) / 2 + 2.6" :y="(item.entry.y + item.exit.y) / 2 + 0.8">无法绕行</text>
                </g>
                <g class="cue-point" :class="{ selected: item.id === store.selectedId }" @click.stop="selectCue(item)">
                  <circle :cx="item.entry.x" :cy="item.entry.y" r="2.8" />
                  <text :x="item.entry.x + 3.2" :y="item.entry.y + 1">{{ item.id }}</text>
                </g>
              </template>

              <!-- 同时段走位交叉点 -->
              <g v-for="(marker, index) in crossingMarkers" :key="`${marker.cueId}-${index}`" class="crossing-marker">
                <circle :cx="marker.x" :cy="marker.y" r="1.7" fill="#cf5b3f" stroke="#fff" stroke-width="0.35" />
              </g>

              <template v-if="cue">
                <circle v-for="(point, index) in cue.route.slice(1, -1)" :key="index" :cx="point.x" :cy="point.y" r="1.5" class="waypoint" />
                <circle :cx="cue.exit.x" :cy="cue.exit.y" r="2.5" class="exit-point" />
              </template>
            </svg>
            <div class="stage-legend">
              <span><i class="entry" />入场</span>
              <span><i class="way" />路线</span>
              <span><i class="exit" />退场</span>
              <span><i class="area-sample" />布景 / 机械区</span>
              <span><i class="cross-sample" />交叉点</span>
            </div>
          </div>
        </div>
      </section>

      <aside class="panel editor-panel">
        <!-- 区域编辑面板 -->
        <div v-if="editMode === 'area'" class="editor area-editor">
          <div class="editor-title">
            <div>
              <span>空间登记</span>
              <h3>布景 / 机械区</h3>
            </div>
            <el-tag type="info" effect="plain">{{ store.areas.length }} 块</el-tag>
          </div>
          <el-empty v-if="!selectedArea" description="在左侧舞台拖拽绘制一块区域" :image-size="56" />
          <template v-else>
            <el-form label-position="top" size="small" :disabled="store.locked">
              <div class="form-grid">
                <el-form-item label="区域编号">
                  <el-input :model-value="selectedArea.id" disabled />
                </el-form-item>
                <el-form-item label="类型">
                  <el-select :model-value="selectedArea.kind" @update:model-value="saveAreaPatch({ kind: $event as StageArea['kind'] })">
                    <el-option label="布景" value="布景" />
                    <el-option label="机械区" value="机械区" />
                  </el-select>
                </el-form-item>
              </div>
              <el-form-item label="名称">
                <el-input :model-value="selectedArea.name" @update:model-value="saveAreaPatch({ name: $event as string })" />
              </el-form-item>
              <div class="form-grid">
                <el-form-item label="X">
                  <el-input-number :model-value="selectedArea.rect.x" :min="0" :max="99" :step="1" controls-position="right" style="width: 100%" @update:model-value="saveAreaPatch({ rect: { ...selectedArea.rect, x: Number($event) } })" />
                </el-form-item>
                <el-form-item label="Y">
                  <el-input-number :model-value="selectedArea.rect.y" :min="0" :max="99" :step="1" controls-position="right" style="width: 100%" @update:model-value="saveAreaPatch({ rect: { ...selectedArea.rect, y: Number($event) } })" />
                </el-form-item>
                <el-form-item label="宽">
                  <el-input-number :model-value="selectedArea.rect.w" :min="1" :max="100" :step="1" controls-position="right" style="width: 100%" @update:model-value="saveAreaPatch({ rect: { ...selectedArea.rect, w: Number($event) } })" />
                </el-form-item>
                <el-form-item label="高">
                  <el-input-number :model-value="selectedArea.rect.h" :min="1" :max="100" :step="1" controls-position="right" style="width: 100%" @update:model-value="saveAreaPatch({ rect: { ...selectedArea.rect, h: Number($event) } })" />
                </el-form-item>
              </div>
              <el-form-item label="演员安全间隔（舞台单位）">
                <el-slider
                  :model-value="selectedArea.clearance"
                  :min="0"
                  :max="8"
                  :step="0.5"
                  show-input
                  @update:model-value="saveAreaPatch({ clearance: Number($event) })"
                />
              </el-form-item>
              <el-form-item label="颜色">
                <el-color-picker :model-value="selectedArea.color" @update:model-value="saveAreaPatch({ color: $event as string })" />
              </el-form-item>
            </el-form>
            <p class="area-meta">
              版本 v{{ selectedArea.version }} · {{ selectedArea.updatedBy }} · {{ selectedArea.updatedAt }}
            </p>
            <div class="area-actions">
              <el-button size="small" @click="simulateCollaborator">模拟协作者先保存</el-button>
              <el-button size="small" type="danger" plain @click="removeSelectedArea">删除区域</el-button>
            </div>
            <el-alert
              class="area-concurrency-hint"
              type="info"
              :closable="false"
              title="两人同时修改同一块区域时，先到者生效；离线修改回网后按区域编号合并。"
            />
          </template>
        </div>

        <!-- 提示编辑面板 -->
        <div v-else-if="cue" class="editor">
          <div class="editor-title">
            <div>
              <span>{{ cue.id }} · {{ cue.act }}</span>
              <h3>{{ cue.title }}</h3>
            </div>
            <el-tag :type="cue.status === '已确认' ? 'success' : 'warning'" effect="plain">{{ cue.status }}</el-tag>
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
              <el-form-item label="责任角色">
                <el-input :model-value="cue.owner" @update:model-value="updateCue('owner', $event)" />
              </el-form-item>
            </div>
            <el-form-item label="执行说明">
              <el-input type="textarea" :rows="3" :model-value="cue.note" @update:model-value="updateCue('note', $event)" />
            </el-form-item>

            <el-form-item label="路线状态">
              <div class="route-status-box" :class="`status-${routeStatus(cue)}`">
                <div class="route-status-head">
                  <el-tag :type="statusTagType(routeStatus(cue))" effect="dark" size="small">
                    {{ routeStatusLabel[routeStatus(cue)] }}
                  </el-tag>
                  <el-button size="small" @click="store.reviewCue(cue.id)">复核此路线</el-button>
                </div>
                <p v-if="cue.routeInfo?.length" class="route-info">已自动绕过：{{ cue.routeInfo.join('、') }}</p>
                <ul v-if="cue.routeIssues?.length" class="route-issues">
                  <li v-for="(issue, index) in cue.routeIssues" :key="index">
                    <el-tag
                      size="small"
                      :type="issue.type === 'blocked' ? 'danger' : issue.type === 'crossing' ? 'warning' : 'info'"
                      effect="plain"
                    >
                      {{ issue.type === 'blocked' ? '冲突' : issue.type === 'crossing' ? '交叉' : '待复核' }}
                    </el-tag>
                    <span>{{ issue.detail }}</span>
                  </li>
                </ul>
                <p v-if="!cue.routeIssues?.length && !cue.routeInfo?.length" class="route-ok">路线未与任何登记区域冲突。</p>
              </div>
            </el-form-item>

            <el-form-item label="路线节点 / 触发时机">
              <div class="route-summary">
                <span v-for="(point, index) in cue.route" :key="index">{{ index === 0 ? '入' : index === cue.route.length - 1 ? '出' : index }} ({{ point.x }},{{ point.y }})</span>
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

    <section class="panel cue-strip">
      <div class="panel-head">
        <h3>脚本节点（{{ store.filteredCues.length }}）</h3>
        <span class="muted">按执行时间排序 · 红点为路线待处理</span>
      </div>
      <div class="cue-cards">
        <button
          v-for="item in [...store.filteredCues].sort((a, b) => a.time.localeCompare(b.time))"
          :key="item.id"
          class="cue-card"
          :class="{ active: item.id === store.selectedId, conflict: conflictCues.has(item.id) }"
          @click="selectCue(item)"
        >
          <span class="cue-card-top">
            <span>{{ item.id }} · {{ item.department }}</span>
            <i class="route-dot" :class="`dot-${routeStatus(item)}`" :title="routeStatusLabel[routeStatus(item)]" />
          </span>
          <strong>{{ item.title }}</strong>
          <small>{{ item.time }} · {{ item.duration }} 秒 · {{ routeStatusLabel[routeStatus(item)] }}</small>
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.stage-page {
  background: #eef2f4;
}

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

.toolbar > :nth-last-child(2) {
  margin-left: auto;
}

.work-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.75fr);
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
  touch-action: none;
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

.area-shape {
  cursor: default;
}

.area-shape.editable {
  cursor: pointer;
}

.area-shape.selected rect:last-of-type {
  stroke-width: 0.7;
}

.area-label {
  fill: #243742;
  font-size: 2.6px;
  font-weight: 700;
  pointer-events: none;
}

.area-kind {
  fill: #5c6b76;
  font-size: 1.9px;
  pointer-events: none;
}

.route {
  fill: none;
  stroke: #4a8e8b;
  stroke-width: 0.75;
  stroke-linejoin: round;
}

.route.route-blocked {
  stroke: #cc4f42;
  stroke-width: 0.9;
  stroke-dasharray: 2.4 1.3;
}

.route.route-legacy {
  stroke: #9aa6ad;
  stroke-width: 0.7;
  stroke-dasharray: 1.6 1.4;
}

.route.selected {
  stroke: #c36e23;
  stroke-width: 1.1;
}

.route.selected.route-blocked {
  stroke: #c36e23;
}

.route.conflict {
  stroke: #cc4f42;
  stroke-dasharray: 2 1.2;
}

.route-blocked-mark text {
  fill: #cc4f42;
  font-size: 2.4px;
  font-weight: 700;
}

.crossing-marker circle {
  pointer-events: none;
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

.exit-point {
  fill: #bb4d3e;
  stroke: #fff;
  stroke-width: 0.5;
}

.stage-legend {
  position: absolute;
  right: 2%;
  bottom: 3%;
  z-index: 3;
  display: flex;
  gap: 10px;
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
  border-radius: 50%;
}

.stage-legend .entry {
  background: #247d7b;
}

.stage-legend .way {
  background: #f2a43c;
}

.stage-legend .exit {
  background: #bb4d3e;
}

.stage-legend .area-sample {
  border: 1px dashed #6b7f8a;
  border-radius: 2px;
  background: rgb(200 121 74 / 25%);
}

.stage-legend .cross-sample {
  background: #cf5b3f;
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

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.route-status-box {
  padding: 9px 10px;
  border: 1px solid #e2e8eb;
  border-radius: 6px;
  background: #f7faf9;
}

.route-status-box.status-blocked {
  border-color: #e6b8b1;
  background: #fdf3f1;
}

.route-status-box.status-legacy {
  border-color: #d8dee2;
  background: #f4f6f7;
}

.route-status-box.status-crossing {
  border-color: #e8c9a0;
  background: #fdf8ef;
}

.route-status-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.route-info {
  margin: 7px 0 0;
  color: #4a7a5a;
  font-size: 12px;
}

.route-ok {
  margin: 7px 0 0;
  color: #7a8791;
  font-size: 12px;
}

.route-issues {
  margin: 7px 0 0;
  padding: 0;
  list-style: none;
}

.route-issues li {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 5px;
  color: #5d6b78;
  font-size: 12px;
  line-height: 1.5;
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

.area-meta {
  margin: 4px 0 10px;
  color: #8a969f;
  font-size: 11px;
}

.area-actions {
  display: flex;
  gap: 8px;
}

.area-concurrency-hint {
  margin-top: 12px;
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
  min-width: 190px;
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

.cue-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.cue-card span,
.cue-card small {
  display: block;
  color: #76838e;
  font-size: 10px;
}

.cue-card strong {
  display: block;
  margin: 6px 0;
  font-size: 13px;
}

.route-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4a8e8b;
}

.route-dot.dot-adjusted {
  background: #4a8e8b;
}

.route-dot.dot-blocked {
  background: #cc4f42;
}

.route-dot.dot-legacy {
  background: #9aa6ad;
}

.route-dot.dot-crossing {
  background: #cf5b3f;
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

  .toolbar > :nth-last-child(2) {
    margin-left: 0;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
