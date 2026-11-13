import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../../tests/msw/server'
import { SUPABASE_URL, rpc, table } from '../../../tests/msw/supabase'
import Settings from '../Settings'
import { NavBar } from '@/components/trak/NavBar'
import { AccountLanguage } from '@/components/trak/AccountLanguage'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import { currentLanguage, i18n } from '@/lib/i18n'

/* TRAK-406 (Languages 1/8): Settings → Language. Picking Ελληνικά shows Trak in
   Greek at once and saves it on the account; signing in anywhere then opens
   Trak in Greek (AccountLanguage). */

const state = vi.hoisted(() => ({
  role: 'coach' as 'coach' | 'parent' | 'player',
  language: null as string | null,
  success: vi.fn(),
  error: vi.fn(),
  refreshProfile: vi.fn(),
}))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'language-user', email: 'language@example.test' },
    profile: { user_id: 'language-user', role: state.role, full_name: 'Otto Rehhagel', language: state.language },
    signOut: vi.fn(),
    refreshProfile: state.refreshProfile,
  }),
}))
vi.mock('@/lib/settings-account', async () => {
  const { supabase } = await import('@/integrations/supabase/client')
  return {
    getSettingsAccount: async (id: string) => ({ user: { id, email: 'language@example.test' }, client: supabase }),
    assertSettingsAccount: async () => undefined,
  }
})
vi.mock('sonner', () => ({ toast: { success: state.success, error: state.error, info: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'coach'
  state.language = null
  localStorage.clear()
  server.use(
    table('notification_settings', []),
    table('coach_details', [{ team: 'U14', coach_role: 'Head Coach', organization_id: 'org-test' }]),
    table('organizations', [{ name: 'Test Academy' }]),
    table('squad_players', []),
    table('player_parent_links', []),
    rpc('my_calendar_link', () => []),
  )
})
afterEach(cleanup)

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><ParentChildrenProvider><Settings /></ParentChildrenProvider></MemoryRouter></QueryClientProvider>)
}

describe('TRAK-406: Settings → Language', () => {
  it('shows English and Ελληνικά, each in its own language, with English picked', async () => {
    mount()
    const choice = await screen.findByRole('group', { name: 'Language' })
    expect(choice).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Ελληνικά' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switches to Greek at once and saves it on the account', async () => {
    const saved: unknown[] = []
    server.use(http.patch(`${SUPABASE_URL}/rest/v1/profiles`, async ({ request }) => {
      expect(new URL(request.url).searchParams.get('user_id')).toBe('eq.language-user')
      const body = await request.json() as { language: string }
      saved.push(body)
      return HttpResponse.json({ language: body.language })
    }))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Ελληνικά' }))
    await waitFor(() => expect(state.success).toHaveBeenCalledWith('Το Trak είναι πλέον στα Ελληνικά.'))
    expect(saved).toEqual([{ language: 'el' }])
    expect(state.refreshProfile).toHaveBeenCalled()
    expect(currentLanguage()).toBe('el')
    expect(document.documentElement.lang).toBe('el')
    // The page itself is now Greek.
    expect(screen.getByRole('button', { name: 'Ελληνικά' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: 'Γλώσσα' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Αποσύνδεση/ })).toBeInTheDocument()
    expect(screen.getByText('Ηλικιακή κατηγορία')).toBeInTheDocument()
    // And back to English the same way.
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    await waitFor(() => expect(state.success).toHaveBeenLastCalledWith('Trak is in English now.'))
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeInTheDocument()
    expect(saved).toEqual([{ language: 'el' }, { language: 'en' }])
  })

  it('keeps Greek on this device and says so when the account save fails', async () => {
    server.use(http.patch(`${SUPABASE_URL}/rest/v1/profiles`, () => HttpResponse.json({ message: 'Unavailable' }, { status: 503 })))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Ελληνικά' }))
    await waitFor(() => expect(state.error).toHaveBeenCalledWith(
      'Άλλαξε μόνο σε αυτή τη συσκευή. Δεν αποθηκεύτηκε στον λογαριασμό σας· δοκιμάστε ξανά.'))
    expect(state.success).not.toHaveBeenCalled()
    expect(currentLanguage()).toBe('el')
    expect(localStorage.getItem('trak.language')).toBe('el')
  })

  it('offers the switch to parents and players too', async () => {
    for (const role of ['parent', 'player'] as const) {
      state.role = role
      mount()
      expect(await screen.findByRole('group', { name: 'Language' })).toBeInTheDocument()
      cleanup()
    }
  })
})

describe('TRAK-406: the account\'s language follows the person', () => {
  it('opens Trak in the language saved on the account, menus included', async () => {
    state.role = 'parent'
    state.language = 'el'
    render(<MemoryRouter><AccountLanguage /><NavBar role="parent" activeTab="/parent/home" onNavigate={() => {}} /></MemoryRouter>)
    expect(await screen.findByRole('tab', { name: /Αρχική/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Πρόγραμμα/ })).toBeInTheDocument()
    expect(currentLanguage()).toBe('el')
  })

  it('leaves this device\'s language alone for an account that never picked', async () => {
    state.language = null
    await act(async () => { await i18n.changeLanguage('el') })
    render(<MemoryRouter><AccountLanguage /><NavBar role="parent" activeTab="/parent/home" onNavigate={() => {}} /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: /Αρχική/ })).toBeInTheDocument()
    expect(currentLanguage()).toBe('el')
  })

  it('ignores a language this version of Trak does not know', async () => {
    state.language = 'xx'
    render(<MemoryRouter><AccountLanguage /><NavBar role="parent" activeTab="/parent/home" onNavigate={() => {}} /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: /Home/ })).toBeInTheDocument()
    expect(currentLanguage()).toBe('en')
  })
})
