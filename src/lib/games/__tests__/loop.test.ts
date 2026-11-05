import { describe, expect, it } from 'vitest'
import { format } from 'date-fns'
import { STATE, fullTime, gameState, gameStatus, matchActions, matchClock, needsAPlan, orderGames, type GameEvent } from '../loop'

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

  it('offers one next action before kick-off, none while the match is on, and the evaluation from full time (TRAK-288)', () => {
    expect(STATE.logistics.action).toEqual({ label: 'Share logistics', tab: 'logistics' })
    expect(STATE.plan.action).toEqual({ label: 'Write plan', tab: 'plan' })
    expect(STATE.locked.action).toBeUndefined()
    expect(STATE.fullTime.action).toEqual({ label: 'Evaluate', tab: 'evaluation' })
  })
})

describe('an evaluation draft (TRAK-288)', () => {
  it('after full time a saved evaluation is a draft only the coach sees, and publishing it is next', () => {
    expect(gameState(game(), Date.parse('2026-10-31T10:30:00Z'), { evaluated: true })).toBe('evaluationDraft')
    expect(STATE.evaluationDraft).toMatchObject({ label: 'Evaluation draft', tone: 'warning', action: { label: 'Publish', tab: 'evaluation' } })
  })

  it('it can\'t be one before full time', () => {
    expect(gameState(game(), Date.parse('2026-10-31T10:29:59Z'), { evaluated: true })).toBe('locked')
  })
})

describe('a published evaluation (TRAK-289)', () => {
  it('closes the loop: Published, with nothing left to do', () => {
    expect(gameState(game(), Date.parse('2026-10-31T12:00:00Z'), { evaluated: true, published: true })).toBe('published')
    expect(STATE.published).toMatchObject({ label: 'Published', tone: 'success' })
    expect(STATE.published.action).toBeUndefined()
  })
})

describe('a plan draft (TRAK-284)', () => {
  it('a published match with a plan draft before kick-off is a Draft (TRAK-344); sharing it is next (TRAK-286)', () => {
    expect(gameState(game(), KICK_OFF - 1000, { drafted: true })).toBe('planDraft')
    expect(STATE.planDraft).toMatchObject({ label: 'Draft', action: { label: 'Share plan', tab: 'plan', step: 'share' } })
  })

  it('a draft changes nothing while the logistics wait, or after kick-off', () => {
    expect(gameState(game({ published: false }), KICK_OFF - 1000, { drafted: true })).toBe('logistics')
    expect(gameState(game(), KICK_OFF, { drafted: true })).toBe('locked')
  })
})

describe('a shared plan (TRAK-286)', () => {
  it('a shared plan closes the draft; there is nothing to do until kick-off', () => {
    expect(gameState(game(), KICK_OFF - 1000, { drafted: true, shared: true })).toBe('shared')
    expect(STATE.shared).toMatchObject({ label: 'Plan shared', tone: 'success' })
    expect(STATE.shared.action).toBeUndefined()
  })

  it('edits after sharing wait for "Share changes"', () => {
    expect(gameState(game(), KICK_OFF - 1000, { drafted: true, shared: true, changes: 2 })).toBe('changes')
    expect(STATE.changes).toMatchObject({ label: 'Changes not shared', tone: 'warning', action: { label: 'Share changes', tab: 'plan', step: 'share' } })
  })

  it('at kick-off a shared plan locks, changes or not', () => {
    expect(gameState(game(), KICK_OFF, { drafted: true, shared: true, changes: 2 })).toBe('locked')
  })
})

