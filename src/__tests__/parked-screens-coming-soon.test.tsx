/**
 * TRAK-85: each parked screen shows as designed with a "Coming soon" pill, and
 * every action on it says "Coming soon" and sends nothing. Real App,
 * AuthProvider and SDK with MSW behind them; every request is recorded, and
 * the test clicks every button that isn't navigation, so an action nobody
 * listed still can't send. The backend stays closed regardless (G7, TRAK-47:
 * pilot_g7.sql, parked_feature_boundary.sql).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../tests/support/render-app'
import { signInAs } from '../../tests/support/session'
import { server } from '../../tests/msw/server'
import { rpc, SUPABASE_URL } from '../../tests/msw/supabase'
import { localTodayISO } from '@/lib/event-time'

const canvas = vi.hoisted(() => vi.fn())
vi.mock('html2canvas', () => ({ default: canvas }))

const COMING_SOON_DETAIL = 'This will be available in a future update.'
// Reads that travel as POST, and the app's own page-view telemetry.
const READ_RPCS = ['my_consent_status', 'get_children_awaiting_consent', 'get_roster_children_awaiting_consent', 'get_player_invites_for_current_user',
  'coach_squad_player_consent_required', 'family_training_history']
// Buttons that only move around the app or the screen, never send anything.
// Unlabelled buttons are the screens' icon-only Back (navigate(-1)); every
// handler that writes, calls AI, shares or copies is guarded and listed in the
// audit on the PR, and each screen's own actions are asserted below.
const NAVIGATION = /^(|DEV|Back|Home|Squad|Sessions|Profile|Matches|Card|Alerts|Overview|Squads|Radar|Coaches|Previous month|Next month|Week|Month|Season|All|U\d+s?|\d{1,2}|HOW TRAK WORKS.*|SETTINGS.*|Close|×)$/i

let sequence = 0
let role = 'coach'
let account: string
let requests: { method: string; path: string }[]
const share = vi.fn()
const clipboard = vi.fn()

// The app's own "today" (local time): a UTC date is a different day for a
// few hours after local midnight east of UTC, and the event falls off the week.
const today = localTodayISO()
function fixtures() {
  const table = (name: string, rows: unknown[]) => http.get(`${SUPABASE_URL}/rest/v1/${name}`, () => HttpResponse.json(rows))
  return [
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, ({ request }) => {
      const me = { id: account, user_id: account, role, full_name: 'Synthetic Actor', invite_code: null }
      const coach = { id: 'coach-1', user_id: 'coach-1', role: 'coach', full_name: 'Synthetic Coach', invite_code: 'TRK-SYN1' }
      // Filter like PostgREST: eq.<id> or in.(<ids>).
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      return HttpResponse.json([me, coach].filter(p => !filter || filter.includes(p.user_id)))
    }),
    table('organizations', [{ id: 'org-1', name: 'Synthetic Academy', join_code: 'SYNC01', admin_user_id: account }]),
    table('coach_details', [{ user_id: 'coach-1', organization_id: 'org-1', current_club: null, team: 'U15s', coach_role: 'Head Coach' }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: account, player_name: 'Synthetic Player', linked_player_id: 'pl-1',
      age_group: 'U15', organization_id: 'org-1', status: 'active' }]),
    table('coach_assessments', [{ id: 'a-1', squad_player_id: 'sp-1', coach_user_id: account, created_at: `${today}T10:00:00Z`,
      work_rate: 7, tactical: 7, attitude: 7, technical: 7, physical: 7, coachability: 7, coach_rating: 7, organization_id: 'org-1' }]),
    table('coach_calendar_events', [{ id: 'ev-1', coach_user_id: account, title: 'Synthetic Fixture', event_type: 'match',
      type: 'match', starts_at: `${today}T15:00:00Z`, published: false }]),
    http.get(`${SUPABASE_URL}/rest/v1/:name`, () => HttpResponse.json([])),
    rpc('my_consent_status', () => ({ required: false, granted: true, invited_parent: null })),
    rpc('get_children_awaiting_consent', () => []),
    // TRAK-11 phase 4: parent Home and consent also list account-less roster children.
    rpc('get_roster_children_awaiting_consent', () => []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('coach_squad_player_consent_required', () => false),
    http.post(`${SUPABASE_URL}/rest/v1/telemetry_events`, () => HttpResponse.json(null, { status: 201 })),
  ]
}

/** Anything that isn't a read: a table write, a write RPC, a function, storage. */
const sent = () => requests.filter(({ method, path }) =>
  path.startsWith('/functions/v1/')
  || (path.startsWith('/storage/v1/') && method !== 'GET')
  || (path.startsWith('/rest/v1/') && method !== 'GET' && method !== 'HEAD'
    && path !== '/rest/v1/telemetry_events'
    && !READ_RPCS.some(name => path === `/rest/v1/rpc/${name}`)))

