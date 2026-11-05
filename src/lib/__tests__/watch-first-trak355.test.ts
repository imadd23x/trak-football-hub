/**
 * TRAK-355 (Season plan 7/18): when a watched player comes back to Needs you. The coach's rule for the squad: after
 * 1, 2 or 4 weeks, or after 2 or 4 trainings the player attended; whatever the rule, after 28 days at the latest.
 * Days are the academy's own, in its time zone. Only trainings count, and only those the player was at; a cancelled
 * training has no register, so it never counts. Synthetic dates.
 */
import { describe, expect, it } from 'vitest'
import { WATCH_RULES, watchState } from '@/lib/watch-first'

// Watching from 10:00 Dubai on Monday 2 November 2026.
const since = '2026-11-02T06:00:00Z'
const at = (iso: string) => new Date(iso)
const training = (date: string, present = true) => ({ date, type: 'training', present })

describe('TRAK-355 watch first', () => {
  it('offers 1, 2 or 4 weeks, or 2 or 4 trainings', () => {
    expect(WATCH_RULES.map(r => [r.value, r.label])).toEqual([['w1', '1 week'], ['w2', '2 weeks'], ['w4', '4 weeks'], ['t2', '2 trainings'], ['t4', '4 trainings']])
  })

  it('weeks: due on the same weekday, counted in the academy\'s days', () => {
    const base = { since, rule: 'w2' as const, timeZone: 'Asia/Dubai', sessions: [] }
    expect(watchState({ ...base, now: at('2026-11-15T19:59:00Z') })).toMatchObject({ ready: false, progress: '1 of 2 weeks so far' })
    // Midnight in Dubai is 20:00 UTC the day before: Monday 16 Nov has begun there.
    expect(watchState({ ...base, now: at('2026-11-15T20:01:00Z') })).toMatchObject({ ready: true, why: 'Watched 2 weeks' })
    // In Athens it's still Sunday.
    expect(watchState({ ...base, timeZone: 'Europe/Athens', now: at('2026-11-15T20:01:00Z') }).ready).toBe(false)
  })

  it('trainings: counts only trainings after the watch began that the player was at', () => {
    const sessions = [
      training('2026-11-02'), // the day the watch began: not after it
      training('2026-11-04', false), // absent
      { date: '2026-11-05', type: 'match', present: true }, // a match isn't a training
      training('2026-11-06'),
    ]
    expect(watchState({ since, rule: 't2', timeZone: 'Asia/Dubai', sessions, now: at('2026-11-07T08:00:00Z') }))
      .toMatchObject({ ready: false, progress: '1 of 2 trainings so far' })
    expect(watchState({ since, rule: 't2', timeZone: 'Asia/Dubai', sessions: [...sessions, training('2026-11-09')], now: at('2026-11-09T18:00:00Z') }))
      .toMatchObject({ ready: true, why: 'Watched 2 trainings' })
  })

  it('a cancelled training has no register, so missing trainings never count; the safety net comes after 28 days', () => {
    const base = { since, rule: 't4' as const, timeZone: 'Asia/Dubai', sessions: [training('2026-11-04')] }
    expect(watchState({ ...base, now: at('2026-11-29T12:00:00Z') })).toMatchObject({ ready: false, progress: '1 of 4 trainings so far' })
    expect(watchState({ ...base, now: at('2026-11-29T20:01:00Z') })).toMatchObject({ ready: true, why: '4 weeks, the latest' })
  })

  it('says when the rule is met before the net', () => {
    expect(watchState({ since, rule: 'w4', timeZone: 'Asia/Dubai', sessions: [], now: at('2026-11-30T08:00:00Z') }))
      .toMatchObject({ ready: true, why: 'Watched 4 weeks' })
  })
})
