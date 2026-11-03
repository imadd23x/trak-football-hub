import { describe, expect, it } from 'vitest'
import { againLabel, loopSteps, nextTraining, searchPast, trainingBadge } from '../next'

/* TRAK-339 (Training redo 1/5, spec TRAK-338): which training the Next training card shows, and its badge. */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const NOW = Date.parse('2026-11-02T12:00:00Z')
const at = (id: string, start: number) => ({ id, starts_at: new Date(start).toISOString(), ends_at: new Date(start + 90 * MINUTE).toISOString(), start_time: '00:00' })
const never = () => false

describe('the Next training card', () => {
  it('shows the soonest coming up: the day when it is today, before otherwise', () => {
    const list = [at('later', NOW + 48 * HOUR), at('soon', NOW + 5 * HOUR)]
    expect(nextTraining(list, NOW, never, t => t.id === 'soon')).toEqual({ training: list[1], phase: 'day' })
    expect(nextTraining(list, NOW, never, never)).toEqual({ training: list[1], phase: 'before' })
  })

  it('a training under way comes first', () => {
    const list = [at('soon', NOW + HOUR), at('now', NOW - 20 * MINUTE)]
    expect(nextTraining(list, NOW, never, never)).toEqual({ training: list[1], phase: 'day' })
  })

  it('a training that ended in the last day waits for its Notes, newest first; once noted, the card moves on', () => {
    const list = [at('next', NOW + 24 * HOUR), at('morning', NOW - 3 * HOUR), at('yesterday', NOW - 20 * HOUR)]
    expect(nextTraining(list, NOW, never, never)).toEqual({ training: list[1], phase: 'after' })
    expect(nextTraining(list, NOW, id => id === 'morning', never)).toEqual({ training: list[2], phase: 'after' })
    expect(nextTraining(list, NOW, () => true, never)).toEqual({ training: list[0], phase: 'before' })
  })

  it('after a day it is just a past training', () => {
    expect(nextTraining([at('old', NOW - 30 * HOUR)], NOW, never, never)).toBeNull()
  })

  it('says where each training is', () => {
    expect(trainingBadge({ phase: 'before', planned: false })).toEqual({ label: 'Plan not written', tone: 'warning' })
    expect(trainingBadge({ phase: 'before', planned: true })).toEqual({ label: 'Plan ready', tone: 'success' })
    expect(trainingBadge({ phase: 'day', planned: false })).toEqual({ label: 'Today', tone: 'success' })
    expect(trainingBadge({ phase: 'after', planned: true, here: 15 })).toEqual({ label: '15 here', tone: 'success' })
    expect(trainingBadge({ phase: 'after', planned: true, here: null })).toEqual({ label: 'Finished', tone: 'neutral' })
  })
})

describe('the card’s loop', () => {
  const errors = (facts: Parameters<typeof loopSteps>[0]) => loopSteps(facts).map(step => 'error' in step ? step.error : null)

  it('ticks a step it has passed only if it happened, else says what’s missing', () => {
    // After the training, with a plan but no register (Dora's Counter-attacks, 3 Nov).
    expect(errors({ current: 3, planned: true, registered: false })).toEqual([null, null, 'No register taken', null])
    expect(errors({ current: 3, planned: false, registered: false })).toEqual([null, 'No plan written', 'No register taken', null])
    expect(errors({ current: 3, planned: true, registered: true })).toEqual([null, null, null, null])
    // On the day without a plan: Who's here is current, so only Plan is marked.
    expect(errors({ current: 2, planned: false, registered: false })).toEqual([null, 'No plan written', null, null])
  })

  it('a step still to come is never marked', () => {
    expect(errors({ current: 1, planned: false, registered: false })).toEqual([null, null, null, null])
  })
})

describe('Notes and Past trainings', () => {
  it('names each answer', () => {
    expect(againLabel('changes')).toBe('Yes, with changes')
    expect(againLabel(null)).toBeNull()
  })

  it('search finds the title, a drill or the note', () => {
    const past = [{ title: 'Pressing', practices: [{ name: 'Rondo 4 v 2' }], note: '' }, { title: 'Finishing', practices: [], note: 'Grids too small' }]
    expect(searchPast(past, 'rondo')).toEqual([past[0]])
    expect(searchPast(past, 'grids small')).toEqual([past[1]])
    expect(searchPast(past, '  ')).toEqual(past)
  })
})
