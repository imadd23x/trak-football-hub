import { describe, expect, it } from 'vitest'
import { LOOP_STEPS, STATE, fullTime, gameState, needsAPlan, orderGames, type GameEvent } from '../loop'

// Kick-off Sat 31 Oct 2026, 11:00 in Athens (09:00Z); the clock is an instant, so the device's zone never matters.
const KICK_OFF = Date.parse('2026-10-31T09:00:00Z')
const game = (over: Partial<GameEvent> = {}): GameEvent =>
  ({ id: 'g', published: true, starts_at: '2026-10-31T09:00:00+00:00', ends_at: '2026-10-31T10:30:00+00:00', ...over })

describe('gameState (TRAK-283)', () => {
  it('a match whose logistics are a draft waits for them, before and after kick-off', () => {
    expect(gameState(game({ published: false }), KICK_OFF - 1000)).toBe('logistics')
    expect(gameState(game({ published: false }), KICK_OFF + 1000)).toBe('logistics')
  })

  it('a published match before kick-off has no plan yet', () => {
    expect(gameState(game(), KICK_OFF - 1000)).toBe('plan')
  })

  it('locks at kick-off, to the second', () => {
    expect(gameState(game(), KICK_OFF)).toBe('locked')
    expect(gameState(game(), KICK_OFF + 1000)).toBe('locked')
  })

  it('reaches full time at the event\'s end, or 90 minutes after kick-off when it has none', () => {
    expect(gameState(game(), Date.parse('2026-10-31T10:29:59Z'))).toBe('locked')
    expect(gameState(game(), Date.parse('2026-10-31T10:30:00Z'))).toBe('fullTime')
    expect(fullTime(game({ ends_at: null }))).toBe(KICK_OFF + 90 * 60_000)
  })

  it('a moved match moves its states with it', () => {
    const moved = game({ starts_at: '2026-11-07T09:00:00+00:00', ends_at: '2026-11-07T10:30:00+00:00' })
    expect(gameState(moved, KICK_OFF + 1000)).toBe('plan')
  })

  it('names each state on the loop the stepper draws', () => {
    expect(LOOP_STEPS).toEqual(['Logistics', 'Plan', 'Shared', 'Kick-off', 'Evaluation', 'Published'])
    expect(LOOP_STEPS[STATE.logistics.step]).toBe('Logistics')
    expect(LOOP_STEPS[STATE.plan.step]).toBe('Plan')
    expect(LOOP_STEPS[STATE.locked.step]).toBe('Kick-off')
    expect(LOOP_STEPS[STATE.fullTime.step]).toBe('Evaluation')
  })

  it('offers one next action before kick-off, none while the match is on, and the evaluation from full time (TRAK-288)', () => {
    expect(STATE.logistics.action).toEqual({ label: 'Share the logistics', tab: 'logistics' })
    expect(STATE.plan.action).toEqual({ label: 'Write the plan', tab: 'plan' })
    expect(STATE.locked.action).toBeUndefined()
    expect(STATE.fullTime.action).toEqual({ label: 'Evaluate', tab: 'evaluation' })
  })
})

describe('an evaluation draft (TRAK-288)', () => {
  it('after full time a saved evaluation is a draft only the coach sees, and publishing it is next', () => {
    expect(gameState(game(), Date.parse('2026-10-31T10:30:00Z'), { evaluated: true })).toBe('evaluationDraft')
    expect(STATE.evaluationDraft).toMatchObject({ label: 'Evaluation draft', tone: 'warning', action: { label: 'Publish', tab: 'evaluation' } })
    expect(LOOP_STEPS[STATE.evaluationDraft.step]).toBe('Evaluation')
  })

  it('it can\'t be one before full time', () => {
    expect(gameState(game(), Date.parse('2026-10-31T10:29:59Z'), { evaluated: true })).toBe('locked')
  })
})

