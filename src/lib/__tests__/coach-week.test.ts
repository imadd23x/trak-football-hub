import { describe, it, expect } from 'vitest'
import { coachWeek, type WeekSession } from '../coach-week'
import type { EventRow } from '../coach-events'

// TRAK-262: the week's colour key and one next step per event. "Now" is Wed 21 Oct, 12:00 UTC.
const now = new Date('2026-10-21T12:00:00Z')
const dates = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']
const event = (id: string, date: string, time: string, extra: Partial<EventRow> = {}): EventRow => ({
  id, title: id, event_type: 'training', event_date: date, start_time: `${time}:00`,
  starts_at: `${date}T${time}:00Z`, published: true, status: 'scheduled', squad: null, ...extra,
})
const session = (id: string, date: string, extra: Partial<WeekSession> = {}): WeekSession => ({
  id, event_id: null, title: id, session_type: 'training', session_date: date, venue: null, squad: null, ...extra,
})
const all = () => true
const week = (events: EventRow[], sessions: WeekSession[] = [], inView: (s: string | null | undefined) => boolean = all) =>
  [...coachWeek({ dates, events, sessions, inView, now }).values()].flat()
const one = (events: EventRow[], sessions: WeekSession[] = []) => week(events, sessions)[0]

describe('coach week', () => {
  it('a draft is publishable and only the coach sees it', () => {
    expect(one([event('d', '2026-10-23', '18:00', { published: false })])).toMatchObject({ state: 'draft', step: 'publish' })
  })

  it('a draft that would clash with a live event is red, with no Publish', () => {
    const item = week([
      event('live', '2026-10-23', '17:00', { title: 'vs Ajax', ends_at: '2026-10-23T18:30:00Z' }),
      event('d', '2026-10-23', '18:00', { published: false }),
    ]).find(i => i.id === 'd')!
    expect(item).toMatchObject({ state: 'clash', step: null, note: 'Clashes with vs Ajax 17:00–18:30' })
  })

  it('a published event still to come is shared with families', () => {
    expect(one([event('p', '2026-10-23', '18:00')])).toMatchObject({ state: 'published', step: 'share' })
  })

  it('a started training with no register needs you: take the register', () => {
    expect(one([event('t', '2026-10-20', '18:00')])).toMatchObject({ state: 'needs-you', step: 'register' })
  })

  it('a started match with no log needs you: log it', () => {
    expect(one([event('m', '2026-10-20', '18:00', { event_type: 'match' })])).toMatchObject({ state: 'needs-you', step: 'log' })
  })

  // TRAK-288: where Games is on (`evaluated` is given), the evaluation replaces the match log.
  describe('where Games is on', () => {
    const games = (events: EventRow[], evaluated: string[] = []) =>
      [...coachWeek({ dates, events, sessions: [], inView: all, now, evaluated: new Set(evaluated) }).values()].flat()[0]

    it('a match still being played waits for full time', () => {
      expect(games([event('m', '2026-10-21', '11:00', { event_type: 'match', ends_at: '2026-10-21T12:30:00Z' })]))
        .toMatchObject({ state: 'published', step: null })
    })

    it('from full time it needs you: evaluate it', () => {
      expect(games([event('m', '2026-10-21', '10:00', { event_type: 'match', ends_at: '2026-10-21T11:30:00Z' })]))
        .toMatchObject({ state: 'needs-you', note: 'Evaluate the match', step: 'evaluate' })
      // No end: 90 minutes after kick-off, to the minute.
      expect(games([event('m', '2026-10-21', '10:31', { event_type: 'match' })])).toMatchObject({ state: 'published', step: null })
      expect(games([event('m', '2026-10-21', '10:30', { event_type: 'match' })])).toMatchObject({ state: 'needs-you', step: 'evaluate' })
    })

    it('with a draft saved, publishing it is next', () => {
      expect(games([event('m', '2026-10-20', '18:00', { event_type: 'match' })], ['m']))
        .toMatchObject({ state: 'needs-you', note: 'Evaluation draft', step: 'publish-evaluation' })
    })

    it('once published (TRAK-289) the match is done: its session says Published and opens the review, not the old log', () => {
      const items = [...coachWeek({ dates, events: [event('m', '2026-10-20', '18:00', { event_type: 'match' })],
        sessions: [session('s', '2026-10-20', { event_id: 'm', session_type: 'match' })], inView: all, now, evaluated: new Set(),
        published: new Set(['m']) }).values()].flat()
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ state: 'logged', note: 'Published', step: 'review' })
    })

    it('a match logged the old way stays logged', () => {
      const items = [...coachWeek({ dates, events: [event('m', '2026-10-20', '18:00', { event_type: 'match' })],
        sessions: [session('s', '2026-10-20', { event_id: 'm', session_type: 'match' })], inView: all, now, evaluated: new Set() }).values()].flat()
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ state: 'logged' })
    })
  })

  it('a started draft never needs you: families were never told', () => {
    expect(one([event('d', '2026-10-20', '18:00', { published: false })])).toMatchObject({ state: 'draft' })
  })

  it('a cancelled event offers nothing, started or not', () => {
    expect(one([event('c', '2026-10-20', '18:00', { status: 'cancelled' })])).toMatchObject({ state: 'cancelled', step: null })
  })

  it('a logged event shows once, as its session, with View log', () => {
    const items = week([event('e', '2026-10-20', '18:00')], [session('s', '2026-10-20', { event_id: 'e' })])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'session:s', state: 'logged', step: 'view', sessionId: 's', time: null })
  })

  it("a logged match keeps its event's kick-off", () => {
    const items = week([event('e', '2026-10-20', '18:00', { event_type: 'match', opponent: 'Rovers' })],
      [session('s', '2026-10-20', { event_id: 'e', session_type: 'match' })])
    expect(items[0]).toMatchObject({ kind: 'match', time: '18:00' })
    expect(items[0].source).toMatchObject({ opponent: 'Rovers', start_time: '18:00:00' })
  })

  it('a logged session moved to another week is left out', () => {
    expect(week([event('e', '2026-10-20', '18:00')], [session('s', '2026-10-27', { event_id: 'e' })])).toHaveLength(0)
  })

  it('shows the squad in view, but a clash counts every squad', () => {
    const items = week([
      event('u16', '2026-10-23', '17:00', { squad: 'U16' }),
      event('u14', '2026-10-23', '17:30', { squad: 'U14', published: false }),
    ], [], squad => squad == null || squad === 'U14')
    expect(items.map(i => [i.id, i.state])).toEqual([['u14', 'clash']])
  })

  it('lists each day in time order, no time last', () => {
    const items = week([event('late', '2026-10-23', '19:00'), event('early', '2026-10-23', '08:00'), { ...event('none', '2026-10-23', '00:00'), start_time: null }])
    expect(items.map(i => i.id)).toEqual(['early', 'late', 'none'])
  })
})
