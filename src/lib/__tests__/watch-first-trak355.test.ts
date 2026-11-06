/**
 * TRAK-355 (Season plan 7/18): when a watched player comes back to Needs you. The coach's rule for the squad: after
 * 1, 2 or 4 weeks, or after 2 or 4 trainings the player attended; whatever the rule, after 28 days at the latest.
 * Days are the academy's own, in its time zone. Only trainings count, and only those the player was at; a cancelled
 * training has no register, so it never counts. Synthetic dates.
 */
import { describe, expect, it } from 'vitest'
import { WATCH_RULES, effectiveRule, rulesFor, watchState, watchedPlayers } from '@/lib/watch-first'

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

describe('TRAK-355 who is watched, and who is due', () => {
  const players = [
    { id: 'p1', player_name: 'Synthetic Omar', position: null },
    { id: 'p2', player_name: 'Synthetic Bea', position: 'Defender' },
    { id: 'p3', player_name: 'Synthetic Cal', position: 'Attacker' },
    { id: 'p4', player_name: 'Synthetic Dee', position: 'Midfielder' },
  ]
  const watches = [
    { squad_player_id: 'p1', since: '2026-10-19T06:00:00Z' }, // watched four weeks and more: the net
    { squad_player_id: 'p2', since: since }, // watched since 2 Nov
    { squad_player_id: 'p3', since: '2026-10-19T06:00:00Z' }, // has objectives now: set up, not watched
  ]
  const list = (now: string, rule: 'w2' | 't2' = 'w2', sessions: Record<string, { date: string; type: string; present: boolean }[]> = {}) =>
    watchedPlayers({ players, watches, objectives: new Set(['p3']), sessions, rule, timeZone: 'Asia/Dubai', now: at(now) })

  it('lists only watched players without objectives, each with where to set them up', () => {
    expect(list('2026-11-05T08:00:00Z').map(w => [w.playerId, w.ready, w.step])).toEqual([['p1', true, 'positions'], ['p2', false, 'objectives']])
  })

  it('a player comes back once their own rule is met', () => {
    // Omar's four weeks meet the two-week rule too; the rule's reason comes first.
    expect(list('2026-11-16T08:00:00Z').map(w => [w.playerId, w.ready, w.why])).toEqual([['p1', true, 'Watched 2 weeks'], ['p2', true, 'Watched 2 weeks']])
    expect(list('2026-11-05T08:00:00Z', 't2', { p2: [training('2026-11-03'), training('2026-11-04')] }).find(w => w.playerId === 'p2'))
      .toMatchObject({ ready: true, why: 'Watched 2 trainings' })
  })
})

describe('TRAK-355 a squad without trainings', () => {
  it('is offered weeks only, and a trainings rule becomes "after 2 weeks" there', () => {
    expect(rulesFor(false).map(r => r.value)).toEqual(['w1', 'w2', 'w4'])
    expect(rulesFor(true).map(r => r.value)).toEqual(['w1', 'w2', 'w4', 't2', 't4'])
    expect(effectiveRule('t4', false)).toBe('w2')
    expect(effectiveRule('w4', false)).toBe('w4')
    expect(effectiveRule('t4', true)).toBe('t4')
  })
})
