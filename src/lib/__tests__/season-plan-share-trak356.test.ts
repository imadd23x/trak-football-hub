/**
 * TRAK-356 (Season plan 8/18): what waits under "Not shared yet". The parts first (season dates, season objectives),
 * then each player whose objectives changed, by first name; a player no longer in the squad is counted with the rest.
 * Up to three changes are named, more are counted. Synthetic people.
 */
import { describe, expect, it } from 'vitest'
import { changesText, lastShared, notSharedYet, type SeasonPlan } from '@/lib/season-plan'

const plan = (parts: string[], players: string[]): SeasonPlan => ({
  id: 'plan-1', squad: 'U16', starts_on: '2026-09-01', ends_on: '2027-06-30', positions_known: 'yes', watch_rule: 't2',
  shared_at: '2026-11-01T10:00:00Z', last_shared_at: '2026-11-04T10:00:00Z', unshared_parts: parts, unshared_players: players,
})
const NAMES = new Map([['pat', 'Pat Synthetic'], ['quinn', 'Quinn Synthetic']])
const nameOf = (id: string) => NAMES.get(id)

describe('TRAK-356 not shared yet', () => {
  it('names the parts, then each player by first name', () => {
    expect(notSharedYet(plan(['dates', 'season_objectives'], ['quinn']), nameOf)).toEqual(['season dates', 'season objectives', 'Quinn’s objectives'])
    expect(notSharedYet(plan([], []), nameOf)).toEqual([])
  })

  it('counts players who have left the squad together', () => {
    expect(notSharedYet(plan([], ['pat', 'gone-1']), nameOf)).toEqual(['Pat’s objectives', 'another player’s objectives'])
    expect(notSharedYet(plan([], ['gone-1', 'gone-2']), nameOf)).toEqual(['2 other players’ objectives'])
  })

  it('names up to three changes, and counts more', () => {
    expect(changesText(['season dates', 'Pat’s objectives', 'Quinn’s objectives'])).toBe('season dates, Pat’s objectives, Quinn’s objectives')
    expect(changesText(['season dates', 'season objectives', 'Pat’s objectives', 'Quinn’s objectives'])).toBe('4 changes')
  })

  it('says when the plan was last shared: each share of the changes moves it on', () => {
    expect(lastShared(plan([], []))).toBe('2026-11-04T10:00:00Z')
    expect(lastShared({ ...plan([], []), last_shared_at: null })).toBe('2026-11-01T10:00:00Z')
  })
})
