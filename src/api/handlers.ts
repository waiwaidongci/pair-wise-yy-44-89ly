import { http, HttpResponse } from 'msw'
import { areaServer } from '../spatial/collab'
import { seedAreas, seedCues, seedMovers, seedProject } from '../stores/workshop'
import type { StageArea } from '../spatial/types'

let cues = structuredClone(seedCues)
areaServer.seed(structuredClone(seedAreas))

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
  http.get('/api/areas', () => HttpResponse.json(areaServer.list())),
  // 区域级先到先得锁
  http.post('/api/areas/:id/lock', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { holder?: string }
    const holder = body.holder ?? '匿名'
    const acquired = areaServer.acquireLock(params.id as string, holder)
    if (!acquired) {
      return HttpResponse.json(
        { ok: false, holder: areaServer.lockOf(params.id as string)?.holder },
        { status: 409 },
      )
    }
    return HttpResponse.json({ ok: true })
  }),
  http.post('/api/areas/:id/unlock', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { holder?: string }
    areaServer.releaseLock(params.id as string, body.holder ?? '')
    return HttpResponse.json({ ok: true })
  }),
  // 范围登记：提交失败说明先到者持锁或服务器版本已变
  http.put('/api/areas/:id', async ({ params, request }) => {
    const body = (await request.json()) as { base: StageArea; next: StageArea; author: string }
    if (params.id !== body.next.id) return new HttpResponse(null, { status: 400 })
    const result = areaServer.commit(body.base, body.next, body.author)
    if (!result.ok) {
      return HttpResponse.json(result, { status: result.reason === 'locked' ? 423 : 409 })
    }
    return HttpResponse.json(result)
  }),
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
]

export { seedMovers }
