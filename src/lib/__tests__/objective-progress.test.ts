import { describe, expect, it } from 'vitest'
import {
  allRated, cleanAddition, emptyObjectives, latestProgress, openAfter, playerProgress, toObjectivesPayload,
  type ProgressRow,
} from '@/lib/objective-progress'

const row = (objectiveId: string, status: ProgressRow['status'], dueOn: string): ProgressRow => ({ objectiveId, status, dueOn })

describe('TRAK-365: grouping the published statuses', () => {
  it('takes each objective\'s latest status and the one before, by evaluation date and not by order', () => {
    const latest = latestProgress([row('a', 'on_track', '2026-11-29'), row('a', 'not_yet', '2026-10-25'), row('a', 'some_progress', '2026-11-01'), row('b', 'not_yet', '2026-11-29')])
    expect(latest.get('a')).toEqual({ now: 'on_track', before: 'some_progress' })
    expect(latest.get('b')).toEqual({ now: 'not_yet', before: null })
  })

  it('puts a player under their worst open objective, and says nothing is rated before any evaluation', () => {
    const latest = latestProgress([row('a', 'on_track', '2026-11-29'), row('b', 'not_yet', '2026-11-29')])
    expect(playerProgress(['a', 'b'], latest).status).toBe('not_yet')
    expect(playerProgress(['a'], latest).status).toBe('on_track')
    expect(playerProgress(['c'], latest)).toEqual({ status: 'unrated', trend: null })
  })

  it('shows the trend of the worst objective since the evaluation before', () => {
    const better = latestProgress([row('a', 'not_yet', '2026-10-25'), row('a', 'some_progress', '2026-11-29')])
    const worse = latestProgress([row('a', 'on_track', '2026-10-25'), row('a', 'not_yet', '2026-11-29')])
    const same = latestProgress([row('a', 'some_progress', '2026-10-25'), row('a', 'some_progress', '2026-11-29')])
    expect(playerProgress(['a'], better)).toEqual({ status: 'some_progress', trend: 1 })
    expect(playerProgress(['a'], worse)).toEqual({ status: 'not_yet', trend: -1 })
    expect(playerProgress(['a'], same)).toEqual({ status: 'some_progress', trend: 0 })
    expect(playerProgress(['a'], latestProgress([row('a', 'on_track', '2026-11-29')])).trend).toBeNull()
  })

  it('ignores a met objective: it is closed', () => {
    const latest = latestProgress([row('a', 'met', '2026-11-29'), row('b', 'some_progress', '2026-11-29')])
    expect(playerProgress(['a', 'b'], latest).status).toBe('some_progress')
    expect(playerProgress(['a'], latest)).toEqual({ status: 'unrated', trend: null })
  })
})

describe('TRAK-365: what an evaluation sends', () => {
  const open = (id: string) => (id === 'p1' ? [{ id: 'a' }, { id: 'b' }] : [])

  it('needs a status for every open objective', () => {
    expect(allRated([{ id: 'a' }, { id: 'b' }], { progress: { a: 'not_yet' }, add: [] })).toBe(false)
    expect(allRated([{ id: 'a' }, { id: 'b' }], { progress: { a: 'not_yet', b: 'met' }, add: [] })).toBe(true)
    expect(allRated([], emptyObjectives())).toBe(true)
  })

  it('counts a met objective as room for another, up to two open', () => {
    const list = [{ id: 'a' }, { id: 'b' }]
    expect(openAfter(list, { progress: {}, add: [] })).toBe(2)
    expect(openAfter(list, { progress: { a: 'met' }, add: [] })).toBe(1)
    expect(openAfter(list, { progress: { a: 'met' }, add: ['New'] })).toBe(2)
  })

  it('cleans an addition to one line and refuses an empty, long or repeated one', () => {
    expect(cleanAddition('  Scan   before receiving ', [])).toBe('Scan before receiving')
    expect(cleanAddition('   ', [])).toBeNull()
    expect(cleanAddition('x'.repeat(121), [])).toBeNull()
    expect(cleanAddition('scan before receiving', ['Scan before receiving'])).toBeNull()
  })

  it('sends only players with objectives or an addition, a status for each open objective', () => {
    const payload = toObjectivesPayload(['p1', 'p2', 'p3'], open, {
      p1: { progress: { a: 'not_yet', b: 'on_track' }, add: [] },
      p3: { progress: {}, add: ['Run in behind'] },
    })
    expect(payload).toEqual([
      { squad_player_id: 'p1', progress: [{ player_objective_id: 'a', status: 'not_yet' }, { player_objective_id: 'b', status: 'on_track' }], add: [] },
      { squad_player_id: 'p3', progress: [], add: ['Run in behind'] },
    ])
  })
})
