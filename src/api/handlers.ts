import { http, HttpResponse } from 'msw'
import { seedAreas, seedCues, seedMovers, seedProject, type OutboxChange, type StageArea } from '../stores/workshop'

let cues = structuredClone(seedCues)
let areas = structuredClone(seedAreas)

function bumpVersion(area: StageArea): StageArea {
  return { ...area, version: area.version + 1, updatedAt: new Date().toISOString() }
}

export const handlers = [
  http.get('/api/project', () => HttpResponse.json(seedProject)),
  http.get('/api/cues', () =>
    HttpResponse.json(
      cues.map((cue) => ({
        ...cue,
        conflict: cue.id === 'C-06' ? '此提示与道具运输时间重叠 4 分钟' : '',
      })),
    ),
  ),
  http.post('/api/cues/:id/comments', async ({ params, request }) => {
    const body = (await request.json()) as { author: string; content: string }
    const cue = cues.find((item) => item.id === params.id)
    if (!cue) return new HttpResponse(null, { status: 404 })
    cue.comments.push({
      id: `comment-${Date.now()}`,
      author: body.author,
      content: body.content,
      createdAt: new Date().toISOString(),
      resolved: false,
    })
    return HttpResponse.json(cue, { status: 201 })
  }),
  http.post('/api/sync', async ({ request }) => {
    const body = (await request.json()) as { cues: typeof cues }
    cues = structuredClone(body.cues)
    return HttpResponse.json({ syncedAt: new Date().toISOString(), revision: Date.now() })
  }),

  // ---- 布景 / 机械区登记 ----
  http.get('/api/areas', () => HttpResponse.json(areas)),

  http.post('/api/areas', async ({ request }) => {
    const body = (await request.json()) as { area: StageArea }
    const area: StageArea = { ...body.area, version: 1, updatedAt: new Date().toISOString() }
    if (!area.id) {
      let max = 0
      for (const item of areas) {
        const match = /^A-(\d+)$/.exec(item.id)
        if (match) max = Math.max(max, Number(match[1]))
      }
      area.id = `A-${String(max + 1).padStart(2, '0')}`
    }
    areas.push(area)
    return HttpResponse.json(area, { status: 201 })
  }),

  http.put('/api/areas/:id', async ({ params, request }) => {
    const body = (await request.json()) as { area: StageArea; baseVersion: number }
    const current = areas.find((item) => item.id === params.id)
    if (!current) return HttpResponse.json({ error: 'not found' }, { status: 404 })
    if (current.version !== body.baseVersion) {
      // 先到者生效：返回服务端当前版本，后到者回滚。
      return HttpResponse.json({ error: 'version conflict', current }, { status: 409 })
    }
    const updated = bumpVersion(body.area)
    areas = areas.map((item) => (item.id === params.id ? updated : item))
    return HttpResponse.json(updated)
  }),

  http.delete('/api/areas/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { baseVersion?: number }
    const current = areas.find((item) => item.id === params.id)
    if (!current) return new HttpResponse(null, { status: 404 })
    if (body.baseVersion !== undefined && current.version !== body.baseVersion) {
      return HttpResponse.json({ error: 'version conflict', current }, { status: 409 })
    }
    areas = areas.filter((item) => item.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),

  // 离线积压变更回网：按区域编号合并，版本一致才生效。
  http.post('/api/areas/sync', async ({ request }) => {
    const body = (await request.json()) as { changes: OutboxChange[] }
    const merged: StageArea[] = []
    const conflicts: { id: string; reason: string }[] = []
    for (const change of body.changes) {
      const current = areas.find((item) => item.id === change.clientId || item.id === change.area.id)
      if (change.op === 'remove') {
        if (!current) continue
        if (current.version === change.baseVersion) {
          areas = areas.filter((item) => item.id !== current.id)
          merged.push(current)
        } else {
          conflicts.push({ id: current.id, reason: '先到者已更新该区域，离线删除未生效' })
        }
        continue
      }
      if (!current) {
        const created = { ...change.area, version: 1, updatedAt: new Date().toISOString() }
        areas.push(created)
        merged.push(created)
      } else if (current.version === change.baseVersion) {
        const updated = bumpVersion(change.area)
        areas = areas.map((item) => (item.id === current.id ? updated : item))
        merged.push(updated)
      } else {
        conflicts.push({ id: current.id, reason: '先到者已更新该区域，离线范围未合并' })
      }
    }
    return HttpResponse.json({ merged, conflicts })
  }),
]

export { seedMovers }
