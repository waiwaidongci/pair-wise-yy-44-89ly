// 舞台空间事实层：布景 / 机械区、走位节点、执行提示、打印清单共用这一套类型。
// 舞台平面统一使用 0–100 的相对坐标（x：左→右，y：后台→观众）。

export type Point = { x: number; y: number }

export type Rect = { x: number; y: number; width: number; height: number }

export type AreaKind = '布景' | '机械区'

/**
 * 一块布景或机械区。
 * - bounds：物理占用范围；
 * - clearance：演员安全间隔（网格单位），路线必须落在 bounds 外扩 clearance 之后；
 * - timeWindow：留空表示整场占用（固定布景）；填写后只在该时间窗内对演员路线生效；
 * - revision：服务器对该“区域编号”的最新版本号，离线合并按 id 对齐。
 */
export type StageArea = {
  id: string
  name: string
  kind: AreaKind
  bounds: Rect
  clearance: number
  timeWindow: { start: string; end: string } | null
  note: string
  updatedAt: string
  updatedBy: string
  revision: number
}

/** 提示类别：演员走位需要绕障；机械动作与固定灯位不走演员路径。 */
export type CueKind = '演员走位' | '机械动作' | '固定灯位'

export type RouteIssue = {
  /** blocking：与布景/机械区打架；crossing：同一时段两条走位交叉 */
  type: 'blocking' | 'crossing'
  severity: 'blocked' | 'review'
  /** 从入场点起的第几段路线（1 = 入→节点1） */
  segmentIndex?: number
  areaId?: string
  areaName?: string
  otherCueId?: string
  otherCueTitle?: string
  overlapSeconds?: number
  message: string
}

export type CueSpatialStatus = 'ok' | 'rerouted' | 'blocked' | 'review' | 'fixed'

/** 某条走位与另一条走位在同一时间窗内的交叉点（用于平面图标红）。 */
export type CrossingMark = {
  cueId: string
  otherCueId: string
  point: Point
}
