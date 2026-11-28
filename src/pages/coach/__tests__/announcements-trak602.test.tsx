import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'
import { pickDate } from '../../../../tests/support/arc-pickers'
import { localTodayISO } from '@/lib/event-time'

/**
 * TRAK-602 (coach–player P16): from "+", where the academy's announcements switch is on, the coach posts a short
 * announcement to their squad: 500 characters at most, counted as they type and blocked over it, an optional https://
 * link, and Got it by a day where tasks are on too. Each one posted is listed, and Withdraw (asked once more) hides it
 * from players. Test people are named after footballers.
 */

// A new id per test: the app's query cache is keyed by user, so a shared id would carry one test's switch into the next.
let n = 0
let COACH = { id: 'coach-602' }
let switches: string[]
let posted: Record<string, unknown>[]
let withdrawn: Record<string, unknown>[]
let list: Record<string, unknown>[]

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
}

beforeEach(() => {
  COACH = { id: `coach-602-${++n}` }
  signInAs(COACH)
  switches = ['events', 'tasks', 'announcements']
  posted = []
  withdrawn = []
  list = []
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_calendar_events', []), table('coach_sessions', []), table('session_attendance', []), table('event_absences', []),
    table('coach_assessments', []), table('coach_details', []),
    table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Angelos Charisteas', age_group: 'U16', status: 'active', linked_player_id: 'u-1' },
    ]),
    rpc('feature_on', ({ p_feature }) => switches.includes(p_feature as string)),
    rpc('coach_announcements', () => list),
    rpc('post_announcement', args => { posted.push(args); return 'a-1' }),
    rpc('withdraw_announcement', args => { withdrawn.push(args); return null }),
  )
})

async function openPage() {
  renderApp('/coach/announcements')
  return screen.findByRole('textbox', { name: 'Message' })
}

describe('TRAK-602: the coach posts an announcement to their squad', { timeout: 20_000 }, () => {
  it('is not offered in "+" where the announcements switch is off', async () => {
    switches = ['events']
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Quick add' }))
    const menu = await screen.findByRole('menu', { name: 'Quick add' })
    await waitFor(() => expect(within(menu).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Assess player', 'New event']))
  })

  it('opens from "+" when the switch is on', async () => {
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Quick add' }))
    const menu = await screen.findByRole('menu', { name: 'Quick add' })
    await userEvent.click(await within(menu).findByRole('menuitem', { name: 'Post announcement' }))
    expect(await screen.findByRole('heading', { name: 'New announcement' })).toBeInTheDocument()
  })

  it('counts the characters and blocks posting over 500', async () => {
    const message = await openPage()
    await userEvent.click(message)
    await userEvent.paste('x'.repeat(500))
    expect(screen.getByText('500/500')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
    await userEvent.paste('y')
    expect(screen.getByText('501/500 · At most 500 characters.')).toBeInTheDocument()
    const post = screen.getByRole('button', { name: 'Post' })
    expect(post).toBeDisabled()
    await userEvent.click(post)
    expect(posted).toEqual([])
  })

  it('posts to the squad with a link and Got it by the day selected', async () => {
    const message = await openPage()
    await userEvent.type(message, '  Training moves to 18:00 on Friday. ')
    await userEvent.type(screen.getByRole('textbox', { name: 'Link (optional)' }), 'https://example.org/pitch-map')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ask for Got it' }))
    const day = addDays(localTodayISO(), 2)
    await pickDate(userEvent.setup(), 'Answer by', day)
    list = [{ id: 'a-1', squad: 'U16', body: 'Training moves to 18:00 on Friday.', link: 'https://example.org/pitch-map', got_it_by: day,
      published_at: new Date().toISOString(), withdrawn_at: null }]
    await userEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(posted).toEqual([{ p_squad: 'U16', p_body: 'Training moves to 18:00 on Friday.', p_link: 'https://example.org/pitch-map', p_got_it_by: day }]))
    expect(await screen.findByText('Posted to U16')).toBeInTheDocument()
    expect(await screen.findByText('Training moves to 18:00 on Friday.', { selector: 'article p' })).toBeInTheDocument()
    expect(message).toHaveValue('')
  })

  it('stops a link that isn\'t https://, and offers no Got it where tasks are off', async () => {
    switches = ['events', 'announcements']
    const message = await openPage()
    expect(screen.queryByRole('checkbox', { name: 'Ask for Got it' })).toBeNull()
    await userEvent.type(message, 'The pitch map')
    await userEvent.type(screen.getByRole('textbox', { name: 'Link (optional)' }), 'http://example.org/map')
    await userEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A link starts with https://')
    expect(posted).toEqual([])
    await userEvent.clear(screen.getByRole('textbox', { name: 'Link (optional)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(posted).toEqual([{ p_squad: 'U16', p_body: 'The pitch map' }]))
  })

  it('lists what was posted, and Withdraw asks once more before hiding it from players', async () => {
    list = [
      { id: 'a-2', squad: 'U16', body: 'Bring your passport.', link: null, got_it_by: null, published_at: new Date().toISOString(), withdrawn_at: null },
      { id: 'a-1', squad: 'U16', body: 'Kit day is Friday.', link: null, got_it_by: null, published_at: new Date().toISOString(), withdrawn_at: new Date().toISOString() },
    ]
    await openPage()
    const kept = (await screen.findByText('Kit day is Friday.')).closest('article')!
    expect(within(kept).getByText(/Withdrawn/)).toBeInTheDocument()
    expect(within(kept).queryByRole('button')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw: Bring your passport.' }))
    expect(screen.getByText('Players stop seeing it. You keep it here.')).toBeInTheDocument()
    expect(withdrawn).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw: Bring your passport.' }))
    await waitFor(() => expect(withdrawn).toEqual([{ p_id: 'a-2' }]))
  })
})
