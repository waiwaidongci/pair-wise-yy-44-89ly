/** 统一把 HH:MM:SS 换算成秒，支持 00:04:20 这类时间码。 */
export function timecodeToSeconds(value: string): number | null {
  const parts = value.trim().split(':').map((part) => Number(part))
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null
  const [hours, minutes, seconds] = parts
  return hours * 3600 + minutes * 60 + seconds
}

export type Interval = { start: number; end: number }

export function cueInterval(time: string, durationSeconds: number): Interval | null {
  const start = timecodeToSeconds(time)
  if (start === null) return null
  return { start, end: start + Math.max(0, durationSeconds) }
}

export function windowInterval(window: { start: string; end: string }): Interval | null {
  const start = timecodeToSeconds(window.start)
  const end = timecodeToSeconds(window.end)
  if (start === null || end === null) return null
  return { start, end }
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

export function overlapSeconds(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}
