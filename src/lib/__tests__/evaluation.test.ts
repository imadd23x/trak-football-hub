/**
 * TRAK-364 (Season plan 16/18): the evaluation's dates and ratings. Explicit dates and time zones throughout: the due
 * date follows the rhythm, counts from the day the plan was shared and after the last evaluation, in the academy's
 * day; a missed date stays due, and one evaluation closes every date that has passed.
 */
import { describe, expect, it } from 'vitest'
import {
  bandMove, evaluationDates, evaluationDue, firstDateLine, latestRatings, nextDateLine, rhythmOf, rhythmText, squadEvaluation,
  startEntry, toPublish, type Ratings,
} from '@/lib/evaluation'

const season = { startsOn: '2026-09-01', endsOn: '2027-01-31' }
const r = (n: number): Ratings => ({ work_rate: n, tactical: n, attitude: n, technical: n, physical: n, coachability: n })

describe('TRAK-364 evaluation dates', () => {
  it('every month: the last day of each month, at least 20 days into the season, up to its end', () => {
    expect(evaluationDates({ ...season, every: 'month', day: 0 })).toEqual(['2026-09-27', '2026-10-25', '2026-11-29', '2026-12-27', '2027-01-31'])
    // A season starting on 20 Sep: 27 Sep is only 7 days in, so October is the first.
    expect(evaluationDates({ startsOn: '2026-09-20', endsOn: '2026-11-30', every: 'month', day: 0 })).toEqual(['2026-10-25', '2026-11-29'])
  })

  it('every 2 or 6 weeks: the first full gap from the start, moved on to the day, then every gap', () => {
    expect(evaluationDates({ ...season, every: '2w', day: 6 }).slice(0, 3)).toEqual(['2026-09-19', '2026-10-03', '2026-10-17'])
    expect(evaluationDates({ ...season, every: '6w', day: 0 })).toEqual(['2026-10-18', '2026-11-29', '2027-01-10'])
  })

  it('has none without both dates, or with the end before the start', () => {
    expect(evaluationDates({ startsOn: null, endsOn: '2027-01-31', every: 'month', day: 0 })).toEqual([])
    expect(evaluationDates({ startsOn: '2027-01-31', endsOn: '2026-09-01', every: 'month', day: 0 })).toEqual([])
  })
})

