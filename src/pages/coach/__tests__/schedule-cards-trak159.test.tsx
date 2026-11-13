import { describe, it, expect, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'
import { localTodayISO, toInstant } from '@/lib/event-time'
import { CANCELLED_COLOR, EVENT_COLOR } from '@/lib/coach-events'

/**
 * TRAK-159 (J8.4), from the 11 Oct live run: Dora's 8 trainings had no time
 * and the calendar cards didn't say so; the paper-plane icon wasn't read as
 * "publish"; training and match were both green. Now each card says its time
 * or "No time set", Publish is a word, and the types have their own colours
 * (training blue, match red, other orange), with cancelled unlike match red.
 */

const COACH = { id: 'coach-1' }
const today = localTodayISO()

const row = (over: Record<string, unknown>) => ({
  coach_user_id: COACH.id, event_type: 'training', starts_at: toInstant(today, '18:00'), ends_at: null,
  event_date: today, start_time: '18:00:00', venue: 'Main Venue', opponent: null, notes: null,
  published: false, source: 'manual', meet_time: null, kit: null, home_away: null, status: 'scheduled',
  cancel_reason: null, series_id: null, ...over,
})
const TIMED = row({ id: 'timed-1', title: 'Finishing' })
// Dora's series: the time field never completed, so it saved with none.
const UNTIMED = row({ id: 'untimed-1', title: 'Training', start_time: null, starts_at: toInstant(today, '00:00') })
const OFF = row({ id: 'off-1', title: 'Rained off', published: true, status: 'cancelled', start_time: '19:30:00' })

function fixtures() {
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    table('coach_calendar_events', [TIMED, UNTIMED, OFF]),
    table('coach_sessions', []),
    table('squad_players', []),
    rpc('feature_on', () => true),
  )
}

const card = (title: string) => screen.getByText(title, { selector: 'p' }).closest('div.rounded-\\[14px\\]') as HTMLElement

describe('TRAK-159: the coach calendar cards', () => {
  beforeEach(() => signInAs(COACH))

  it('a card says its start time, or "No time set" when it has none', async () => {
    fixtures()
    renderApp('/coach/schedule')
    await screen.findByText('Finishing', { selector: 'p' })
    expect(within(card('Finishing')).getByText(/18:00/)).toBeInTheDocument()
    expect(within(card('Finishing')).queryByText('No time set')).toBeNull()
    expect(within(card('Training')).getByText('No time set')).toBeInTheDocument()
  }, 20_000)

  // TRAK-275 (Tarek, 23 Oct): on a phone the card's actions are icons; the name and tooltip keep the word.
  it('a draft has a Publish button, named and titled "Publish" on a phone', async () => {
    fixtures()
    renderApp('/coach/schedule')
    const publish = await screen.findByRole('button', { name: 'Publish Finishing' })
    expect(publish).toHaveAttribute('title', 'Publish Finishing')
  }, 20_000)

  it('a cancelled event is marked red, label and stripe (founders, 12 Oct)', async () => {
    fixtures()
    renderApp('/coach/schedule')
    await screen.findByText('Rained off', { selector: 'p' })
    const label = within(card('Rained off')).getByText('Cancelled')
    // TRAK-271: the word is the danger red (the event colour is too light for text); the stripe is the event colour.
    // TRAK-427: the state is Arc's badge; a cancelled event's is its danger tone.
    expect(label.closest('[class*="danger"]')).not.toBeNull()
    const stripe = card('Rained off').firstElementChild as HTMLElement
    expect(stripe.style.background).toBe(hexToRgb(CANCELLED_COLOR))
    // TRAK-189: not faded as well. On the light theme a 0.7 fade drops the label to
    // 3.8:1 and the details to 3.1:1 (axe, 19 Oct); red, label and stripe say it already.
    expect(card('Rained off').style.opacity).not.toBe('0.7')
  }, 20_000)
})

describe('TRAK-159: one colour per type', () => {
  // TRAK-275 (Tarek, 23 Oct): training green, match purple, other teal, cancelled red; tournament blue.
  // (Was blue/purple/orange on 12 and 18 Oct, teal/magenta/green on 20 Oct, cyan/pink/green earlier on 23 Oct.)
  it('training green, match purple, other teal, tournament blue, cancelled red (23 Oct)', () => {
    expect(hue(EVENT_COLOR.training)).toBe('green')
    expect(hue(EVENT_COLOR.match)).toBe('purple')
    expect(hue(EVENT_COLOR.other)).toBe('teal')
    expect(hue(EVENT_COLOR.tournament)).toBe('blue')
    expect(hue(CANCELLED_COLOR)).toBe('red')
  })

  it('every type and the cancelled style are told apart', () => {
    const all = [EVENT_COLOR.training, EVENT_COLOR.match, EVENT_COLOR.other, EVENT_COLOR.tournament, CANCELLED_COLOR]
    expect(new Set(all).size).toBe(all.length)
  })
})

function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

/** The colour family a hex reads as, by its hue angle. */
function hue(hex: string): 'red' | 'orange' | 'green' | 'teal' | 'blue' | 'purple' | 'magenta' | 'other' {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d === 0) return 'other'
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  if (h < 15 || h >= 345) return 'red'
  if (h < 40) return 'orange'
  if (h >= 60 && h < 160) return 'green'
  if (h >= 160 && h < 195) return 'teal'
  if (h >= 195 && h < 250) return 'blue'
  if (h >= 250 && h < 300) return 'purple'
  if (h >= 300 && h < 345) return 'magenta'
  return 'other'
}
