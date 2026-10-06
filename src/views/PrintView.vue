<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useWorkshopStore } from '../stores/workshop'
import type { CueSpatialStatus, RouteIssue } from '../spatial/types'

const store = useWorkshopStore()
const includeNotes = ref(true)
const includeRoutes = ref(true)
const includeComments = ref(false)
const includeSpatial = ref(true)

const statusPrint: Record<CueSpatialStatus, string> = {
  ok: '路线畅通',
  rerouted: '已按新范围绕行',
  blocked: '排不出来·禁用',
  review: '待复核·旧路线',
  fixed: '非走位提示',
}

const sortedCues = computed(() =>
  [...store.cues].sort((a, b) => a.time.localeCompare(b.time)).map((cue) => ({
    cue,
    report: store.reportOf(cue.id),
    route: store.effectiveRoute(cue.id),
    status: store.statusOf(cue.id) as CueSpatialStatus,
  })),
)

const problemRows = computed(() => sortedCues.value.filter((row) => row.status === 'blocked' || row.status === 'review'))
const generatedAt = new Date().toLocaleString('zh-CN')

function print() {
  window.print()
}

function exportCsv() {
  const rows = [
    ['编号', '时间码', '场景', '提示', '部门', '责任', '空间状态', '空间问题说明', '路线节点', '状态'],
    ...sortedCues.value.map(({ cue, status, report, route }) => [
      cue.id,
      cue.time,
      `${cue.act}/${cue.scene}`,
      cue.title,
      cue.department,
      cue.owner,
      statusPrint[status],
      report?.issues.map((issue: RouteIssue) => issue.message).join(' / ') ?? '',
      route.map((point) => `${point.x},${point.y}`).join(' > '),
      cue.status,
    ]),
  ]
  const csv = `﻿${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `潮汐来信-走位表-${store.revision}.csv`
  link.click()
  URL.revokeObjectURL(url)
  ElMessage.success('走位表已导出（含空间状态列）')
}
</script>

<template>
  <section class="page print-page">
    <div class="page-head no-print">
      <div>
        <p class="eyebrow">PRINT / 演出文档</p>
        <h1>走位表与执行清单</h1>
        <p class="muted">清单与舞台平面图共用同一套空间事实，范围一变重算结果会同步到这里。</p>
      </div>
      <div class="actions">
        <el-button @click="exportCsv">导出 CSV</el-button>
        <el-button type="primary" @click="print">打印 / 导出 PDF</el-button>
      </div>
    </div>

    <div class="print-options panel no-print">
      <strong>文档内容</strong>
      <el-checkbox v-model="includeNotes">执行说明</el-checkbox>
      <el-checkbox v-model="includeRoutes">路线坐标</el-checkbox>
      <el-checkbox v-model="includeSpatial">空间校验结果</el-checkbox>
      <el-checkbox v-model="includeComments">未解决留言</el-checkbox>
      <span class="print-revision">版本 {{ store.revision }} · 生成于 {{ generatedAt }}</span>
    </div>

    <el-alert
      v-if="problemRows.length"
      class="no-print print-warning"
      type="error"
      show-icon
      :closable="false"
      title="打印前必须处理：清单内仍有未弄清的空间问题"
      :description="`${problemRows.map((row) => row.cue.id).join('、')} 已在表内标红；其中“排不出来”的走位不得作为执行依据。`"
    />

    <article class="print-sheet">
      <header class="sheet-head">
        <div>
          <span>远岸剧团 · STAGE MANAGEMENT</span>
          <h2>《潮汐来信》执行清单</h2>
        </div>
        <dl>
          <div><dt>排练日</dt><dd>2026-10-08</dd></div>
          <div><dt>版本</dt><dd>{{ store.revision }}</dd></div>
          <div><dt>场地</dt><dd>上海大剧院 · 大剧场</dd></div>
        </dl>
      </header>

      <div v-if="problemRows.length" class="sheet-banner">
        ⚠ 本版有 {{ problemRows.length }} 条走位未通过空间校验（已在表中标出），弄清前不得据此执行：
        {{ problemRows.map((row) => `${row.cue.id} ${statusPrint[row.status]}`).join('；') }}
      </div>

      <table>
        <thead>
          <tr>
            <th>时间码</th>
            <th>幕 / 场</th>
            <th>执行提示</th>
            <th>部门 / 责任</th>
            <th>时长</th>
            <th v-if="includeSpatial">空间校验</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in sortedCues" :key="row.cue.id" :class="{ 'row-blocked': row.status === 'blocked', 'row-review': row.status === 'review' }">
            <td class="mono">{{ row.cue.time }}</td>
            <td>{{ row.cue.act }} / {{ row.cue.scene }}</td>
            <td>
              <strong>{{ row.cue.id }} · {{ row.cue.title }}</strong>
              <p v-if="includeNotes">{{ row.cue.note }}</p>
              <small v-if="includeRoutes">
                路线：{{ row.route.map((point, index) => `${index + 1}. ${point.x}/${point.y}`).join(' → ') }}
              </small>
              <template v-if="includeSpatial && row.report?.issues.length">
                <em v-for="(issue, index) in row.report.issues" :key="index" class="issue-line">✱ {{ issue.message }}</em>
              </template>
              <em v-if="includeComments && row.cue.comments.length">
                {{ row.cue.comments.filter((item) => !item.resolved).length }} 条未解决留言
              </em>
            </td>
            <td>{{ row.cue.department }}<br /><small>{{ row.cue.owner }}</small></td>
            <td>{{ row.cue.duration }} 秒</td>
            <td v-if="includeSpatial">
              <b :class="['spatial-status', `status-${row.status}`]">{{ statusPrint[row.status] }}</b>
            </td>
            <td>{{ row.cue.status }}</td>
          </tr>
        </tbody>
      </table>

      <footer class="sheet-foot">
        <span>舞台监督：________________</span>
        <span>技术总监：________________</span>
        <span>制作人：________________</span>
      </footer>
    </article>
  </section>
</template>

<style scoped>
.print-page {
  background: #e8ecee;
}

.print-options {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 14px;
  padding: 12px 15px;
}

.print-revision {
  margin-left: auto;
  color: #74818c;
  font-size: 12px;
}

.print-warning {
  margin-bottom: 14px;
}

.print-sheet {
  max-width: 1180px;
  min-height: 600px;
  margin: 0 auto;
  padding: 34px;
  background: #fff;
  box-shadow: 0 12px 34px rgb(35 54 65 / 12%);
}

.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 18px;
  border-bottom: 3px solid #173846;
}

.sheet-head span {
  color: #697985;
  font-size: 10px;
  letter-spacing: 0.15em;
}

.sheet-head h2 {
  margin: 8px 0 0;
  font-size: 25px;
}

.sheet-head dl {
  display: flex;
  gap: 22px;
  margin: 0;
}

.sheet-head dt {
  color: #818c95;
  font-size: 10px;
}

.sheet-head dd {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 700;
}

.sheet-banner {
  margin-top: 14px;
  padding: 10px 12px;
  border: 2px solid #c0392b;
  border-radius: 4px;
  color: #922;
  background: #fdecea;
  font-size: 12px;
  font-weight: 700;
}

table {
  width: 100%;
  margin-top: 20px;
  border-collapse: collapse;
  font-size: 12px;
}

th {
  padding: 10px 8px;
  color: #fff;
  text-align: left;
  background: #1c4251;
}

td {
  padding: 11px 8px;
  border-bottom: 1px solid #dfe5e8;
  vertical-align: top;
}

tr.row-blocked {
  background: #fdecea;
}

tr.row-blocked td {
  border-bottom-color: #f0c0ba;
}

tr.row-review {
  background: #f5f0fd;
}

td strong,
td small,
td em {
  display: block;
}

td p {
  margin: 5px 0 0;
  color: #56636d;
  line-height: 1.5;
}

td small {
  margin-top: 6px;
  color: #7e8991;
}

td em {
  margin-top: 5px;
  color: #b05a2b;
  font-style: normal;
}

td em.issue-line {
  color: #a93327;
}

.spatial-status {
  font-size: 11px;
}

.spatial-status.status-ok {
  color: #2e7d55;
}

.spatial-status.status-rerouted {
  color: #a96914;
}

.spatial-status.status-blocked {
  color: #b33226;
}

.spatial-status.status-review {
  color: #6b4ea8;
}

.spatial-status.status-fixed {
  color: #7a8791;
}

.mono {
  color: #1d7371;
  font-family: ui-monospace, monospace;
  font-weight: 700;
}

.sheet-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 48px;
  padding-top: 14px;
  border-top: 1px solid #dce2e5;
  color: #69757e;
  font-size: 11px;
}

@media print {
  @page {
    size: A4 landscape;
    margin: 12mm;
  }

  .no-print {
    display: none !important;
  }

  .print-page {
    padding: 0;
    background: #fff;
  }

  .print-sheet {
    max-width: none;
    padding: 0;
    box-shadow: none;
  }

  th {
    color: #111;
    background: #e8ecee;
  }

  tr.row-blocked,
  tr.row-review {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
}

@media (max-width: 760px) {
  .print-options {
    align-items: flex-start;
    flex-direction: column;
  }

  .print-revision {
    margin-left: 0;
  }

  .print-sheet {
    overflow-x: auto;
    padding: 18px;
  }

  .sheet-head {
    flex-direction: column;
  }

  .sheet-head dl {
    flex-wrap: wrap;
  }
}
</style>
