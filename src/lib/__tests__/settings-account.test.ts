import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, User } from '@supabase/supabase-js'

// The race this module exists for is one React state cannot see: the shared
// browser session has already moved to another account while the Settings
// component still believes it is current. `isCurrent()` therefore returns TRUE
// in every test below — only the session comparison can refuse these writes.
const auth = vi.hoisted(() => ({ getSession: vi.fn() }))
const onboarding = vi.hoisted(() => ({ createOnboardingSession: vi.fn() }))
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: auth },
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_FUNCTIONS_URL: 'https://test.supabase.co/functions/v1',
}))
vi.mock('../onboarding-session', () => ({ createOnboardingSession: onboarding.createOnboardingSession }))

const { assertSettingsAccount, getSettingsAccount } = await import('../settings-account')

const user = (id: string) => ({ id, email: `${id}@synthetic.test.invalid` }) as User
const session = (id: string) => ({ user: user(id), access_token: `token-${id}` }) as Session
const stillCurrent = () => true

beforeEach(() => vi.clearAllMocks())

describe('assertSettingsAccount', () => {
  it('accepts the account that started the operation', async () => {
    auth.getSession.mockResolvedValue({ data: { session: session('a') }, error: null })
    await expect(assertSettingsAccount('a', stillCurrent)).resolves.toMatchObject({ user: { id: 'a' } })
  })

  // Kills the mutation `data.session?.user.id !== expectedUserId` -> removed.
  it('refuses when the shared session has moved to another account', async () => {
    auth.getSession.mockResolvedValue({ data: { session: session('b') }, error: null })
    await expect(assertSettingsAccount('a', stillCurrent)).rejects.toThrow(/account changed/i)
  })

  it('refuses when the shared session has gone away entirely', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await expect(assertSettingsAccount('a', stillCurrent)).rejects.toThrow(/account changed/i)
  })

  // Kills the mutation `if (error) throw error` -> removed. Without it a
  // failed getSession() yields `data` undefined and the caller sees a
  // TypeError instead of a retryable message — or, worse, proceeds.
  it('surfaces a getSession failure rather than guessing', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('network down') })
    await expect(assertSettingsAccount('a', stillCurrent)).rejects.toThrow('network down')
  })

  it('refuses when the component already knows it is stale', async () => {
    auth.getSession.mockResolvedValue({ data: { session: session('a') }, error: null })
    await expect(assertSettingsAccount('a', () => false)).rejects.toThrow(/account changed/i)
    expect(auth.getSession).not.toHaveBeenCalled()
  })
})

describe('getSettingsAccount', () => {
  it('returns the bound client for the starting account', async () => {
    auth.getSession.mockResolvedValue({ data: { session: session('a') }, error: null })
    onboarding.createOnboardingSession.mockResolvedValue({ client: 'client-a' })
    await expect(getSettingsAccount('a', stillCurrent)).resolves.toEqual({ client: 'client-a' })
  })

  // Kills the mutation that drops the SECOND assertSettingsAccount call.
  // createOnboardingSession is an await point: the account can change while it
  // is in flight, and the pre-check alone would hand back a usable client.
  it('refuses when the account changes WHILE the bound client is being built', async () => {
    auth.getSession.mockResolvedValueOnce({ data: { session: session('a') }, error: null })
    onboarding.createOnboardingSession.mockImplementation(async () => {
      auth.getSession.mockResolvedValue({ data: { session: session('b') }, error: null })
      return { client: 'client-a' }
    })
    await expect(getSettingsAccount('a', stillCurrent)).rejects.toThrow(/account changed/i)
  })
})
