import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../../../tests/msw/server'
import { SUPABASE_URL, table } from '../../../tests/msw/supabase'
import Settings from '../Settings'

type Role = 'player' | 'coach' | 'parent' | 'club'
const state = vi.hoisted(() => ({
  role: 'player' as Role,
  success: vi.fn(),
  error: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'settings-user', email: 'settings@example.test' },
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
  server.use(
    table('player_details', [{ position: 'Midfielder', shirt_number: 8 }]),
    table('coach_details', [{ team: 'U15', coach_role: 'Head Coach', organization_id: 'org-test' }]),
    table('organizations', [{ name: 'Test Academy' }]),
    table('squad_players', []),
    table('player_parent_links', []),
  )
})
afterEach(cleanup)

function mount() {
  return render(<MemoryRouter><Settings /></MemoryRouter>)
}

describe('settings controls reflect supported behavior', () => {
  it.each<Role>(['player', 'coach', 'parent', 'club'])('does not revive ineffective controls from old storage for %s', async role => {
    state.role = role
    // An existing browser can still have these old values. They must never
    // appear as promises about delivery or server-enforced access.
    const legacy = JSON.stringify({ notifyMatchUpdates: false, passportVisibility: 'link' })
    localStorage.setItem('trak.settings.v1', legacy)
    mount()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument()
    expect(screen.queryByText('Who can see my passport')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anyone with link' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send reset email' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Change profile photo' })).not.toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeEnabled()

    // TRAK-71: a player has no position or shirt-number editor here.
    if (role === 'player') expect(screen.queryByDisplayValue('8')).toBeNull()
    // TRAK-72 item 11: the academy's name, shown read-only.
    if (role === 'coach') await screen.findByText('Test Academy')
    // TRAK-73: a parent's linked children moved to the Profile tab, like the player's (TRAK-71).
    if (role === 'parent') expect(screen.queryByText('Linked children component')).toBeNull()
    expect(localStorage.getItem('trak.settings.v1')).toBe(legacy)
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
    fireEvent.click(screen.getByRole('button', { name: 'Settings User' }))
    const draft = screen.getByDisplayValue('Settings User')
    fireEvent.change(draft, { target: { value: ' Revised Name ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state.error).toHaveBeenCalledWith('Could not save name'))
    expect(draft).toBeInTheDocument()
    expect(draft).toHaveValue(' Revised Name ')
    expect(state.success).not.toHaveBeenCalled()

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state.success).toHaveBeenCalledWith('Name updated'))
    expect(requests).toEqual([{ full_name: 'Revised Name' }, { full_name: 'Revised Name' }])
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  // TRAK-103: a player's name is the academy's roster name. The database
  // refuses a rename, so Settings shows it without an edit control.
  it('shows a player their name read-only, set by the academy, and sends no rename', async () => {
    const renames: unknown[] = []
    server.use(http.patch(`${SUPABASE_URL}/rest/v1/profiles`, async ({ request }) => { renames.push(await request.json()); return HttpResponse.json({}) }))
    mount()
    expect(await screen.findByText('Settings User')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settings User' })).toBeNull()
    expect(screen.getByText('Your academy sets your name.')).toBeInTheDocument()
    expect(renames).toEqual([])
  })

  it.each<Role>(['parent', 'coach'])('CONTROL a %s can still edit their name', async role => {
    state.role = role
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Settings User' }))
    expect(screen.getByDisplayValue('Settings User')).toBeInTheDocument()
    expect(screen.queryByText('Your academy sets your name.')).toBeNull()
  })
})