beforeEach(() => {
  account = `parked-actions-${++sequence}`
  role = 'coach'
  requests = []
  canvas.mockReset()
  share.mockReset()
  clipboard.mockReset()
  signInAs({ id: account })
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url)
    requests.push({ method: request.method, path: url.pathname })
  })
  server.use(...fixtures())
  Object.defineProperty(navigator, 'share', { configurable: true, value: share })
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } })
  // jsdom has no element scrolling; the coach assistant scrolls its thread.
  Element.prototype.scrollTo = () => {}
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  server.events.removeAllListeners()
  vi.restoreAllMocks()
})

const labelOf = (b: HTMLElement) => (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim()

async function clickEveryAction(): Promise<string[]> {
  const clicked: string[] = []
  // Choosing in a dropdown sends nothing; it unlocks the screen's action.
  for (const select of screen.queryAllByRole('combobox')) {
    const options = [...(select as HTMLSelectElement).options].filter(o => o.value)
    if (options.length) await userEvent.selectOptions(select, options[0].value)
  }
  for (let i = 0; i < 40; i++) {
    // Typing sends nothing; a screen may refuse an action while a box is empty.
    for (const box of screen.queryAllByRole('textbox')) {
      if (!(box as HTMLInputElement).value) await userEvent.type(box, 'Synthetic text')
    }
    const next = screen.queryAllByRole('button')
      .find(b => !(b as HTMLButtonElement).disabled && !NAVIGATION.test(labelOf(b)) && !clicked.includes(labelOf(b)))
    if (!next) break
    clicked.push(labelOf(next))
    await userEvent.click(next)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  }
  return clicked
}

const draft = { points: [{ title: 'First touch', what: 'Receive on the back foot', why: 'Time', drill: 'Rondo' }],
  encouragement: 'Keep going' }
const savedDraft = http.get(`${SUPABASE_URL}/rest/v1/player_feedback`, () =>
  HttpResponse.json([{ published_text: JSON.stringify(draft), published_at: `${today}T12:00:00Z` }]))

// [role, path, text that shows the real screen, actions that must be among the
// clicks, extra fixtures]
const screens: [string, string, RegExp, RegExp[], ReturnType<typeof http.get>[]?][] = [
  ['player', '/player/passport', /PLAYER PASSPORT/i, [/^Share$/, /Save Image/]],
  ['player', '/player/evolution', /EVOLUTION CARD/i, [/Share card/]],
  ['coach', '/coach/feedback/a-1', /Review feedback/i, [/Draft feedback/]],
  ['coach', '/coach/feedback/a-1', /Review feedback/i, [/Send update|Send to/, /Draft again/], [savedDraft]],
  ['coach', '/coach/assistant', /TRY ASKING/i, [/./]],
  ['coach', '/coach/schedule', /Calendar/, [/Add/, /Toggle publish/, /Delete/, /Read Schedule/]],
  ['coach', '/coach/recognition', /Give Recognition/, [/Synthetic Player/]],
  ['coach', '/coach/award', /Give Award/, [/Player of the Week/, /Give Award/]],
  ['club', '/club/coaches', /Connected Coaches/, [/Remove|Synthetic Coach|TRK-SYN1/]],
  ['club', '/club/profile', /Synthetic Academy|Administrator/, [/SYNC01|Copy/i]],
]

describe('TRAK-85 parked screens: actions say "Coming soon" and send nothing', () => {
  it.each(screens)('%s at %s', async (actor, path, landmark, expected, extra = []) => {
    role = actor
    server.use(...extra)
    renderApp(path)
    expect((await screen.findAllByText(landmark, {}, { timeout: 4000 })).length).toBeGreaterThan(0)
    expect(screen.getByRole('note', { name: 'This screen is coming soon' })).toHaveTextContent('Coming soon')
    await waitFor(() => expect(requests.some(r => r.method === 'GET')).toBe(true))
    expect(sent()).toEqual([])
    // Wait until each listed action is on screen and enabled (loads finish).
    for (const select of screen.queryAllByRole('combobox')) {
      const options = [...(select as HTMLSelectElement).options].filter(o => o.value)
      if (options.length) await userEvent.selectOptions(select, options[0].value)
    }
    // Wait for the screen's first action to be on screen and enabled (loads
    // finish); later ones may unlock only as earlier ones are chosen.
    await waitFor(() => expect(screen.queryAllByRole('button')
      .some(b => expected[0].test(labelOf(b)) && !(b as HTMLButtonElement).disabled)).toBe(true), { timeout: 4000 })

    const clicked = await clickEveryAction()
    for (const action of expected) expect(clicked.some(label => action.test(label)), `${action} among ${JSON.stringify(clicked)}`).toBe(true)

    expect(sent()).toEqual([])
    expect(share).not.toHaveBeenCalled()
    expect(clipboard).not.toHaveBeenCalled()
    expect(canvas).not.toHaveBeenCalled()
    expect(await screen.findAllByText(COMING_SOON_DETAIL)).not.toHaveLength(0)
  }, 20000)
})
