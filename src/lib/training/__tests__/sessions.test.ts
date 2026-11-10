/** TRAK-294 (Training 1/5): Training home's two lists. */
import { describe, expect, it } from 'vitest'
import { splitTrainings, trainingEnd, trainingMinutes } from '../sessions'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.parse('2026-10-29T15:00:00Z')
const at = (ms: number) => new Date(ms).toISOString()
const training = (id: string, start: number, over: { ends_at?: string | null; start_time?: string | null } = {}) =>
  ({ id, starts_at: at(start), ends_at: at(start + 90 * MINUTE), start_time: '18:00:00', ...over })

describe('TRAK-294: when a training is over', () => {
  it('is its end, or 90 minutes after a timed start, or the end of its day with no time', () => {
    const start = NOW
    expect(trainingEnd(training('a', start))).toBe(start + 90 * MINUTE)
    expect(trainingEnd(training('b', start, { ends_at: null }))).toBe(start + 90 * MINUTE)
    expect(trainingEnd(training('c', start, { ends_at: null, start_time: null }))).toBe(start + DAY)
  })

  it('has a length only with a start and an end time', () => {
    expect(trainingMinutes(training('a', NOW))).toBe(90)
    expect(trainingMinutes(training('b', NOW, { ends_at: null }))).toBeNull()
    expect(trainingMinutes(training('c', NOW, { start_time: null }))).toBeNull()
  })
})

describe('TRAK-294: Coming up and Last week', () => {
  it('Coming up holds every training not over yet, today running included, soonest first', () => {
    const rows = [
      training('later', NOW + 3 * DAY),
      training('running', NOW - 30 * MINUTE),
      training('tomorrow', NOW + DAY),
      training('over', NOW - 2 * HOUR),
    ]
    expect(splitTrainings(rows, NOW).comingUp.map(r => r.id)).toEqual(['running', 'tomorrow', 'later'])
  })

  it('Last week holds those over in the past seven days, newest first, and nothing older', () => {
    const rows = [
      training('six-days', NOW - 6 * DAY),
      training('today-done', NOW - 2 * HOUR),
      training('eight-days', NOW - 8 * DAY),
      training('three-days', NOW - 3 * DAY),
    ]
    expect(splitTrainings(rows, NOW).lastWeek.map(r => r.id)).toEqual(['today-done', 'three-days', 'six-days'])
  })

  it("an untimed training stays coming up all its day", () => {
    const morning = training('untimed', NOW - 10 * HOUR, { ends_at: null, start_time: null })
    expect(splitTrainings([morning], NOW)).toEqual({ comingUp: [morning], lastWeek: [] })
  })
})