describe('a published evaluation (TRAK-289)', () => {
  it('closes the loop: Published, with nothing left to do', () => {
    expect(gameState(game(), Date.parse('2026-10-31T12:00:00Z'), { evaluated: true, published: true })).toBe('published')
    expect(STATE.published).toMatchObject({ label: 'Published', tone: 'success' })
    expect(LOOP_STEPS[STATE.published.step]).toBe('Published')
    expect(STATE.published.action).toBeUndefined()
  })
})

describe('a plan draft (TRAK-284)', () => {
  it('a published match with a plan draft before kick-off has a plan that is not shared; sharing it is next (TRAK-286)', () => {
    expect(gameState(game(), KICK_OFF - 1000, { drafted: true })).toBe('planDraft')
    expect(STATE.planDraft).toMatchObject({ label: 'Plan not shared', step: 1, action: { label: 'Share the plan', tab: 'plan', step: 'share' } })
  })

  it('a draft changes nothing while the logistics wait, or after kick-off', () => {
    expect(gameState(game({ published: false }), KICK_OFF - 1000, { drafted: true })).toBe('logistics')
    expect(gameState(game(), KICK_OFF, { drafted: true })).toBe('locked')
  })
})

describe('a shared plan (TRAK-286)', () => {
  it('a shared plan closes "Plan not shared"; there is nothing to do until kick-off', () => {
    expect(gameState(game(), KICK_OFF - 1000, { drafted: true, shared: true })).toBe('shared')
    expect(STATE.shared).toMatchObject({ label: 'Plan shared', tone: 'success' })
    expect(LOOP_STEPS[STATE.shared.step]).toBe('Shared')
    expect(STATE.shared.action).toBeUndefined()
  })

  it('edits after sharing wait for "Share the changes"', () => {
    expect(gameState(game(), KICK_OFF - 1000, { drafted: true, shared: true, changes: 2 })).toBe('changes')
    expect(STATE.changes).toMatchObject({ label: 'Changes not shared', tone: 'warning', action: { label: 'Share the changes', tab: 'plan', step: 'share' } })
    expect(LOOP_STEPS[STATE.changes.step]).toBe('Shared')
  })

  it('at kick-off a shared plan locks, changes or not', () => {
    expect(gameState(game(), KICK_OFF, { drafted: true, shared: true, changes: 2 })).toBe('locked')
  })
})

describe('needsAPlan (TRAK-284)', () => {
  const now = Date.parse('2026-10-24T09:00:00Z')
  const at = (id: string, startsAt: string, published = true) => game({ id, published, starts_at: startsAt, ends_at: null })

  it('Needs you lists published matches kicking off within 7 days, soonest first', () => {
    const games = [
      at('in-7-days', '2026-10-31T09:00:00+00:00'), at('tomorrow', '2026-10-25T09:00:00+00:00'),
      at('in-8-days', '2026-11-01T09:00:00+00:00'), at('draft-logistics', '2026-10-26T09:00:00+00:00', false),
      at('kicked-off', '2026-10-24T09:00:00+00:00'),
    ]
    expect(needsAPlan(games, now).map(g => g.id)).toEqual(['tomorrow', 'in-7-days'])
  })
})

describe('orderGames (TRAK-283)', () => {
  const at = (id: string, day: number) => game({ id, starts_at: `2026-10-${String(day).padStart(2, '0')}T09:00:00+00:00`, ends_at: null })
  const now = Date.parse('2026-10-20T12:00:00Z')

  it('lists upcoming matches soonest first, then past ones newest first; the next game is the soonest upcoming', () => {
    const { next, games } = orderGames([at('past-old', 3), at('later', 30), at('past-new', 17), at('soon', 24)], now)
    expect(games.map(g => g.id)).toEqual(['soon', 'later', 'past-new', 'past-old'])
    expect(next?.id).toBe('soon')
  })

  it('a match that has kicked off is no longer the next game', () => {
    const { next } = orderGames([at('today', 20), at('next-week', 27)], Date.parse('2026-10-20T09:00:00Z'))
    expect(next?.id).toBe('next-week')
  })

  it('with only past matches there is no next game', () => {
    expect(orderGames([at('past', 3)], now).next).toBeNull()
  })
})
