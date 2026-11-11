import type { AssessmentRow } from './snapshot'
import { i18n } from '@/lib/i18n'

export const ATTRIBUTES = [
  ['work_rate', 'Work rate'],
  ['technical', 'Technical'],
  ['physical', 'Physical'],
  ['coachability', 'Coachability'],
  ['attitude', 'Attitude'],
  ['tactical', 'Tactical'],
] as const

export type AttributeKey = typeof ATTRIBUTES[number][0]

const DAY = 86_400_000
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const round1 = (n: number) => Math.round(n * 10) / 10

/** The Mondays of the last `count` weeks, oldest first; the last one is the week containing today. */
export function weekStarts(todayISO: string, count = 6): string[] {
  const today = toMs(todayISO)
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7
  const thisMonday = today - sinceMonday * DAY
  return Array.from({ length: count }, (_, i) => toISO(thisMonday - (count - 1 - i) * 7 * DAY))
}

export type AttributeRow = {
  key: AttributeKey
  label: string
  weeks: (number | null)[]
  range: { min: number; max: number; wide: boolean } | null
  trend: number | null
  fallingWeeks: number
}

/**
 * One row per attribute: the mean of each week's assessments (null for an empty week), the spread of each
 * child's latest value, the change from the first to the last recorded week, and the run of weekly drops.
 * `dateOf` turns an assessment timestamp into the calendar date (YYYY-MM-DD) it belongs to.
 */
export function attributeHeatmap(rows: AssessmentRow[], weeks: string[], dateOf: (iso: string) => string): AttributeRow[] {
  const weekIndex = (iso: string) => {
    const date = dateOf(iso)
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (date >= weeks[i]) return date < toISO(toMs(weeks[i]) + 7 * DAY) ? i : -1
    }
    return -1
  }
  const placed = rows.map(row => ({ row, week: weekIndex(row.created_at) }))

  return ATTRIBUTES.map(([key, label]) => {
    const sums = weeks.map(() => ({ total: 0, n: 0 }))
    for (const { row, week } of placed) {
      if (week < 0) continue
      sums[week].total += row[key]
      sums[week].n += 1
    }
    const cells = sums.map(s => (s.n > 0 ? round1(s.total / s.n) : null))

    const latest = new Map<string, AssessmentRow>()
    for (const row of rows) {
      const seen = latest.get(row.squad_player_id)
      if (!seen || row.created_at > seen.created_at) latest.set(row.squad_player_id, row)
    }
    const values = [...latest.values()].map(r => r[key])
    const range = values.length === 0 ? null : (() => {
      const min = Math.min(...values)
      const max = Math.max(...values)
      return { min, max, wide: max - min >= 5 }
    })()

    const recorded = cells.filter((c): c is number => c !== null)
    const trend = recorded.length < 2 ? null : round1(recorded[recorded.length - 1] - recorded[0])
    let fallingWeeks = 0
    for (let i = recorded.length - 1; i > 0 && recorded[i] < recorded[i - 1]; i--) fallingWeeks++

    return { key, label, weeks: cells, range, trend, fallingWeeks }
  })
}

/** Opacity of the brand colour behind a recorded value: pale at 4 and below, strong from 8.4. */
export function heatAlpha(value: number): number {
  return Math.max(0.08, Math.min(0.9, (value - 4) / 4.4))
}

const latestAverage = (row: AttributeRow) => {
  for (let i = row.weeks.length - 1; i >= 0; i--) {
    const v = row.weeks[i]
    if (v !== null) return v
  }
  return null
}

/** The attribute with the lowest latest average, with one sentence about it. Null when nothing is recorded. */
export function focusAttribute(rows: AttributeRow[]): { row: AttributeRow; sentence: string } | null {
  let focus: { row: AttributeRow; avg: number } | null = null
  for (const row of rows) {
    const avg = latestAverage(row)
    if (avg !== null && (focus === null || avg < focus.avg)) focus = { row, avg }
  }
  if (!focus) return null

  const { row, avg } = focus
  // TRAK-407: in the language showing (English as it was).
  let sentence = i18n.t('coachSquad:focusLowest', { avg: avg.toFixed(1) })
  if (row.fallingWeeks >= 2) sentence += i18n.t('coachSquad:focusFalling', { count: row.fallingWeeks })
  sentence += '.'
  if (row.range) {
    const { min, max, wide } = row.range
    sentence += i18n.t(wide ? 'coachSquad:focusRangeWide' : 'coachSquad:focusRangeNarrow', { min, max })
  }
  return { row, sentence }
}
