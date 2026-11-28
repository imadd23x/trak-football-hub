/**
 * TRAK-603 (coach–player P17): the player's bell shows his squad's announcements (TRAK-602's my_announcements, which
 * leaves out withdrawn ones), newest first: "From Coach", the message, the link as Open link, and Got it when the coach
 * asked for it. Got it in the bell and in My tasks is one answer. Opening the bell answers nothing; once it has been
 * opened and closed, the announcements are read. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows } from '../../../../tests/msw/supabase'

// A new id per test: the app's query cache and the bell's read state are keyed by user.
let n = 0
let PLAYER = { id: 'player-603' }
let answered: boolean
let answers: Record<string, unknown>[]

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()
const KIT = { id: 'an-1', body: 'Kit day is Friday.', link: 'https://example.org/kit', published_at: ago(5), time_zone: 'Asia/Dubai' }
const PASSPORT = { id: 'an-2', body: 'Bring your passport for the tournament.', link: null, published_at: ago(1), time_zone: 'Asia/Dubai' }
const passportTask = () => ({
  task_id: 'task-2', title: PASSPORT.body, source_type: 'announcement', source_id: PASSPORT.id, answer_kind: 'got_it',
  due_at: new Date(Date.now() + 2 * 86_400_000).toISOString(), time_zone: 'Asia/Dubai', answered, outdated: false,
})

function setup(announcements: () => unknown = () => [KIT, PASSPORT]) {
  server.use(
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Theodoros Zagorakis' }]),
    table('player_details', [{ position: 'Midfielder', current_club: 'Rehearsal Athens', age_group: 'U16' }]),
    table('matches', []), table('squad_players', []),
    table('coach_assessments', []), table('coach_shared_feedback', []), table('recognition_awards', []),
    rpcRows('child_events', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    rpc('season_plan_for_player', () => []),
    rpc('my_announcements', announcements),
    rpc('my_tasks', () => [passportTask()]),
    rpc('respond_to_task', args => { answers.push(args); answered = true; return null }),
  )
}

const bell = () => screen.findByRole('button', { name: /^Alerts/ })
async function openBell() {
  await userEvent.click(await bell())
  return screen.findByRole('dialog', { name: 'Alerts' })
}
const myTasks = () => screen.findByRole('region', { name: 'My tasks' })

beforeEach(() => { answered = false; answers = []; PLAYER = { id: `player-603-${++n}` }; signInAs(PLAYER) })
afterEach(cleanup)

describe('TRAK-603: announcements in the player bell', { timeout: 20_000 }, () => {
  it('shows them newest first, from Coach, with the link as Open link', async () => {
    setup()
    renderApp('/player/home')
    const panel = await openBell()
    const items = await within(panel).findAllByRole('button', { name: /^From Coach, unread\. Show details$/ })
    expect(items).toHaveLength(2)
    expect(items.map(item => item.textContent)).toEqual([expect.stringContaining(PASSPORT.body), expect.stringContaining(KIT.body)])
    await userEvent.click(items[1])
    const link = within(panel).getByRole('link', { name: 'Open link' })
    expect(link).toHaveAttribute('href', KIT.link)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('Got it in the bell is the Got it in My tasks', async () => {
    setup()
    renderApp('/player/home')
    expect(within(await myTasks()).getByRole('button', { name: `Got it: ${PASSPORT.body}` })).toBeInTheDocument()
    const panel = await openBell()
    await userEvent.click((await within(panel).findAllByRole('button', { name: /^From Coach/ }))[0])
    await userEvent.click(within(panel).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(answers).toEqual([{ p_task_id: 'task-2' }]))
    expect(await within(await myTasks()).findByRole('button', { name: `Undo Got it: ${PASSPORT.body}` })).toBeInTheDocument()
  })

  it('and the other way round: Got it in My tasks shows as answered in the bell', async () => {
    setup()
    renderApp('/player/home')
    await userEvent.click(within(await myTasks()).getByRole('button', { name: `Got it: ${PASSPORT.body}` }))
    await waitFor(() => expect(answers).toEqual([{ p_task_id: 'task-2' }]))
    await within(await myTasks()).findByRole('button', { name: `Undo Got it: ${PASSPORT.body}` })
    const panel = await openBell()
    await userEvent.click((await within(panel).findAllByRole('button', { name: /^From Coach/ }))[0])
    expect(within(panel).getByText('Got it')).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Got it' })).toBeNull()
  })

  it('counts them unread for screen readers; opening answers nothing, and closing marks them read', async () => {
    setup()
    renderApp('/player/home')
    await waitFor(async () => expect(await bell()).toHaveAccessibleName('Alerts, 2 unread'))
    await openBell()
    await userEvent.keyboard('{Escape}')
    await waitFor(async () => expect(await bell()).toHaveAccessibleName('Alerts'))
    expect(answers).toEqual([])
  })

  it('says so with Retry when they can\'t be read', async () => {
    setup(() => ({ status: 500, body: { message: 'Synthetic failure' } }))
    renderApp('/player/home')
    const panel = await openBell()
    expect(await within(panel).findByRole('button', { name: /Retry|Try again/ })).toBeInTheDocument()
  })
})
