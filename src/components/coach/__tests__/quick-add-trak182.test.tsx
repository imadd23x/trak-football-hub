import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { pickTime } from '../../../../tests/support/arc-pickers'
import { localTodayISO, toInstant } from '@/lib/event-time'

/**
 * TRAK-182 part 8 (Imad's plan 8a–8g): the coach's "+" opens a menu, then the
 * shortest form that makes a real record, then a check, and back to "+".
 * New event saves a draft here; Log match continues on the log's Squad step;
 * today's started training offers its register. Escape steps back one state.
 */

const COACH = { id: 'coach-quick' }
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
let inserted: Record<string, unknown>[]
let rows: Record<string, unknown>[]
let eventReads: number
let eventsOn: boolean

beforeEach(() => {
  signInAs(COACH)
  inserted = []
  rows = []
  eventReads = 0
  eventsOn = true
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(EVENTS, () => { eventReads++; return HttpResponse.json(rows) }),
    http.post(EVENTS, async ({ request }) => {
      inserted.push(...await request.json() as Record<string, unknown>[])
      return HttpResponse.json([{ id: 'new-1' }], { status: 201 })
    }),
    table('coach_sessions', []),
    table('squad_players', []),
    table('session_attendance', []),
    table('event_absences', []),
    // TRAK-288: Games off, so Log match is still the quick match log.
    rpc('feature_on', ({ p_feature }) => p_feature !== 'games' && eventsOn),
  )
})
afterEach(() => { server.events.removeAllListeners() })

async function openMenu() {
  renderApp('/coach/schedule')
  const plus = await screen.findByRole('button', { name: 'Quick add' })
  expect(plus).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(plus)
  return screen.findByRole('menu', { name: 'Quick add' })
}

/** TRAK-259: the "+" is Arc's glass menu; closed is what its trigger says (its panel morphs back into it). */
const closed = () => waitFor(() => expect(screen.getByRole('button', { name: 'Quick add' })).toHaveAttribute('aria-expanded', 'false'))

