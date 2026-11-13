import { describe, it, expect } from 'vitest'
import { playerAttention, type AttentionInput } from '@/lib/player-attention'

// TRAK-197: Kostas's levels (17 Oct), agreed by Imad (18 Oct).
const NOW = Date.parse('2026-11-30T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
const JOINED = '2026-10-20T08:00:00Z' // six weeks before NOW

// Four Monday trainings, newest last: t1 23 Nov … t4 2 Nov.
const TRAININGS = [
  { id: 't1', session_date: '2026-11-23', event_id: 'e1' },
  { id: 't2', session_date: '2026-11-16', event_id: null },
  { id: 't3', session_date: '2026-11-09', event_id: null },
  { id: 't4', session_date: '2026-11-02', event_id: null },
]

function input(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    roster: [{ id: 'a', player_name: 'Ade', created_at: JOINED }],
    waitingForParent: new Set(),
    assessments: [{ squad_player_id: 'a', created_at: daysAgo(3) }],
    trainings: TRAININGS,
    // Everyone present everywhere unless a test says otherwise; 'x' keeps each register "taken".
    present: new Map(TRAININGS.map(t => [t.id, new Set(['a', 'x'])])),
    absenceReasons: new Map(),
    now: NOW,
    ...over,
  }
}
const absentFrom = (...ids: string[]) =>
  new Map(TRAININGS.map(t => [t.id, new Set(ids.includes(t.id) ? ['x'] : ['a', 'x'])]))
const only = (i: AttentionInput) => {
  const rows = playerAttention(i)
  expect(rows).toHaveLength(1)
  return rows[0]
}

describe('TRAK-197: trainings', () => {
  it('missed 3 of the last 4 is Urgent', () => {
    expect(only(input({ present: absentFrom('t1', 't2', 't3') }))).toMatchObject({
      level: 'urgent', reasons: ['Missed 3 of the last 4 trainings'],
    })
  })

  it('missed 2 of the last 4 is a Warning', () => {
    expect(only(input({ present: absentFrom('t2', 't4') }))).toMatchObject({
      level: 'warning', reasons: ['Missed 2 of the last 4 trainings'],
    })
  })

  it('missing only the last one is a Warning', () => {
    expect(only(input({ present: absentFrom('t1') }))).toMatchObject({
      level: 'warning', reasons: ['Missed the last training'],
    })
  })

  it('missing one earlier training is on track', () => {
    expect(only(input({ present: absentFrom('t3') })).level).toBe('on-track')
  })

  it('counts the last 4 only, by date, whatever order they arrive in', () => {
    const older = { id: 't0', session_date: '2026-10-26', event_id: null }
    const present = absentFrom('t2', 't3')
    present.set('t0', new Set(['x']))
    expect(only(input({ trainings: [older, ...TRAININGS].reverse(), present })).reasons).toEqual(['Missed 2 of the last 4 trainings'])
  })

  it('no attendance Urgent until the squad has 4 logged trainings', () => {
    const three = TRAININGS.slice(0, 3)
    const row = only(input({ trainings: three, present: absentFrom('t1', 't2', 't3') }))
    expect(row.level).toBe('warning')
    expect(row.reasons).toEqual(['Missed 3 of the last 3 trainings'])
  })

  it("a register nobody was ticked on wasn't taken, so it doesn't count", () => {
    const present = absentFrom('t2', 't3', 't4')
    present.set('t1', new Set())
    const row = only(input({ present }))
    // t1 drops out: three counted trainings, so attendance can't be Urgent yet.
    expect(row).toMatchObject({ level: 'warning', reasons: ['Missed 3 of the last 3 trainings'] })
  })

  it("a training from before the child joined doesn't count against them", () => {
    const row = only(input({
      roster: [{ id: 'a', player_name: 'Ade', created_at: '2026-11-10T09:00:00Z' }],
      present: absentFrom('t3', 't4'),
    }))
    expect(row.level).toBe('on-track')
  })

  it("Can't make it still counts as missed, and the coach sees its reason", () => {
    const row = only(input({
      present: absentFrom('t1'),
      absenceReasons: new Map([['e1', new Map([['a', 'family']])]]),
    }))
    expect(row).toMatchObject({ level: 'warning', reasons: ["Missed the last training (Can't make it: Family)"] })
  })

  it("Can't make it with no reason given still says so", () => {
    const row = only(input({
      present: absentFrom('t1', 't2', 't3'),
      absenceReasons: new Map([['e1', new Map([['a', null]])]]),
    }))
    expect(row.reasons).toEqual(["Missed 3 of the last 4 trainings (Can't make it)"])
  })
})

