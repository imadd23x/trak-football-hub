import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { toInstant } from '@/lib/event-time'
import { SIDE_MENU_QUERY } from '@/lib/side-menu-screen'

/**
 * TRAK-272 (Tarek, 23 Oct, on the live Schedule): the pencil, ban and share icons at the top right of
 * each event "look like drawings, they don't look clickable, they are too small, and they don't point
 * me into what I need to do next". Each card now has Arc's Button group of that event's actions, in
 * words, the next step first, with Cancel or Delete behind its menu. Tapping the card opens the same
 * event sheet coach Home's week opens. And Schedule has a Back on a phone.
 *
 * TRAK-275 (Tarek, 23 Oct, later): the group goes back to the card's top right, keeps the icons, and
 * on a phone shows only them; a laptop adds the words. No group is solid black (a draft or a waiting
 * register read as black), and Cancel or Delete is an icon of the group again, not behind a menu.
 */

const COACH = { id: 'coach-1' }
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
const TODAY = '2026-10-22'

const row = (over: Record<string, unknown>) => ({
  coach_user_id: COACH.id, event_type: 'training', starts_at: toInstant(TODAY, '18:00'), ends_at: null,
  event_date: TODAY, start_time: '18:00:00', venue: 'Main pitch', opponent: null, notes: null,
  published: false, source: 'manual', meet_time: null, kit: null, home_away: null, status: 'scheduled',
  cancel_reason: null, series_id: null, ...over,
})
const DRAFT = row({ id: 'draft-1', title: 'Shooting' })
const LIVE = row({ id: 'live-1', title: 'vs AEK Athens U16', event_type: 'match', opponent: 'AEK Athens U16', published: true,
  starts_at: toInstant(TODAY, '16:00'), start_time: '16:00:00' })
const STARTED = row({ id: 'past-1', title: 'Recovery', published: true, event_date: '2026-10-21',
  starts_at: toInstant('2026-10-21', '10:00'), start_time: '10:00:00' })

function fixtures() {
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(EVENTS, () => HttpResponse.json([DRAFT, LIVE, STARTED])),
    table('coach_sessions', []),
    table('squad_players', []),
    table('event_absences', []),
    rpc('feature_on', () => true),
  )
}

const realMatchMedia = window.matchMedia
const onLaptop = () => {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: query === SIDE_MENU_QUERY })) as typeof window.matchMedia
}
const group = (title: string) => screen.getByRole('group', { name: `Actions for ${title}` })
const names = (el: HTMLElement) => within(el).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent?.trim())

async function open() {
  renderApp('/coach/schedule')
  await screen.findByText('Shooting', { selector: 'p, button' })
}

describe('TRAK-272: each Schedule card has a button group of its actions', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0))
    signInAs(COACH)
    fixtures()
  })
  afterEach(() => { vi.useRealTimers(); window.matchMedia = realMatchMedia })

  it('a draft: Publish, Edit and Delete, as icons only on a phone', async () => {
    await open()
    const g = group('Shooting')
    expect(names(g)).toEqual(['Publish Shooting', 'Edit Shooting', 'Delete Shooting'])
    for (const button of within(g).getAllByRole('button')) {
      expect(button.textContent?.trim()).toBe('')
      expect(button.querySelector('svg')).not.toBeNull()
      expect(button).toHaveAttribute('title', button.getAttribute('aria-label'))
    }
    expect(screen.queryByRole('button', { name: 'More actions for Shooting' })).toBeNull()
  })

  it('a published event to come: Share, Edit and Cancel', async () => {
    await open()
    expect(names(group('vs AEK Athens U16'))).toEqual(['Share vs AEK Athens U16', 'Edit vs AEK Athens U16', 'Cancel vs AEK Athens U16'])
  })

  it('a started training with no register: Take register leads, and it says Needs you', async () => {
    await open()
    await userEvent.click(document.querySelector('[data-present] [data-date="2026-10-21"]') as HTMLElement)
    const g = group('Recovery')
    expect(names(g)[0]).toBe('Take register for Recovery')
    expect(within(g.closest('div.rounded-\\[14px\\]') as HTMLElement).getByText('Needs you')).toBeInTheDocument()
  })

  it('no card\'s group is solid black: not a draft, not a register that waits', async () => {
    await open()
    expect(group('Shooting').className).not.toMatch(/solid/)
    await userEvent.click(document.querySelector('[data-present] [data-date="2026-10-21"]') as HTMLElement)
    expect(group('Recovery').className).not.toMatch(/solid/)
  })

  it('on a laptop the icons carry their words', async () => {
    onLaptop()
    await open()
    expect(within(group('Shooting')).getByRole('button', { name: 'Publish Shooting' })).toHaveTextContent('Publish')
    expect(within(group('Shooting')).getByRole('button', { name: 'Delete Shooting' })).toHaveTextContent('Delete')
  })

  it('tapping the card opens its event sheet, as on coach Home', async () => {
    await open()
    const card = group('Shooting').closest('div.rounded-\\[14px\\]') as HTMLElement
    await userEvent.click(within(card).getByText(/Main pitch/))
    expect(await screen.findByRole('dialog', { name: /Shooting/ })).toBeInTheDocument()
  })

  // TRAK-424: no Back beside the avatar, as on every other main page (this replaced TRAK-272's phone Back).
  it('has no Back beside the avatar on a phone', async () => {
    await open()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })
})
