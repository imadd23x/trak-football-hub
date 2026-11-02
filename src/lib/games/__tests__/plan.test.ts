import { describe, expect, it } from 'vitest'
import { formToPlan, planToForm } from '../plan'

/* TRAK-284 (Games 2/8): the plan's first step as the coach types it and as game_plans keeps it. TRAK-328 (Imad, 2 Nov):
   their line-up left the step, so the form neither reads nor writes it, and what was saved stays in game_plans. */

const saved = {
  strength: 'stronger', scouting: 'Their keeper plays short.',
  goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }],
  format: 9, formation: '3-3-2',
}

describe('TRAK-284: the plan form', () => {
  it('no plan yet is an empty form with no instruction to fill, 11 a side (TRAK-328)', () => {
    expect(planToForm(null)).toEqual({ strength: null, scouting: '', goals: [], format: 11, formation: null, players: {} })
  })

  it('a saved plan comes back as it was saved, its line-up included (TRAK-285); their line-up is never written back', () => {
    const row = { ...saved, their_formation: '4-3-3', key_players: [{ number: 9, position: 'Striker', note: 'Quick.' }] }
    const form = planToForm(row, [{ squad_player_id: 'sp-1', role: 'starter', slot: 1, job: 'Keeper', note: '', context: [], expectation: 'usual' }])
    expect(form.players).toEqual({ 'sp-1': { role: 'starter', slot: 1, job: 'Keeper', note: '', context: [], expectation: 'usual' } })
    expect(formToPlan(form)).toEqual(saved)
  })

  it('drops instructions left empty and trims what was typed', () => {
    expect(formToPlan({
      strength: null, scouting: '  Watch their 7  ',
      goals: [{ title: '', looksLike: '' }, { title: ' Keep it tight ', looksLike: '' }, { title: '', looksLike: 'Switch play early.' }],
      format: 7, formation: '2-3-1', players: {},
    })).toEqual({
      strength: null, scouting: 'Watch their 7',
      goals: [{ title: 'Keep it tight', looks_like: '' }, { title: '', looks_like: 'Switch play early.' }],
      format: 7, formation: '2-3-1',
    })
  })
})
