import { describe, it, expect } from 'vitest'
import {
  MAX_SERIES_EVENTS, blankForm, blankRepeat, repeatProblem, seriesDates, seriesRows, thisAndFollowing,
  weekdayOf, type EventForm, type Repeat,
} from '@/lib/coach-events'
import { toAcademyInstant } from '@/lib/event-time'

/** TRAK-128 (J8.5): a weekly series, without the screen. 12 Oct 2026 is a Monday. */

const MON = 0, WED = 2
const training: EventForm = { ...blankForm('2026-10-12'), time: '18:00', venue: 'Academy Pitch 2' }
const repeat = (over: Partial<Repeat> = {}): Repeat => ({ on: true, days: [MON, WED], until: '2026-12-02', ...over })

describe('weekly series dates', () => {
  it('makes 8 weeks of Monday and Wednesday training: 16 dates, end date included', () => {
    const dates = seriesDates('2026-10-12', '2026-12-02', [MON, WED])
    expect(dates).toHaveLength(16)
    expect(dates.slice(0, 4)).toEqual(['2026-10-12', '2026-10-14', '2026-10-19', '2026-10-21'])
    expect(dates.at(-1)).toBe('2026-12-02')   // a Wednesday: the end date counts
    expect(dates.every(d => [MON, WED].includes(weekdayOf(d)))).toBe(true)
  })

  it('skips the start date when its weekday is not chosen', () => {
    expect(seriesDates('2026-10-12', '2026-10-25', [WED])).toEqual(['2026-10-14', '2026-10-21'])
  })

  it('crosses a month, a year and a leap day by the calendar, not the clock', () => {
    expect(seriesDates('2026-12-28', '2027-01-06', [MON])).toEqual(['2026-12-28', '2027-01-04'])
    expect(seriesDates('2028-02-28', '2028-03-01', [0, 1, 2, 3, 4, 5, 6])).toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
  })

  it('gives one date when the series starts and ends the same day', () => {
    expect(seriesDates('2026-10-12', '2026-10-12', [MON])).toEqual(['2026-10-12'])
    expect(seriesDates('2026-10-12', '2026-10-11', [MON])).toEqual([])
  })

  it("starts a new repeat on the first date's weekday, with no end date yet", () => {
    expect(blankRepeat('2026-10-14')).toEqual({ on: false, days: [WED], until: '' })
  })
})

describe('what the coach is told before a series saves', () => {
  it('needs a weekday and an end date on or after the start', () => {
    expect(repeatProblem(training, repeat({ days: [] }))).toBe('Select at least one day of the week')
    expect(repeatProblem(training, repeat({ until: '' }))).toBe('Select the date the series ends')
    expect(repeatProblem(training, repeat({ until: '2026-10-11' }))).toBe('The series has to end on or after its first date')
    expect(repeatProblem(training, repeat({ until: '2026-10-13', days: [WED] })))
      .toBe('None of those days fall between the start and end dates')
  })

  it(`refuses more than ${MAX_SERIES_EVENTS} events, so a mistyped year can't fill the calendar`, () => {
    expect(repeatProblem(training, repeat({ until: '2027-12-31' }))).toMatch(/^That makes \d+ events/)
    expect(repeatProblem(training, repeat())).toBeNull()
    expect(repeatProblem(training, { ...repeat(), on: false, until: '' })).toBeNull()
  })
})

describe('the rows a series saves', () => {
  it('puts the same details on every date, at that date’s Dubai time, under one series id', () => {
    const rows = seriesRows(training, repeat(), 'series-1')
    expect(rows).toHaveLength(16)
    expect(new Set(rows.map(r => r.series_id))).toEqual(new Set(['series-1']))
    expect(rows[3]).toMatchObject({
      event_date: '2026-10-21', start_time: '18:00:00', venue: 'Academy Pitch 2', event_type: 'training',
      starts_at: toAcademyInstant('2026-10-21', '18:00'),
    })
  })

  it('"this and following" is this week and every later, uncancelled week of the same series', () => {
    const r = (id: string, event_date: string, over: object = {}) =>
      ({ id, event_date, series_id: 'series-1', status: 'scheduled', ...over })
    const rows = [
      r('a', '2026-10-12'), r('b', '2026-10-14'), r('c', '2026-10-19', { status: 'cancelled' }),
      r('d', '2026-10-21'), r('x', '2026-10-21', { series_id: 'other' }),
    ]
    expect(thisAndFollowing(rows, rows[1]).map(x => x.id)).toEqual(['b', 'd'])
    const single = { id: 's', event_date: '2026-10-12', series_id: null, status: 'scheduled' }
    expect(thisAndFollowing([single, ...rows], single)).toEqual([single])
  })
})
