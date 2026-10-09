import { afterEach, describe, expect, it } from 'vitest'
import {
  eventHeading,
  isChanged,
  markEventOpened,
  noteEventsShown,
  readSeenSequences,
  toPlayerEvent,
  type PlayerEvent,
} from '../player-events'

// TRAK-130 (J8.7): what a player sees of their squad's events. Rows come from
// coach_calendar_events; J8.2 (TRAK-125) adds the meet time, kit, home/away,
// status, cancel reason and change sequence. Until then those columns are
// absent and every event reads as scheduled, sequence 0.

const ROW = {
  id: 'ev-1', event_type: 'match', title: 'League match', event_date: '2026-11-14', start_time: '10:00:00',
  starts_at: '2026-11-14T06:00:00Z', venue: 'Rivals Park', opponent: 'Rivals FC',
  meet_time: '09:15:00', kit: 'White', home_away: 'away', status: 'scheduled', cancel_reason: null, sequence: 2,
}

afterEach(() => localStorage.clear())

describe('toPlayerEvent', () => {
  it('reads every field the player sees, with times as the coach typed them', () => {
    expect(toPlayerEvent(ROW)).toEqual({
      id: 'ev-1', kind: 'match', title: 'League match', date: '2026-11-14', time: '10:00', meetTime: '09:15',
      venue: 'Rivals Park', kit: 'White', opponent: 'Rivals FC', homeAway: 'away',
      status: 'scheduled', cancelReason: null, sequence: 2,
    })
  })

  it('reads a row written before J8.2 as scheduled, sequence 0, with no meet time or kit', () => {
    const { meet_time: _m, kit: _k, home_away: _h, status: _s, cancel_reason: _c, sequence: _q, ...old } = ROW
    expect(toPlayerEvent(old)).toMatchObject({ status: 'scheduled', sequence: 0, meetTime: null, kit: null, homeAway: null, cancelReason: null })
  })

  it('keeps an untimed event on its own day with no time', () => {
    expect(toPlayerEvent({ ...ROW, start_time: null })).toMatchObject({ date: '2026-11-14', time: null })
  })

  it('reads a cancellation and its reason', () => {
    expect(toPlayerEvent({ ...ROW, status: 'cancelled', cancel_reason: 'Pitch closed' }))
      .toMatchObject({ status: 'cancelled', cancelReason: 'Pitch closed' })
  })

  it('treats an unknown type as other, and refuses a row with no date', () => {
    expect(toPlayerEvent({ ...ROW, event_type: 'gala' })?.kind).toBe('other')
    expect(toPlayerEvent({ ...ROW, event_date: null, starts_at: null })).toBeNull()
  })
})

describe('eventHeading', () => {
  const ev = toPlayerEvent(ROW)!
  it('names a match by its opponent and home or away', () => {
    expect(eventHeading(ev)).toBe('Match vs Rivals FC (away)')
    expect(eventHeading({ ...ev, homeAway: null })).toBe('Match vs Rivals FC')
    expect(eventHeading({ ...ev, opponent: null })).toBe('League match')
  })
  it('uses the coach\'s title for other events, or the type when there is none', () => {
    expect(eventHeading({ ...ev, kind: 'training', title: 'Finishing session' })).toBe('Finishing session')
    expect(eventHeading({ ...ev, kind: 'training', title: '  ' })).toBe('Training')
    expect(eventHeading({ ...ev, kind: 'other', title: null })).toBe('Event')
  })
})

describe('"Changed" until the player opens the event (per device, like the parent bell)', () => {
  const ev = (sequence: number, extra: Partial<PlayerEvent> = {}): PlayerEvent =>
    ({ ...toPlayerEvent(ROW)!, sequence, ...extra })

  it('an event seen for the first time is not "Changed": the player never saw an older version', () => {
    const seen = noteEventsShown('player-1', [ev(3)])
    expect(isChanged(ev(3), seen)).toBe(false)
  })

  it('a change after the player saw it shows "Changed", until they open it', () => {
    noteEventsShown('player-1', [ev(0)])
    const seen = noteEventsShown('player-1', [ev(1)])
    expect(isChanged(ev(1), seen)).toBe(true)
    markEventOpened('player-1', ev(1))
    expect(isChanged(ev(1), readSeenSequences('player-1'))).toBe(false)
  })

  it('a cancelled event shows Cancelled, not Changed', () => {
    noteEventsShown('player-1', [ev(0)])
    const seen = noteEventsShown('player-1', [ev(1, { status: 'cancelled' })])
    expect(isChanged(ev(1, { status: 'cancelled' }), seen)).toBe(false)
  })

  it('keeps each player\'s record apart on a shared phone', () => {
    noteEventsShown('player-1', [ev(0)])
    expect(readSeenSequences('player-2')).toEqual({})
  })

  it('works, without remembering, when storage is unavailable', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('blocked') }
    try {
      expect(() => noteEventsShown('player-1', [ev(0)])).not.toThrow()
      expect(() => markEventOpened('player-1', ev(0))).not.toThrow()
    } finally {
      Storage.prototype.setItem = original
    }
  })
})
