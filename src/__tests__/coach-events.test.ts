import { describe, it, expect } from 'vitest'
import { blankForm, canDelete, formProblem, formToRow, rowToForm, savedVenues, type EventForm } from '@/lib/coach-events'
import { toInstant } from '@/lib/event-time'

/** TRAK-127 (J8.4): the event form and its row, without the screen. */

const match: EventForm = {
  ...blankForm('2026-10-20'), kind: 'match', opponent: 'Synthetic United', time: '16:00',
  duration: 75, venue: ' United Ground ', meetTime: '15:15', homeAway: 'home', kit: 'Red',
}

describe('coach event form', () => {
  it('round-trips a match through its row', () => {
    const row = { id: 'e', published: true, status: 'scheduled', ...formToRow(match) }
    expect(row.venue).toBe('United Ground')
    expect(rowToForm(row)).toEqual({ ...match, venue: 'United Ground' })
  })

  it('keeps a typed title and drops match-only fields from a training', () => {
    const row = formToRow({ ...match, kind: 'training', title: 'Finishing' })
    expect(row).toMatchObject({ title: 'Finishing', event_type: 'training', opponent: null, home_away: null, kit: null })
  })

  it('leaves the end blank without a start, and the wall-clock end blank past midnight', () => {
    expect(formToRow({ ...match, time: '', meetTime: '' })).toMatchObject({ ends_at: null, end_time: null, start_time: null })
    const late = formToRow({ ...match, time: '23:00', duration: 90 })
    expect(late.end_time).toBeNull()
    expect(late.ends_at).toBe(new Date(new Date(toInstant('2026-10-20', '23:00')!).getTime() + 90 * 60_000).toISOString())
  })

  it('refuses an impossible date, a meet time with no start, and an untitled "other"', () => {
    expect(formProblem({ ...match, date: '2026-02-31' })).toBe('Pick a real date and time')
    expect(formProblem({ ...match, time: '' })).toBe('Add the start time before the meet time')
    expect(formProblem({ ...blankForm('2026-10-20'), kind: 'other' })).toBe('Say what the event is')
    expect(formProblem(match)).toBeNull()
  })

  it('deletes only a draft that was never published and is not cancelled', () => {
    expect(canDelete({ published: false, status: 'scheduled' })).toBe(true)
    expect(canDelete({ published: true, status: 'scheduled' })).toBe(false)
    expect(canDelete({ published: false, status: 'cancelled' })).toBe(false)
  })

  it('lists saved venues once each, most recently used first', () => {
    expect(savedVenues([
      { venue: 'Pitch 1', starts_at: '2026-10-01T10:00:00Z' },
      { venue: 'Rovers Park', starts_at: '2026-10-05T10:00:00Z' },
      { venue: 'pitch 1 ', starts_at: '2026-10-09T10:00:00Z' },
      { venue: null, starts_at: '2026-10-10T10:00:00Z' },
    ])).toEqual(['pitch 1', 'Rovers Park'])
  })
})