describe('TRAK-182: the quick-add button', { timeout: 20_000 }, () => {
  // TRAK-265 (Imad, 22 Oct): Arc's Action morph. The "+" grows into the menu, which has its title and a close button.
  it('opens a menu that arrow keys move through, and Escape returns to the "+"', async () => {
    const menu = await openMenu()
    const items = within(menu).getAllByRole('menuitem').map(i => i.textContent)
    expect(items).toEqual(['Log training', 'Log match', 'Assess player', 'New event'])
    expect(screen.getByRole('button', { name: 'Close quick add' })).toBeInTheDocument()
    // Opening focuses the first action; the arrows wrap.
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Log training' })).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Log match' })).toHaveFocus())
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'New event' })).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Quick add' })).toHaveFocus())
    await closed()
  })

  // Imad, 16 Oct (Kostas's item 9): Assess player is a quick action too.
  it('Assess player goes to the assessment', async () => {
    const menu = await openMenu()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Assess player' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/assess'))
  })

  // Imad, 16 Oct: an X to leave a form, and Back to the menu. TRAK-259: the "+" itself closes the menu.
  it('X closes the menu and a form; Back returns from a form to the menu; Escape steps back', async () => {
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Close quick add' }))
    await closed()

    await userEvent.click(screen.getByRole('button', { name: 'Quick add' }))
    const menu = await screen.findByRole('menu', { name: 'Quick add' })
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Log match' }))
    const form = await screen.findByRole('dialog', { name: 'Log a match' })
    await userEvent.click(within(form).getByRole('button', { name: 'Back to quick add' }))
    await userEvent.click(within(await screen.findByRole('menu', { name: 'Quick add' })).getByRole('menuitem', { name: 'New event' }))
    const event = await screen.findByRole('dialog', { name: 'New event' })
    // Escape goes back to the menu, then folds it into the "+".
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('menu', { name: 'Quick add' })).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('menu', { name: 'Quick add' })).getByRole('menuitem', { name: 'New event' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'New event' })).getByRole('button', { name: 'Close quick add' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New event' })).toBeNull())
    expect(event).not.toBeInTheDocument()
    await closed()
  })

  it('New event saves a draft families never see, then says so', async () => {
    const menu = await openMenu()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'New event' }))
    const form = await screen.findByRole('dialog', { name: 'New event' })
    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Pick a start time')
    expect(inserted).toEqual([])
    await pickTime(userEvent, 'Start', '17:30')
    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toMatchObject({ coach_user_id: COACH.id, event_type: 'training', published: false, start_time: '17:30:00', event_date: localTodayISO() })
    expect(await screen.findByText('Draft saved. Publish it from Schedule.')).toBeInTheDocument()
    // The form closes; the "+" is back.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New event' })).toBeNull())
    await closed()
  })

  it('a match draft needs its opponent, and Escape steps back to the menu', async () => {
    const menu = await openMenu()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'New event' }))
    const form = await screen.findByRole('dialog', { name: 'New event' })
    await userEvent.click(within(form).getByRole('button', { name: 'Match' }))
    await pickTime(userEvent, 'Kickoff', '16:00')
    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Add the opponent')
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('menu', { name: 'Quick add' })).toBeInTheDocument()
    expect(inserted).toEqual([])
  })

  it('More details opens Schedule\'s full form with what was typed', async () => {
    const menu = await openMenu()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'New event' }))
    const form = await screen.findByRole('dialog', { name: 'New event' })
    await userEvent.click(within(form).getByRole('button', { name: 'Match' }))
    await userEvent.type(within(form).getByLabelText('Opponent'), 'Synthetic Rovers')
    await userEvent.click(within(form).getByRole('button', { name: 'More details' }))
    // Tarek's #319 probe: already on Schedule, the hand-over must still open
    // Schedule's stepped form, and the quick-add must close (both are "New event").
    await waitFor(() => expect(document.querySelector('[aria-label="Event steps"]')).not.toBeNull())
    await waitFor(() => expect(screen.getAllByRole('dialog', { name: 'New event' })).toHaveLength(1))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    expect(within(sheet).getByLabelText('Opponent')).toHaveValue('Synthetic Rovers')
    expect(screen.getByRole('button', { name: 'Quick add' })).toBeInTheDocument()
    expect(inserted).toEqual([])
  })

  it('Log match takes the opponent and score, then continues on the log\'s Squad step', async () => {
    const menu = await openMenu()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Log match' }))
    const form = await screen.findByRole('dialog', { name: 'Log a match' })
    await userEvent.click(within(form).getByRole('button', { name: 'Continue' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Add the opponent and the score.')
    await userEvent.type(within(form).getByLabelText('Opponent'), 'Synthetic United')
    await userEvent.type(within(form).getByLabelText('Our score'), '2')
    await userEvent.type(within(form).getByLabelText('Their score'), '1')
    await userEvent.click(within(form).getByRole('button', { name: 'Continue' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Say whether it was home or away.')
    await userEvent.click(within(form).getByRole('button', { name: 'Away' }))
    expect(within(form).getByRole('button', { name: 'Away' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(form).getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Squad'))
    await userEvent.click(screen.getByRole('button', { name: 'Back to Match' }))
    expect(screen.getByPlaceholderText('Opponent name')).toHaveValue('Synthetic United')
    const [us, them] = screen.getAllByPlaceholderText('0')
    expect(us).toHaveValue('2')
    expect(them).toHaveValue('1')
    // Read once, then cleared: a reload or Back can't reopen it prefilled.
    expect(window.history.state?.usr ?? null).toBeNull()
  })

  // Tarek's #319 review: Home/Away starts unanswered, as on Schedule.
  it('a match draft nobody marked home or away is not saved as Home', async () => {
    const menu = await openMenu()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'New event' }))
    const form = await screen.findByRole('dialog', { name: 'New event' })
    await userEvent.click(within(form).getByRole('button', { name: 'Match' }))
    expect(within(form).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(form).getByRole('button', { name: 'Away' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.type(within(form).getByLabelText('Opponent'), 'Synthetic Rovers')
    await pickTime(userEvent, 'Kickoff', '16:00')
    const before = eventReads
    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0].home_away ?? null).toBeNull()
    // Schedule reloads its events, so the draft is there to publish.
    await waitFor(() => expect(eventReads).toBeGreaterThan(before))
  })

  it('with events switched off, New event says Coming soon and saves nothing', async () => {
    eventsOn = false
    // Its own coach: the app's query cache is shared, and the switch is cached per account.
    signInAs({ id: 'coach-quick-events-off' })
    const menu = await openMenu()
    // The menu is drawn once the events switch has answered (no Take register asked for).
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'New event' }))
    // "Coming soon" is a toast (useParked); the form never opens and nothing is written.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(screen.queryByRole('dialog', { name: 'New event' })).toBeNull()
    expect(screen.getByRole('menu', { name: 'Quick add' })).toBeInTheDocument()
    expect(inserted).toEqual([])
  })

  it("offers today's started training's register, which opens on Schedule", async () => {
    const today = localTodayISO()
    rows = [{
      id: 'today-1', coach_user_id: COACH.id, title: 'Finishing', event_type: 'training', published: true, status: 'scheduled',
      event_date: today, start_time: '00:00:00', starts_at: toInstant(today, '00:00'), ends_at: null, venue: null, opponent: null,
      notes: null, source: 'manual', meet_time: null, kit: null, home_away: null, cancel_reason: null,
    }]
    const menu = await openMenu()
    const register = await within(menu).findByRole('menuitem', { name: 'Take register · Finishing' })
    await userEvent.click(register)
    expect(await screen.findByRole('dialog', { name: 'Take register' }, { timeout: 3000 })).toBeInTheDocument()
    // Nothing of the quick-add stays open under the register.
    await closed()
  })
})
