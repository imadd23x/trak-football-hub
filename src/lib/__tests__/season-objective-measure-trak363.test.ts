/**
 * TRAK-363 (Season plan 15/18): a season objective's measure, from matches only. The share of its matches that Worked:
 * Good from 60 %, Watch from 40 %, At risk below; none before a match. Two Didn'ts in a row are stuck. Typed
 * instructions don't count, and an objective removed since keeps its past matches. Synthetic ids.
 */
import { describe, expect, it } from 'vitest'
import { measureObjectives, verdictOf } from '@/lib/season-objective-measure'

const press = '11111111-1111-4111-8111-111111111111', compact = '22222222-2222-4222-8222-222222222222'
const match = (id: string, day: string, goals: { title: string; season_objective_id?: string }[], planWorked: (string | null)[]) =>
  ({ eventId: id, startsAt: `${day}T15:00:00Z`, goals: goals.map(g => ({ looks_like: '', ...g })), planWorked })

describe('TRAK-363 the season objective measure', () => {
  it('draws the line at 60 % and 40 %', () => {
    expect(verdictOf(60)).toBe('Good')
    expect(verdictOf(59)).toBe('Watch')
    expect(verdictOf(40)).toBe('Watch')
    expect(verdictOf(39)).toBe('At risk')
    expect(verdictOf(null)).toBeNull()
  })

  it('counts only instructions carrying the objective, at their place in the list', () => {
    const measures = measureObjectives([press, compact], [
      match('m1', '2026-10-01', [{ title: 'Typed' }, { title: 'Press', season_objective_id: press }], ['didnt', 'worked']),
      match('m2', '2026-10-08', [{ title: 'Press', season_objective_id: press }, { title: 'Compact', season_objective_id: compact }], ['worked', 'partly']),
      match('m3', '2026-10-15', [{ title: 'Press', season_objective_id: press }], ['partly']),
    ])
    expect(measures.get(press)).toMatchObject({ matches: 3, worked: 2, partly: 1, didnt: 0, pct: 67, verdict: 'Good', stuck: false })
    expect(measures.get(compact)).toMatchObject({ matches: 1, worked: 0, partly: 1, pct: 0, verdict: 'At risk' })
  })

  it('says nothing before a match, and an objective removed since keeps its past matches', () => {
    expect(measureObjectives([press], []).get(press)).toMatchObject({ matches: 0, pct: null, verdict: null, stuck: false })
    // The objective isn't open any more; its matches still carry it.
    const removed = measureObjectives([compact], [match('m1', '2026-09-20', [{ title: 'Compact', season_objective_id: compact }], ['worked'])])
    expect(removed.get(compact)).toMatchObject({ matches: 1, pct: 100, verdict: 'Good' })
  })

  it('is stuck after two Didn’ts in a row, by kick-off, and not after one', () => {
    const late = match('m3', '2026-10-15', [{ title: 'Press', season_objective_id: press }], ['didnt'])
    const mid = match('m2', '2026-10-08', [{ title: 'Press', season_objective_id: press }], ['didnt'])
    const early = match('m1', '2026-10-01', [{ title: 'Press', season_objective_id: press }], ['worked'])
    expect(measureObjectives([press], [late, early, mid]).get(press)!.stuck).toBe(true)
    expect(measureObjectives([press], [early, late]).get(press)!.stuck).toBe(false)
    expect(measureObjectives([press], [mid, late, { ...early, eventId: 'm4', startsAt: '2026-10-22T15:00:00Z' }]).get(press)!.stuck).toBe(false)
  })
})
