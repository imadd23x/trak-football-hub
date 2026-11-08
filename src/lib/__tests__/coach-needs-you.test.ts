import { describe, it, expect } from 'vitest'
import { needsYou } from '../coach-needs-you'

// TRAK-262: Home's Needs you. "Now" is 22 Oct; a player joined 5 weeks ago unless said.
const now = Date.parse('2026-10-22T12:00:00Z')
const player = (id: string, name: string, created_at = '2026-09-17T12:00:00Z') =>
  ({ id, player_name: name, created_at, position: 'Midfielder', shirt_number: 8 })
const assessed = (id: string, created_at: string, published_at: string | null = created_at) => ({ squad_player_id: id, created_at, published_at })
const run = (players: ReturnType<typeof player>[], assessments: ReturnType<typeof assessed>[], waiting: string[] = []) =>
  needsYou({ players, waitingForParent: new Set(waiting), assessments, now })

describe('needs you', () => {
  it('flags a player never assessed after 3 weeks as urgent, and one not assessed for 2 weeks as a warning', () => {
    const items = run([player('a', 'Thierry Henry'), player('b', 'Patrick Vieira')], [assessed('b', '2026-10-05T12:00:00Z')])
    expect(items.map(i => [i.name, i.kind, i.urgent])).toEqual([['Thierry Henry', 'assess', true], ['Patrick Vieira', 'assess', false]])
    expect(items[0]).toMatchObject({ detail: 'Midfielder · #8', reason: 'Never assessed, 5 weeks in the squad' })
  })

  it('leaves out a player assessed this week, and one new to the squad', () => {
    expect(run([player('a', 'Thierry Henry'), player('n', 'Robert Pires', '2026-10-20T12:00:00Z')], [assessed('a', '2026-10-20T12:00:00Z')])).toEqual([])
  })

  it('adds one card per player with drafts families cannot see', () => {
    const items = run([player('a', 'Thierry Henry')], [
      assessed('a', '2026-10-20T12:00:00Z', null), assessed('a', '2026-10-21T12:00:00Z', null),
    ])
    expect(items).toEqual([expect.objectContaining({ kind: 'draft', playerId: 'a', reason: "2 drafts, the latest from 21 Oct: families can't see them yet" })])
  })

  it('a published assessment, or one saved before drafts existed, is not a draft', () => {
    expect(run([player('a', 'Thierry Henry')], [{ squad_player_id: 'a', created_at: '2026-10-21T12:00:00Z' } as ReturnType<typeof assessed>])).toEqual([])
  })

  it('leaves out a player waiting for a parent', () => {
    expect(run([player('a', 'Thierry Henry')], [], ['a'])).toEqual([])
  })

  // TRAK-364: an evaluated squad (its season plan shared) has no per-player Assess cards: its Evaluation due card takes
  // their place. Another squad keeps them, and drafts still show everywhere.
  it('drops the Assess cards of an evaluated squad only, and keeps its drafts', () => {
    const players = [{ ...player('a', 'Thierry Henry'), age_group: 'U16 ' }, { ...player('b', 'Patrick Vieira'), age_group: 'U14' },
      { ...player('c', 'Robert Pires'), age_group: 'U16' }]
    const items = needsYou({ players, waitingForParent: new Set(), assessments: [assessed('c', '2026-10-20T12:00:00Z', null)], now,
      evaluatedSquads: new Set(['U16']) })
    expect(items.map(i => [i.playerId, i.kind])).toEqual([['b', 'assess'], ['c', 'draft']])
    expect(needsYou({ players, waitingForParent: new Set(), assessments: [], now }).map(i => i.playerId).sort()).toEqual(['a', 'b', 'c'])
  })
})
