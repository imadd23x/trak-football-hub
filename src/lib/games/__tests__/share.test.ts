import { describe, expect, it } from 'vitest'
import { planToForm, type PlanForm } from '../plan'
import { lineUpCounts, previewOf, readers, sharedPlan } from '../share'

/* TRAK-286 (Games 4/8): what players and families read once the plan is shared, built from what the coach typed for
   the preview, the same way the database writes the copies (trak_private.game_copies). */

const form = (over: Partial<PlanForm> = {}): PlanForm => ({
  ...planToForm({ strength: 'stronger', their_formation: null, key_players: [], scouting: 'Their 9 is quick.', format: 11, formation: '4-4-2',
    goals: [{ title: 'Win the second ball', looks_like: 'First to every loose ball.' }, { title: '', looks_like: '' }] }),
  players: {
    zagorakis: { role: 'starter', slot: 4, job: '  Stay tight to their winger. ', note: ' Proud of you. ', context: ['out_of_position'], expectation: 'stretch' },
    nikopolidis: { role: 'starter', slot: 1, job: '', note: '', context: [], expectation: 'usual' },
    charisteas: { role: 'not_selected', slot: null, job: '', note: 'Not this week.', context: [], expectation: 'usual' },
  },
  ...over,
})
const who = (id: string, absent = false) => ({ id, absent })

describe('readers (TRAK-286)', () => {
  it('everyone who can come reads the plan, placed or not, left out too', () => {
    expect(readers(form(), [who('zagorakis'), who('charisteas'), who('fyssas')]).map(p => p.id)).toEqual(['zagorakis', 'charisteas', 'fyssas'])
  })

  it('who said they can\'t make it reads nothing, unless they\'re still on the pitch', () => {
    expect(readers(form(), [who('zagorakis', true), who('charisteas', true), who('goumas', true)]).map(p => p.id)).toEqual(['zagorakis'])
  })
})

describe('previewOf (TRAK-286, TRAK-319)', () => {
  it('a starter reads their job, trimmed, and the goals with words; a note to a selected player doesn\'t go out; their family reads only that they start', () => {
    expect(previewOf(form(), 'zagorakis', 'player')).toEqual({
      role: 'starter', updated: false,
      player: { goals: [{ title: 'Win the second ball', looksLike: 'First to every loose ball.' }], job: 'Stay tight to their winger.', note: '' },
    })
    expect(previewOf(form(), 'zagorakis', 'parent')).toEqual({ role: 'starter', updated: false, player: null })
  })

  it('someone not placed is on the bench, with no job and no note', () => {
    expect(previewOf(form(), 'fyssas', 'player')).toMatchObject({ role: 'bench', player: { job: '', note: '' } })
  })

  it('someone left out reads only that, with the note and the goals', () => {
    expect(previewOf(form(), 'charisteas', 'player')).toMatchObject({ role: 'not_selected', player: { job: '', note: 'Not this week.' } })
    expect(previewOf(form(), 'charisteas', 'player').player!.goals).toHaveLength(1)
    expect(previewOf(form(), 'charisteas', 'parent')).toEqual({ role: 'not_selected', updated: false, player: null })
  })

  it('never carries the expectation, the context, how strong they are or scouting', () => {
    const plan = previewOf(form(), 'zagorakis', 'player')
    expect(Object.keys(plan).sort()).toEqual(['player', 'role', 'updated'])
    expect(Object.keys(plan.player!).sort()).toEqual(['goals', 'job', 'note'])
  })
})

describe('lineUpCounts (TRAK-286)', () => {
  it('counts starters in the format\'s slots who can still be recorded, and how many have a job', () => {
    expect(lineUpCounts(form(), [who('zagorakis'), who('nikopolidis'), who('charisteas')])).toEqual({ placed: 2, withJob: 1 })
    expect(lineUpCounts(form(), [who('zagorakis')])).toEqual({ placed: 1, withJob: 1 })
    expect(lineUpCounts(form({ format: 5 }), [who('zagorakis'), who('nikopolidis')])).toEqual({ placed: 2, withJob: 1 })
    expect(lineUpCounts(form({ format: 5, players: { zagorakis: { ...form().players.zagorakis, slot: 6 } } }), [who('zagorakis')]))
      .toEqual({ placed: 0, withJob: 0 })
  })
})

describe('sharedPlan (TRAK-286, TRAK-319)', () => {
  const family = { role: 'starter', changed_at: null }
  const player = { goals: [{ title: 'Win the second ball', looks_like: '' }], job: 'Stay tight.', note: '', changed_at: null }

  it('a player\'s plan holds the goals and their job; a guardian\'s holds only the role', () => {
    expect(sharedPlan(family, player)).toEqual({ role: 'starter', updated: false,
      player: { goals: [{ title: 'Win the second ball', looksLike: '' }], job: 'Stay tight.', note: '' } })
    expect(sharedPlan(family, null)).toEqual({ role: 'starter', updated: false, player: null })
  })

  it('reads as updated when a later share changed either copy', () => {
    expect(sharedPlan({ ...family, changed_at: '2026-10-29T17:00:00Z' }, null).updated).toBe(true)
    expect(sharedPlan(family, { ...player, changed_at: '2026-10-29T17:00:00Z' }).updated).toBe(true)
  })
})