describe('TRAK-197: assessments', () => {
  it('none for 4+ weeks is Urgent', () => {
    expect(only(input({ assessments: [{ squad_player_id: 'a', created_at: daysAgo(29) }] }))).toMatchObject({
      level: 'urgent', reasons: ['No assessment for 4 weeks'],
    })
  })

  it('none for 2+ weeks is a Warning', () => {
    expect(only(input({ assessments: [{ squad_player_id: 'a', created_at: daysAgo(15) }] }))).toMatchObject({
      level: 'warning', reasons: ['No assessment for 2 weeks'],
    })
  })

  it('the latest assessment counts, not an older one', () => {
    const row = only(input({ assessments: [
      { squad_player_id: 'a', created_at: daysAgo(40) },
      { squad_player_id: 'a', created_at: daysAgo(2) },
    ] }))
    expect(row).toMatchObject({ level: 'on-track', reasons: ['Assessed 2 days ago'] })
  })

  it('never assessed after 3 weeks in the squad is Urgent', () => {
    const row = only(input({ assessments: [], roster: [{ id: 'a', player_name: 'Ade', created_at: daysAgo(22) }] }))
    expect(row).toMatchObject({ level: 'urgent', reasons: ['Never assessed, 3 weeks in the squad'] })
  })

  it('never assessed after 2 weeks is a Warning; a new player is on track', () => {
    const at = (n: number) => only(input({ assessments: [], trainings: [], roster: [{ id: 'a', player_name: 'Ade', created_at: daysAgo(n) }] }))
    expect(at(15)).toMatchObject({ level: 'warning', reasons: ['Never assessed, 2 weeks in the squad'] })
    expect(at(5)).toMatchObject({ level: 'on-track', reasons: ['Not assessed yet'] })
  })
})

describe('TRAK-197: the list', () => {
  it('a child waiting for a parent is left out', () => {
    expect(playerAttention(input({ waitingForParent: new Set(['a']), assessments: [] }))).toEqual([])
  })

  it('every reason is listed, the most serious first', () => {
    const row = only(input({ present: absentFrom('t1'), assessments: [{ squad_player_id: 'a', created_at: daysAgo(30) }] }))
    expect(row).toMatchObject({ level: 'urgent', reasons: ['No assessment for 4 weeks', 'Missed the last training'] })
  })

  it('most urgent first: Urgent, then Warning, then on track; two urgent reasons before one', () => {
    const roster = ['onTrack', 'warn', 'urgent1', 'urgent2'].map(id => ({ id, player_name: id, created_at: JOINED }))
    // urgent1 missed all 4 (its one reason outweighs any single reason of urgent2's);
    // urgent2 missed 3 of 4 AND has no assessment for 4+ weeks: two urgent reasons.
    const present = new Map(TRAININGS.map(t => [t.id, new Set(['x', 'onTrack', 'warn'])]))
    present.get('t1')!.delete('warn')
    present.get('t4')!.add('urgent2')
    const rows = playerAttention(input({
      roster,
      present,
      assessments: [
        { squad_player_id: 'onTrack', created_at: daysAgo(1) },
        { squad_player_id: 'warn', created_at: daysAgo(1) },
        { squad_player_id: 'urgent1', created_at: daysAgo(1) },
        { squad_player_id: 'urgent2', created_at: daysAgo(30) },
      ],
    }))
    expect(rows.map(r => [r.playerId, r.level])).toEqual([
      ['urgent2', 'urgent'], ['urgent1', 'urgent'], ['warn', 'warning'], ['onTrack', 'on-track'],
    ])
    expect(rows[0].reasons).toEqual(['Missed 3 of the last 4 trainings', 'No assessment for 4 weeks'])
  })
})
