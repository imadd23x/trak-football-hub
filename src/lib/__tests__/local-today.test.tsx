/**
 * S7: dates a person means in their own day must not come from the UTC clock.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date. In Dubai (UTC+4)
 * that is still YESTERDAY from local midnight until 04:00; in Athens until
 * 03:00 in summer and 02:00 after the 25 October clock change, inside the
 * pilot. A coach adding a session at 01:30 got yesterday as the default date,
 * and the schedule importer resolved "next Saturday" from the wrong day.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { calendarFields, displayEventTime, localTodayISO, toInstant } from '@/lib/event-time'
import { renderApp } from '../../../tests/support/render-app'
import { signInAs } from '../../../tests/support/session'
import { server } from '../../../tests/msw/server'
import { table } from '../../../tests/msw/supabase'

const realTZ = process.env.TZ
function at(tz: string, utcInstant: string) {
  process.env.TZ = tz
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(utcInstant))
}
afterEach(() => { vi.useRealTimers(); process.env.TZ = realTZ })

describe('localTodayISO', () => {
  it.each([
    ['Asia/Dubai',    '2026-10-01T21:30:00Z', '2026-10-02'], // 01:30 local, UTC still the 1st
    ['Europe/Athens', '2026-09-30T22:30:00Z', '2026-10-01'], // 01:30 EEST (UTC+3)
    ['Europe/Athens', '2026-10-25T23:30:00Z', '2026-10-26'], // 01:30 EET, after the clock change
    ['UTC',           '2026-10-01T21:30:00Z', '2026-10-01'], // control: no offset, no shift
  ])('%s at %s is %s', (tz, instant, expected) => {
    at(tz, instant)
    expect(localTodayISO()).toBe(expected)
  })
})

describe('the add-session screen defaults to the coach\'s local day', () => {
  it('in Dubai at 01:30 local, today is the 2nd, not the UTC 1st', async () => {
    at('Asia/Dubai', '2026-10-01T21:30:00Z')
    signInAs({ id: 'coach-s7' })
    server.use(
      table('profiles', [{ id: 'p', user_id: 'coach-s7', role: 'coach', full_name: 'Coach', nationality: 'AE', invite_code: 'ABCD' }]),
      table('squad_players', []), table('coach_details', []), table('coach_sessions', []), table('coach_calendar_events', []),
    )
    renderApp('/coach/sessions/add')
    const dateInput = await screen.findByDisplayValue(/^2026-10-0[12]$/)
    expect((dateInput as HTMLInputElement).value).toBe('2026-10-02')
  })
})

// S7 round trip: what a coach types is what everyone reads, in both zones,
// and the stored instant is the real moment, including across 25 October.
describe('S7: a session saved in Dubai or Athens reads back as typed', () => {
  it.each([
    // [zone typed in, date, time, expected instant, zone read in]
    ['Asia/Dubai',    '2026-10-24', '18:00', '2026-10-24T14:00:00.000Z', 'Europe/Athens'],
    ['Europe/Athens', '2026-10-24', '18:00', '2026-10-24T15:00:00.000Z', 'Asia/Dubai'],    // EEST, UTC+3
    ['Europe/Athens', '2026-10-26', '18:00', '2026-10-26T16:00:00.000Z', 'Asia/Dubai'],    // EET, UTC+2, after the change
    ['Europe/Athens', '2026-10-25', '02:30', '2026-10-24T23:30:00.000Z', 'Europe/Athens'], // before 03:00 on change day
  ])('typed in %s: %s %s → %s, read in %s unchanged', (tzWrite, date, time, instant, tzRead) => {
    process.env.TZ = tzWrite
    const starts_at = toInstant(date, time)
    const fields = calendarFields(date, time)!
    expect(starts_at).toBe(instant)
    process.env.TZ = tzRead
    expect(displayEventTime({ ...fields, starts_at })).toEqual({ date, time })
  })
})
