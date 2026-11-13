import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../../tests/msw/server'
import { SUPABASE_URL, rpc, table } from '../../../tests/msw/supabase'
import Settings from '../Settings'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'

type Role = 'player' | 'coach' | 'parent' | 'club'
const state = vi.hoisted(() => ({
  role: 'player' as Role,
  email: 'settings@example.test',
  success: vi.fn(),
  error: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'settings-user', email: state.email },
    profile: { role: state.role, full_name: 'Settings User' },
    signOut: state.signOut,
    refreshProfile: vi.fn(),
  }),
}))
vi.mock('@/lib/settings-account', async () => {
  const { supabase } = await import('@/integrations/supabase/client')
  return {
    getSettingsAccount: async (id: string) => ({ user: { id, email: 'settings@example.test' }, client: supabase }),
    assertSettingsAccount: async () => undefined,
  }
})
vi.mock('@/components/parent/ParentConnections', () => ({
  ParentConnections: () => <p>Linked children component</p>,
}))
vi.mock('sonner', () => ({ toast: { success: state.success, error: state.error } }))

beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'player'
  state.email = 'settings@example.test'
  server.use(
    // TRAK-136: no row means reminders are on.
    table('notification_settings', []),
    table('player_details', [{ position: 'Midfielder', shirt_number: 8 }]),
    table('coach_details', [{ team: 'U15', coach_role: 'Head Coach', organization_id: 'org-test' }]),
    table('organizations', [{ name: 'Test Academy' }]),
    table('squad_players', []),
    table('player_parent_links', []),
    // TRAK-133: Settings → Calendar reads whether a calendar link exists.
    rpc('my_calendar_link', () => []),
  )
})
afterEach(cleanup)

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // TRAK-261: a parent's Family and Consent read the family, as in the app.
  return render(<QueryClientProvider client={client}><MemoryRouter><ParentChildrenProvider><Settings /></ParentChildrenProvider></MemoryRouter></QueryClientProvider>)
}