describe('TRAK-364 what is due', () => {
  const dates = ['2026-09-27', '2026-10-25', '2026-11-29', '2026-12-27']
  it('counts only from the day the plan was shared', () => {
    expect(evaluationDue({ dates, sharedOn: '2026-10-01', lastDueOn: null, today: '2026-10-20' }))
      .toEqual({ dueOn: null, since: null, next: '2026-10-25' })
    expect(evaluationDue({ dates, sharedOn: '2026-10-01', lastDueOn: null, today: '2026-10-25' }))
      .toEqual({ dueOn: '2026-10-25', since: '2026-10-25', next: '2026-11-29' })
  })

  it('a missed date stays due; with two passed, one evaluation closes both', () => {
    expect(evaluationDue({ dates, sharedOn: '2026-10-01', lastDueOn: null, today: '2026-11-10' }))
      .toEqual({ dueOn: '2026-10-25', since: '2026-10-25', next: '2026-11-29' })
    expect(evaluationDue({ dates, sharedOn: '2026-10-01', lastDueOn: null, today: '2026-12-01' }))
      .toEqual({ dueOn: '2026-11-29', since: '2026-10-25', next: '2026-12-27' })
  })

  it('once published, the next is due after it', () => {
    expect(evaluationDue({ dates, sharedOn: '2026-10-01', lastDueOn: '2026-11-29', today: '2026-12-01' }))
      .toEqual({ dueOn: null, since: null, next: '2026-12-27' })
    expect(evaluationDue({ dates, sharedOn: '2026-10-01', lastDueOn: '2026-12-27', today: '2027-01-05' }))
      .toEqual({ dueOn: null, since: null, next: null })
  })

  it('is the academy’s day: 21:30 UTC on 28 Nov is already the 29th in Dubai, still the 28th in Athens', () => {
    const plan = { starts_on: '2026-09-01', ends_on: '2027-06-30', shared_at: '2026-10-01T08:00:00Z', eval_every: 'month', eval_day: 0 }
    const now = new Date('2026-11-28T21:30:00Z')
    expect(squadEvaluation({ plan, lastDueOn: '2026-10-25', zone: 'Asia/Dubai', now }))
      .toEqual({ today: '2026-11-29', sharedOn: '2026-10-01', due: { dueOn: '2026-11-29', since: '2026-11-29', next: '2026-12-27' } })
    expect(squadEvaluation({ plan, lastDueOn: '2026-10-25', zone: 'Europe/Athens', now }))
      .toEqual({ today: '2026-11-28', sharedOn: '2026-10-01', due: { dueOn: null, since: null, next: '2026-11-29' } })
  })

  it('counts the share day in the academy’s day too', () => {
    // Shared at 20:30 UTC on 25 Oct: already the 26th in Dubai (UTC+4), so that Sunday's date came before the share
    // there; still the 25th in Athens (UTC+2 from that morning), so it counts there.
    const plan = { starts_on: '2026-09-01', ends_on: '2027-06-30', shared_at: '2026-10-25T20:30:00Z' }
    const now = new Date('2026-10-27T10:00:00Z')
    expect(squadEvaluation({ plan, lastDueOn: null, zone: 'Asia/Dubai', now }).due).toEqual({ dueOn: null, since: null, next: '2026-11-29' })
    expect(squadEvaluation({ plan, lastDueOn: null, zone: 'Europe/Athens', now }).due.dueOn).toBe('2026-10-25')
  })

  it('says it in words', () => {
    expect(nextDateLine({ dueOn: '2026-11-29', since: '2026-10-25', next: null }, '2026-12-01')).toBe('Due now, since Sun 25 Oct.')
    expect(nextDateLine({ dueOn: null, since: null, next: '2026-12-27' }, '2026-12-01')).toBe('Next evaluation Sun 27 Dec 2026.')
    expect(nextDateLine({ dueOn: null, since: null, next: null }, '2027-01-05')).toBe('No evaluation is left this season.')
    expect(firstDateLine({ ...season, every: 'month', day: 0, today: '2026-10-26' })).toMatch(/^First evaluation Sun 29 Nov 2026: /)
    expect(firstDateLine({ startsOn: null, endsOn: null, every: 'month', day: 0, today: '2026-10-26' })).toBe('Add the season’s dates to see your evaluation days.')
    expect(rhythmText('month', 0)).toBe('every month, on the last Sunday')
    expect(rhythmText('2w', 6)).toBe('every 2 weeks, on Saturday')
  })

  it('a plan from before the rhythm, or with a bad one, follows the default: every month, on the last Sunday', () => {
    expect(rhythmOf({})).toEqual({ every: 'month', day: 0 })
    expect(rhythmOf({ eval_every: 'weekly', eval_day: 9 })).toEqual({ every: 'month', day: 0 })
    expect(rhythmOf({ eval_every: '6w', eval_day: 3 })).toEqual({ every: '6w', day: 3 })
  })
})

describe('TRAK-364 ratings', () => {
  it('each player starts from their latest six, however they were given', () => {
    const latest = latestRatings([
      { squad_player_id: 'a', created_at: '2026-10-01T10:00:00Z', ...r(4) },
      { squad_player_id: 'a', created_at: '2026-11-01T10:00:00Z', ...r(7) },
      { squad_player_id: 'a', created_at: '2026-09-01T10:00:00Z', ...r(2) },
      { squad_player_id: 'b', created_at: null, ...r(9) },
    ])
    expect(latest.get('a')).toEqual(r(7))
    expect(latest.has('b')).toBe(false)
  })

  it('a player with ratings is rated from the start; one without starts at 5 and isn’t', () => {
    expect(startEntry(r(7))).toEqual({ ratings: r(7), note: '', rated: true })
    expect(startEntry(undefined)).toEqual({ ratings: r(5), note: '', rated: false })
  })

  it('the band moves up or down from last time', () => {
    expect(bandMove(r(7), r(6))).toBe(1)
    expect(bandMove(r(4), r(6))).toBe(-1)
    expect(bandMove({ ...r(6), physical: 7 }, r(6))).toBe(0)
    expect(bandMove(r(7), null)).toBe(0)
  })

  it('sends each player once, with the six ratings and the note trimmed', () => {
    expect(toPublish(['a'], { a: { ratings: r(6), note: '  Keep going.  ', rated: true } }))
      .toEqual([{ squad_player_id: 'a', ...r(6), note: 'Keep going.' }])
  })
})
