import type { Point, Rect, StageArea } from './types'
import { forbiddenRect, segmentHitsArea } from './geometry'

// 0–100 的舞台被切成 50×50 的寻路网格（每格 2 个相对单位）。
const GRID_N = 50
const STEP = 100 / GRID_N

type Cell = { i: number; j: number }

function cellCenter({ i, j }: Cell): Point {
  return { x: (i + 0.5) * STEP, y: (j + 0.5) * STEP }
}

function nearestCellIndex(value: number): number {
  return Math.max(0, Math.min(GRID_N - 1, Math.round(value / STEP - 0.5)))
}

function buildBlocked(areas: StageArea[]): Uint8Array {
  const blocked = new Uint8Array(GRID_N * GRID_N)
  for (const area of areas) {
    const rect = forbiddenRect(area)
    for (let j = 0; j < GRID_N; j += 1) {
      for (let i = 0; i < GRID_N; i += 1) {
        const p = cellCenter({ i, j })
        if (
          p.x >= rect.x &&
          p.x <= rect.x + rect.width &&
          p.y >= rect.y &&
          p.y <= rect.y + rect.height
        ) {
          blocked[j * GRID_N + i] = 1
        }
      }
    }
  }
  return blocked
}

function isBlocked(blocked: Uint8Array, i: number, j: number): boolean {
  return i < 0 || j < 0 || i >= GRID_N || j >= GRID_N || blocked[j * GRID_N + i] === 1
}

/** 从目标格向外找最近的可通行格；找不到返回 null（目标被禁入区吞掉）。 */
function nearestFreeCell(blocked: Uint8Array, seed: Cell): Cell | null {
  if (!isBlocked(blocked, seed.i, seed.j)) return seed
  const visited = new Set<number>([seed.j * GRID_N + seed.i])
  const queue: Cell[] = [seed]
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  while (queue.length) {
    const current = queue.shift()!
    for (const [di, dj] of neighbors) {
      const i = current.i + di
      const j = current.j + dj
      const key = j * GRID_N + i
      if (i < 0 || j < 0 || i >= GRID_N || j >= GRID_N || visited.has(key)) continue
      if (!isBlocked(blocked, i, j)) return { i, j }
      visited.add(key)
      queue.push({ i, j })
    }
  }
  return null
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
]

/** A* 八向寻路，禁止贴角穿越（对角两侧的直格必须都可通行）。 */
function astar(blocked: Uint8Array, start: Cell, goal: Cell): Cell[] | null {
  const keyOf = (i: number, j: number) => j * GRID_N + i
  const heuristic = (a: Cell, b: Cell) => {
    const dx = Math.abs(a.i - b.i)
    const dy = Math.abs(a.j - b.j)
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
  }
  const open = new Map<number, { cell: Cell; f: number; g: number }>()
  const cameFrom = new Map<number, number>()
  const gScore = new Map<number, number>([[keyOf(start.i, start.j), 0]])
  open.set(keyOf(start.i, start.j), { cell: start, f: heuristic(start, goal), g: 0 })

  while (open.size) {
    let currentKey = -1
    let currentEntry: { cell: Cell; f: number; g: number } | null = null
    for (const [key, entry] of open) {
      if (!currentEntry || entry.f < currentEntry.f) {
        currentEntry = entry
        currentKey = key
      }
    }
    if (!currentEntry) break
    if (currentEntry.cell.i === goal.i && currentEntry.cell.j === goal.j) {
      const path: Cell[] = []
      let key: number | undefined = currentKey
      while (key !== undefined) {
        path.push({ i: key % GRID_N, j: Math.floor(key / GRID_N) })
        key = cameFrom.get(key)
      }
      return path.reverse()
    }
    open.delete(currentKey)
    for (const [di, dj, cost] of DIRS) {
      const i = currentEntry.cell.i + di
      const j = currentEntry.cell.j + dj
      if (isBlocked(blocked, i, j)) continue
      // 禁止对角切角
      if (di !== 0 && dj !== 0 && (isBlocked(blocked, i - di, j) || isBlocked(blocked, i, j - dj))) continue
      const neighborKey = keyOf(i, j)
      const tentativeG = currentEntry.g + cost
      if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, currentKey)
        gScore.set(neighborKey, tentativeG)
        const cell = { i, j }
        open.set(neighborKey, { cell, g: tentativeG, f: tentativeG + heuristic(cell, goal) })
      }
    }
  }
  return null
}

function hasLineOfSight(a: Point, b: Point, areas: StageArea[]): boolean {
  return areas.every((area) => segmentHitsArea(a, b, area) === null)
}

/** 拉线简化：在保通前提下删掉多余拐点。 */
function pullString(points: Point[], areas: StageArea[]): Point[] {
  if (points.length <= 2) return points
  const result: Point[] = [points[0]]
  let anchor = 0
  while (anchor < points.length - 1) {
    let next = anchor + 1
    for (let probe = points.length - 1; probe > anchor + 1; probe -= 1) {
      if (hasLineOfSight(points[anchor], points[probe], areas)) {
        next = probe
        break
      }
    }
    result.push(points[next])
    anchor = next
  }
  return result
}

export type RerouteResult = { found: true; path: Point[] } | { found: false }

/**
 * 入场点与退场点保持不动，只在中间补绕障节点。
 * 调方需保证 entry/exit 本身合法（门位），禁入区从起点/终点相邻处开始绕行。
 */
export function reroutePath(entry: Point, exit: Point, areas: StageArea[]): RerouteResult {
  if (Math.hypot(exit.x - entry.x, exit.y - entry.y) < 1e-6) return { found: true, path: [entry, exit] }
  const blocked = buildBlocked(areas)
  const startCell = nearestFreeCell(blocked, { i: nearestCellIndex(entry.x), j: nearestCellIndex(entry.y) })
  const goalCell = nearestFreeCell(blocked, { i: nearestCellIndex(exit.x), j: nearestCellIndex(exit.y) })
  if (!startCell || !goalCell) return { found: false }

  const cells = astar(blocked, startCell, goalCell)
  if (!cells) return { found: false }

  const centers = cells.map(cellCenter)
  const simplified = pullString(centers, areas)
  // 首尾锚回真实入/退场点；中间节点全部来自可通行网格。
  const middle = simplified.slice(1, -1)
  const path = [entry, ...middle, exit]
  // 简化后可能出现重复点
  const deduped = path.filter(
    (point, index) => index === 0 || Math.hypot(point.x - path[index - 1].x, point.y - path[index - 1].y) > 0.01,
  )
  return { found: true, path: deduped }
}

export function directPathClear(entry: Point, exit: Point, areas: StageArea[]): boolean {
  return hasLineOfSight(entry, exit, areas)
}

export function rectsFromAreas(areas: StageArea[]): Rect[] {
  return areas.map(forbiddenRect)
}