describe('a scheduled plan (TRAK-290)', () => {
  // Shares Thu 29 Oct, 19:30 in Dubai.
  const at = '2026-10-29T15:30:00Z'
  const scheduled = { drafted: true, shared: true, sharedAt: at }

  it('waits for its time with nothing to do; the badge says when it goes out, on this phone\'s clock', () => {
    expect(gameState(game(), Date.parse(at) - 1000, scheduled)).toBe('scheduled')
    expect(STATE.scheduled.action).toBeUndefined()
    expect(gameStatus(game(), Date.parse(at) - 1000, scheduled)).toMatchObject({ label: `Shares ${format(new Date(at), 'EEE HH:mm')}`, tone: 'info' })
  })

  it('from its time it is a shared plan, and later edits wait for "Share changes"', () => {
    expect(gameState(game(), Date.parse(at), scheduled)).toBe('shared')
    expect(gameStatus(game(), Date.parse(at), scheduled).label).toBe('Plan shared')
    expect(gameState(game(), Date.parse(at) + 1000, { ...scheduled, changes: 1 })).toBe('changes')
  })

  it('a plan still waiting at kick-off locks with the match', () => {
    expect(gameState(game(), KICK_OFF, { ...scheduled, sharedAt: '2026-10-31T10:00:00Z' })).toBe('locked')
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

  it('lists matches played in the last two weeks first, then upcoming soonest first, then older ones; the next game is the soonest upcoming', () => {
    const { next, games } = orderGames([at('past-old', 3), at('later', 30), at('past-new', 17), at('soon', 24), at('past-newer', 19)], now)
    // TRAK-326: past-newer and past-new kicked off 1 and 3 days ago; past-old 17 days ago, outside the two weeks.
    expect(games.map(g => g.id)).toEqual(['past-newer', 'past-new', 'soon', 'later', 'past-old'])
    expect(next?.id).toBe('soon')
  })

  it('a match in progress is first too (TRAK-326)', () => {
    const { next, games } = orderGames([at('next-week', 27), at('today', 20)], Date.parse('2026-10-20T09:30:00Z'))
    expect(games.map(g => g.id)).toEqual(['today', 'next-week'])
    expect(next?.id).toBe('next-week')
  })

  it('a match that has kicked off is no longer the next game', () => {
    const { next } = orderGames([at('today', 20), at('next-week', 27)], Date.parse('2026-10-20T09:00:00Z'))
    expect(next?.id).toBe('next-week')
  })

  it('with only past matches there is no next game', () => {
    expect(orderGames([at('past', 3)], now).next).toBeNull()
  })
})

describe('matchActions (TRAK-333)', () => {
  const names = (state: Parameters<typeof matchActions>[0]) => {
    const actions = matchActions(state)
    return actions && [actions.main.label, ...actions.more.map(action => action.label)]
  }

  it('a split button: the next action first, then the match\'s other pages behind the chevron (Imad, 2 Nov)', () => {
    expect(names('logistics')).toEqual(['Share logistics', 'View plan'])
    expect(names('plan')).toEqual(['Write plan', 'Logistics'])
    expect(names('planDraft')).toEqual(['Share plan', 'Logistics'])
    expect(names('changes')).toEqual(['Share changes', 'View plan', 'Logistics'])
    expect(names('fullTime')).toEqual(['Evaluate', 'View plan', 'Logistics'])
    expect(names('evaluationDraft')).toEqual(['Publish', 'View plan', 'Logistics'])
  })

  it('a shared or scheduled plan, with nothing due, offers View plan', () => {
    expect(names('shared')).toEqual(['View plan', 'Logistics'])
    expect(names('scheduled')).toEqual(['View plan', 'Logistics'])
    expect(matchActions('shared')!.main).toEqual({ label: 'View plan', tab: 'plan' })
  })

  it('nothing while the match is on, or once it is published', () => {
    expect(matchActions('locked')).toBeNull()
    expect(matchActions('published')).toBeNull()
  })
})

// TRAK-373 (Imad, 5 Nov): the match clock. A 09:00 to 10:45 slot: two halves of 45 minutes and 15 of half-time.
describe('matchClock (TRAK-373)', () => {
  const MIN = 60_000
  const slot = game({ ends_at: '2026-10-31T10:45:00+00:00' })
  const at = (minutes: number, seconds = 0) => KICK_OFF + minutes * MIN + seconds * 1000

  it('waits before kick-off, and is over from full time', () => {
    expect(matchClock(slot, KICK_OFF - 1000)).toBe('before')
    expect(matchClock(slot, at(105))).toBe('over')
    expect(matchClock(slot, at(200))).toBe('over')
  })

  it('counts the minute as on TV: the first minute is 1\', 14 minutes played is 15\', the last of the half 45\'', () => {
    expect(matchClock(slot, KICK_OFF)).toEqual({ minute: 1, share: 0 })
    expect(matchClock(slot, at(0, 59))).toMatchObject({ minute: 1 })
    expect(matchClock(slot, at(14))).toEqual({ minute: 15, share: 14 / 90 })
    expect(matchClock(slot, at(14, 59))).toMatchObject({ minute: 15 })
    expect(matchClock(slot, at(44, 59))).toMatchObject({ minute: 45 })
  })

  it('is HT for the 15 minutes in the middle of the slot, the bar halfway', () => {
    expect(matchClock(slot, at(45))).toEqual({ minute: 'HT', share: 0.5 })
    expect(matchClock(slot, at(59, 59))).toEqual({ minute: 'HT', share: 0.5 })
  })

  it('picks up the second half where the first stopped, to the last minute', () => {
    expect(matchClock(slot, at(60))).toEqual({ minute: 46, share: 0.5 })
    expect(matchClock(slot, at(61))).toMatchObject({ minute: 47 })
    expect(matchClock(slot, at(104, 59))).toMatchObject({ minute: 90 })
  })

  it('a match with no end runs 90 minutes after kick-off, half-time included', () => {
    const open = game({ ends_at: null })
    expect(matchClock(open, at(37))).toMatchObject({ minute: 38 })
    expect(matchClock(open, at(37, 30))).toEqual({ minute: 'HT', share: 0.5 })
    expect(matchClock(open, at(52, 30))).toMatchObject({ minute: 38 })
    expect(matchClock(open, at(90))).toBe('over')
  })

  it('a slot of 30 minutes or less has no half-time', () => {
    const short = game({ ends_at: '2026-10-31T09:30:00+00:00' })
    expect(matchClock(short, at(15))).toEqual({ minute: 16, share: 0.5 })
    expect(matchClock(short, at(29, 59))).toMatchObject({ minute: 30 })
  })
})