describe('settings controls reflect supported behavior', () => {
  it.each<Role>(['player', 'coach', 'parent', 'club'])('does not revive ineffective controls from old storage for %s', async role => {
    state.role = role
    // An existing browser can still have these old values. They must never
    // appear as promises about delivery or server-enforced access.
    const legacy = JSON.stringify({ notifyMatchUpdates: false, passportVisibility: 'link' })
    localStorage.setItem('trak.settings.v1', legacy)
    mount()
    // The switches are read from the database, never from old browser values: J8.13's reminder
    // setting for a parent or a player (TRAK-136), a coach's two in-app switches (TRAK-261).
    if (role === 'parent' || role === 'player') {
      expect(await screen.findByRole('switch', { name: 'Event reminders' })).toBeChecked()
      expect(screen.getAllByRole('switch')).toHaveLength(1)
    } else if (role === 'coach') {
      expect(await screen.findByRole('switch', { name: "Can't make it" })).toBeChecked()
      expect(await screen.findByRole('switch', { name: 'Needs you' })).toBeChecked()
      expect(screen.getAllByRole('switch')).toHaveLength(2)
    } else {
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Notifications' })).not.toBeInTheDocument()
    }
    expect(screen.queryByText('Who can see my passport')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anyone with link' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send reset email' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Change profile photo' })).not.toBeInTheDocument()
    // TRAK-460: only a coach has a picture to add (their own); G7 keeps every other role off photos.
    if (role === 'coach') expect(document.querySelector('input[type="file"]')).toBeInTheDocument()
    else expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeEnabled()

    // TRAK-71: a player has no position or shirt-number editor here.
    if (role === 'player') expect(screen.queryByDisplayValue('8')).toBeNull()
    // TRAK-72 item 11: the academy's name, shown read-only.
    if (role === 'coach') await screen.findByText('Test Academy')
    // TRAK-261 (Imad, 22 Oct): a parent's family and consent are in Settings too.
    if (role === 'parent') {
      expect(screen.getByRole('heading', { name: 'Family' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Consent' })).toBeInTheDocument()
    }
    expect(localStorage.getItem('trak.settings.v1')).toBe(legacy)
  })

  it.each<Role>(['player', 'coach', 'parent', 'club'])('offers Settings → Calendar to players and parents only (TRAK-133): %s', async role => {
    state.role = role
    mount()
    if (role === 'player' || role === 'parent') {
      expect(await screen.findByText('Not added yet')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument()
    } else {
      await screen.findByRole('button', { name: 'Sign out' })
      expect(screen.queryByRole('heading', { name: 'Calendar' })).toBeNull()
      expect(screen.queryByText('Not added yet')).toBeNull()
    }
  })

  it('still sends password recovery for the signed-in account', async () => {
    const requests: unknown[] = []
    server.use(http.post(`${SUPABASE_URL}/auth/v1/recover`, async ({ request }) => {
      requests.push(await request.json())
      expect(new URL(request.url).searchParams.get('redirect_to')).toBe(`${window.location.origin}/reset-password`)
      return HttpResponse.json({})
    }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Send reset email' }))
    await waitFor(() => expect(state.success).toHaveBeenCalledWith('Check your email for a reset link'))
    expect(requests).toEqual([expect.objectContaining({ email: 'settings@example.test' })])
  })

  it('explains retained records and makes no deletion request when cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const deletion = vi.fn(() => HttpResponse.json(null))
    server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/delete_my_account`, deletion))
    try {
      mount()
      fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('academy history and consent records may be retained'))
      expect(confirm).not.toHaveBeenCalledWith(expect.stringContaining('deletes all your data'))
      expect(await screen.findByRole('button', { name: 'Delete my account' })).toBeEnabled()
      expect(deletion).not.toHaveBeenCalled()
      expect(state.signOut).not.toHaveBeenCalled()
    } finally {
      confirm.mockRestore()
    }
  })

  // TRAK-155: deleting a guardian account withdraws the approvals they gave, so
  // the parent is told before confirming. Other roles have no approvals.
  it.each<[Role, boolean]>([['parent', true], ['player', false], ['coach', false]])('says deletion withdraws approvals only to a parent (%s)', async (role, warned) => {
    state.role = role
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      mount()
      fireEvent.click(await screen.findByRole('button', { name: 'Delete my account' }))
      const text = String(confirm.mock.calls[0]?.[0] ?? '')
      expect(text.includes('withdraws the approvals you gave')).toBe(warned)
    } finally {
      confirm.mockRestore()
    }
  })

  it('keeps a failed name save editable and persists only the valid retry to this account', async () => {
    state.role = 'parent'
    const requests: unknown[] = []
    let fail = true
    server.use(http.patch(`${SUPABASE_URL}/rest/v1/profiles`, async ({ request }) => {
      expect(new URL(request.url).searchParams.get('user_id')).toBe('eq.settings-user')
      requests.push(await request.json())
      return fail ? HttpResponse.json({ message: 'Temporarily unavailable' }, { status: 503 })
        : HttpResponse.json({ user_id: 'settings-user', full_name: 'Revised Name' })
    }))
    mount()
    // TRAK-261: the name is a field; the save bar appears once it changes.
    const draft = screen.getByRole('textbox', { name: 'Full name' })
    expect(draft).toHaveValue('Settings User')
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    fireEvent.change(draft, { target: { value: ' Revised Name ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.error).toHaveBeenCalledWith('Could not save name'))
    expect(draft).toBeInTheDocument()
    expect(draft).toHaveValue(' Revised Name ')
    expect(state.success).not.toHaveBeenCalled()

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.success).toHaveBeenCalledWith('Name updated'))
    expect(requests).toEqual([{ full_name: 'Revised Name' }, { full_name: 'Revised Name' }])
    expect(screen.getByRole('textbox', { name: 'Full name' })).toHaveValue('Revised Name')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument())
  })

  // TRAK-103: a player's name is the academy's roster name. The database
  // refuses a rename, so Settings shows it without an edit control.
  it('shows a player their name read-only, set by the academy, and sends no rename', async () => {
    const renames: unknown[] = []
    server.use(http.patch(`${SUPABASE_URL}/rest/v1/profiles`, async ({ request }) => { renames.push(await request.json()); return HttpResponse.json({}) }))
    mount()
    expect((await screen.findAllByText('Settings User')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('textbox', { name: 'Full name' })).toBeNull()
    expect(screen.getAllByText('Your academy sets your name.').length).toBeGreaterThan(0)
    expect(renames).toEqual([])
  })

  it.each<Role>(['parent', 'coach'])('CONTROL a %s can still edit their name', async role => {
    state.role = role
    mount()
    expect(await screen.findByRole('textbox', { name: 'Full name' })).toHaveValue('Settings User')
    expect(screen.queryByText('Your academy sets your name.')).toBeNull()
  })
})

// TRAK-261 (Imad, 22 Oct): Arc's settings page, each role exactly its sections; Billing became How Trak works.
describe("Settings on Arc's settings page", () => {
  it.each<[Role, string[]]>([
    // TRAK-406: everyone has Language, after Profile (and a coach's Club).
    ['coach', ['Profile', 'Club', 'Language', 'Notifications', 'How Trak works', 'Account']],
    ['parent', ['Profile', 'Language', 'Family', 'Consent', 'Notifications', 'Calendar', 'How Trak works', 'Account']],
    ['player', ['Profile', 'Language', 'Notifications', 'Calendar', 'How Trak works', 'Account']],
    ['club', ['Profile', 'Language', 'Access', 'How Trak works', 'Account']],
  ])('a %s sees exactly their sections', async (role, sections) => {
    state.role = role
    mount()
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(sections)
    for (const name of sections) expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    // TRAK-418: a coach reads their own page; everyone else the shared one.
    expect(screen.getByRole('link', { name: 'Read how Trak works' })).toHaveAttribute('href', role === 'coach' ? '/coach/how-trak-works' : '/how-it-works')
  })

  it("a coach's switches each save their own column and nothing else", async () => {
    state.role = 'coach'
    const saves: Record<string, unknown>[] = []
    server.use(http.post(`${SUPABASE_URL}/rest/v1/notification_settings`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      saves.push(body)
      return HttpResponse.json(body, { status: 201 })
    }))
    mount()
    fireEvent.click(await screen.findByRole('switch', { name: 'Needs you' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Needs you' })).not.toBeChecked())
    expect(screen.getByRole('switch', { name: "Can't make it" })).toBeChecked()
    expect(saves).toEqual([{ user_id: 'settings-user', needs_you: false }])
    expect(state.success).toHaveBeenCalledWith('Needs you off')
  })
})

// TRAK-136 (J8.13): the reminder 2 days before each event is turned off here,
// never by a link in the email (Microsoft's scanner clicks links, TRAK-107).
describe('Settings → Notifications: event reminders', () => {
  const saves: Record<string, unknown>[] = []
  const saveHandler = (fail = false) => http.post(`${SUPABASE_URL}/rest/v1/notification_settings`, async ({ request }) => {
    saves.push(await request.json() as Record<string, unknown>)
    return fail
      ? HttpResponse.json({ message: 'Synthetic failure' }, { status: 500 })
      : HttpResponse.json({ event_reminders: false }, { status: 201 })
  })
  beforeEach(() => { saves.length = 0; state.role = 'parent' })

  it('is on until the parent turns it off, and saves exactly that for this account', async () => {
    server.use(saveHandler())
    mount()
    const reminders = await screen.findByRole('switch', { name: 'Event reminders' })
    expect(reminders).toBeChecked()
    expect(screen.getByText(/an email 2 days before each event/i)).toBeInTheDocument()
    fireEvent.click(reminders)
    await waitFor(() => expect(reminders).not.toBeChecked())
    expect(saves).toEqual([{ user_id: 'settings-user', event_reminders: false }])
    expect(state.success).toHaveBeenCalledWith('Event reminders off')
  })

  it('shows a saved "off" as off', async () => {
    server.use(table('notification_settings', [{ event_reminders: false }]))
    mount()
    expect(await screen.findByRole('switch', { name: 'Event reminders' })).not.toBeChecked()
  })

  it('a failed save stays as it was and says so', async () => {
    server.use(saveHandler(true))
    mount()
    const reminders = await screen.findByRole('switch', { name: 'Event reminders' })
    fireEvent.click(reminders)
    await waitFor(() => expect(state.error).toHaveBeenCalledWith("Couldn't save your reminder setting. Try again."))
    expect(reminders).toBeChecked()
  })

  it('a failed read offers a retry instead of showing a switch that may be wrong', async () => {
    server.use(http.get(`${SUPABASE_URL}/rest/v1/notification_settings`, () =>
      HttpResponse.json({ message: 'Synthetic failure' }, { status: 500 })))
    mount()
    expect(await screen.findByText("Couldn't load your reminder setting.")).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('a child who signs in with a username gets no reminders, so sees no switch', async () => {
    state.role = 'player'
    state.email = 'striker7@child.trakfootball.com'
    mount()
    await screen.findByRole('button', { name: 'Ask your guardian' })
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})
