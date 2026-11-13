/**
 * TRAK-460: a coach adds, changes and removes their profile picture in Settings › Profile. A file that is not an image,
 * or is over 5 MB, is refused with a plain message before anything is sent. Only a coach gets the controls; a player or
 * guardian still reads "Profile photos are coming soon." Account deletion removes the picture first and stops, with a
 * message, if it cannot.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Settings from '../Settings'

const messages = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: messages.success, error: messages.error, warning: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/telemetry', () => ({ setTelemetryRole: vi.fn(), trackSessionOpen: vi.fn() }))
vi.mock('@/components/layout/RouteGuard', () => ({ RouteGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const COACH = '46000000-0000-4000-8000-000000000001'
const account = vi.hoisted(() => ({
  role: 'coach' as 'coach' | 'player', avatar: null as string | null,
  upload: vi.fn(), remove: vi.fn(), updates: [] as Record<string, unknown>[], rpc: vi.fn(), refreshProfile: vi.fn(),
}))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '46000000-0000-4000-8000-000000000001', email: 'coach@synthetic.test.invalid' },
    profile: { user_id: '46000000-0000-4000-8000-000000000001', role: account.role, full_name: 'Synthetic Coach', avatar_url: account.avatar },
    signOut: vi.fn(), refreshProfile: account.refreshProfile,
  }),
}))
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://signed.test.invalid/p.png' }, error: null }) }) },
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: '46000000-0000-4000-8000-000000000001' } } }, error: null }) } },
  SUPABASE_FUNCTIONS_URL: 'https://test.supabase.co/functions/v1', SUPABASE_PUBLISHABLE_KEY: 'test-anon-key',
}))
vi.mock('@/lib/settings-account', () => {
  const chain = (table: string) => {
    let payload: Record<string, unknown> | null = null
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, abortSignal: () => q,
      update: (value: Record<string, unknown>) => { payload = value; account.updates.push(value); return q },
      maybeSingle: () => Promise.resolve({ data: table === 'profiles' ? { user_id: '46000000-0000-4000-8000-000000000001', ...payload } : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    }
    return q
  }
  const client = { from: chain, rpc: (...args: unknown[]) => account.rpc(...args),
    storage: { from: () => ({ upload: (...args: unknown[]) => account.upload(...args), remove: (...args: unknown[]) => account.remove(...args) }) } }
  return { assertSettingsAccount: () => Promise.resolve(), getSettingsAccount: () => Promise.resolve({ client, user: { id: '46000000-0000-4000-8000-000000000001' } }) }
})

const renderSettings = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <MemoryRouter><Settings /></MemoryRouter></QueryClientProvider>)
const fileInput = () => document.querySelector('input[type=file]') as HTMLInputElement
const pick = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } })
const png = (size = 1024) => Object.defineProperty(new File(['x'], 'me.png', { type: 'image/png' }), 'size', { value: size })

beforeEach(() => {
  vi.clearAllMocks()
  account.role = 'coach'; account.avatar = null; account.updates = []
  account.upload.mockResolvedValue({ data: { path: COACH }, error: null })
  account.remove.mockResolvedValue({ data: [], error: null })
  account.rpc.mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('TRAK-460: a coach\'s profile picture', () => {
  it('uploads an image under the coach\'s own id and points the profile at it', async () => {
    renderSettings()
    expect(await screen.findByRole('button', { name: 'Add photo' })).toBeInTheDocument()
    expect(screen.queryByText('Profile photos are coming soon.')).toBeNull()
    const file = png()
    pick(file)
    await waitFor(() => expect(messages.success).toHaveBeenCalledWith('Photo updated.'))
    expect(account.upload).toHaveBeenCalledWith(COACH, file, expect.objectContaining({ upsert: true, contentType: 'image/png' }))
    expect(account.updates).toEqual([{ avatar_url: COACH }])
    expect(account.refreshProfile).toHaveBeenCalled()
  })

  it('refuses a file that is not an image, and one over 5 MB, before sending anything', async () => {
    renderSettings()
    await screen.findByRole('button', { name: 'Add photo' })
    pick(new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' }))
    expect(messages.error).toHaveBeenLastCalledWith('Choose a JPG, PNG, WebP or GIF picture.')
    pick(png(5 * 1024 * 1024 + 1))
    expect(messages.error).toHaveBeenLastCalledWith('That picture is over 5 MB. Choose a smaller one.')
    expect(account.upload).not.toHaveBeenCalled()
    expect(account.updates).toEqual([])
  })

  it('says so when the upload fails, and does not change the profile', async () => {
    account.upload.mockResolvedValue({ data: null, error: { message: 'denied' } })
    renderSettings()
    await screen.findByRole('button', { name: 'Add photo' })
    pick(png())
    await waitFor(() => expect(messages.error).toHaveBeenCalledWith("Couldn't save your photo. Check your connection and try again."))
    expect(account.updates).toEqual([])
  })

  it('removes the stored picture first, then clears the profile', async () => {
    account.avatar = COACH
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove photo' }))
    await waitFor(() => expect(messages.success).toHaveBeenCalledWith('Photo removed.'))
    expect(account.remove).toHaveBeenCalledWith([COACH])
    expect(account.updates).toEqual([{ avatar_url: null }])
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument()
  })

  it('keeps the profile as it was when the stored picture cannot be removed', async () => {
    account.avatar = COACH
    account.remove.mockResolvedValue({ data: null, error: { message: 'denied' } })
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove photo' }))
    await waitFor(() => expect(messages.error).toHaveBeenCalled())
    expect(account.updates).toEqual([])
  })

  it('removes the picture before deleting the account, and stops if it cannot', async () => {
    account.avatar = COACH
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    account.remove.mockResolvedValue({ data: null, error: { message: 'denied' } })
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete my account' }))
    await waitFor(() => expect(messages.error).toHaveBeenCalledWith(expect.stringContaining('your account was not deleted')))
    expect(account.rpc).not.toHaveBeenCalled()
  })

  it('gives a player no controls: the coming-soon line stays', async () => {
    account.role = 'player'
    renderSettings()
    expect(await screen.findByText('Profile photos are coming soon.')).toBeInTheDocument()
    expect(fileInput()).toBeNull()
  })
})
