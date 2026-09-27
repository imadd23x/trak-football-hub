/**
 * TRAK-13 (G6) / TRAK-6 (J6): "Withdrawal ... takes effect immediately,
 * including for sessions that are already open" (MVP J2). The database refuses
 * a fresh read after withdrawal, but an open player screen only re-reads on the
 * hourly token refresh. The watcher re-checks the player's consent and, when it
 * goes from active to withdrawn, reloads so every screen re-reads.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerConsentWatcher } from '../PlayerConsentWatcher'

type Status = { data: unknown; error: unknown }
const calls = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { user: { id: 'player-a' } as { id: string } | null, profile: { role: 'player' } as { role: string } | null },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => calls.auth }))
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (name: string) => calls.rpc(name) } }))

const consented: Status = { data: { required: false, granted: true }, error: null }
const withdrawn: Status = { data: { required: true, granted: false }, error: null }
const answers = (...list: Status[]) => {
  for (const answer of list) calls.rpc.mockResolvedValueOnce(answer)
  calls.rpc.mockResolvedValue(list[list.length - 1])
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

let onWithdrawn: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  calls.rpc.mockReset()
  calls.auth = { user: { id: 'player-a' }, profile: { role: 'player' } }
  onWithdrawn = vi.fn()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const mount = () => render(<PlayerConsentWatcher onWithdrawn={onWithdrawn} />)

describe('PlayerConsentWatcher', () => {
  it('reloads within 30 s when a consented player\'s consent is withdrawn', async () => {
    answers(consented, withdrawn)
    mount()
    await settle()
    expect(onWithdrawn).not.toHaveBeenCalled()
    await wait(30_000)
    expect(calls.rpc).toHaveBeenCalledWith('my_consent_status')
    expect(onWithdrawn).toHaveBeenCalledTimes(1)
  })

  it('does nothing while consent stands', async () => {
    answers(consented)
    mount()
    await settle()
    await wait(90_000)
    expect(calls.rpc).toHaveBeenCalledTimes(4)
    expect(onWithdrawn).not.toHaveBeenCalled()
  })

  it('checks at once when the player returns to the tab', async () => {
    answers(consented, withdrawn)
    mount()
    await settle()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(onWithdrawn).toHaveBeenCalledTimes(1)
  })

  it('a failed or malformed read never reloads, and the next good read still does', async () => {
    answers(consented, { data: null, error: { message: 'boom' } }, { data: null, error: null }, { data: 'x', error: null }, withdrawn)
    mount()
    await settle()
    await wait(90_000)
    expect(onWithdrawn).not.toHaveBeenCalled()
    await wait(30_000)
    expect(onWithdrawn).toHaveBeenCalledTimes(1)
  })

  it('a thrown read does not stop the watch', async () => {
    calls.rpc.mockResolvedValueOnce(consented).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(withdrawn)
    mount()
    await settle()
    await wait(30_000)
    expect(onWithdrawn).not.toHaveBeenCalled()
    await wait(30_000)
    expect(onWithdrawn).toHaveBeenCalledTimes(1)
  })

  it('does not reload a child who is still waiting for approval', async () => {
    answers(withdrawn)
    mount()
    await settle()
    await wait(90_000)
    expect(onWithdrawn).not.toHaveBeenCalled()
  })

  it('reloads once, not on every check after the withdrawal', async () => {
    answers(consented, withdrawn)
    mount()
    await settle()
    await wait(120_000)
    expect(onWithdrawn).toHaveBeenCalledTimes(1)
  })

  it('watches players only', async () => {
    calls.auth = { user: { id: 'parent-a' }, profile: { role: 'parent' } }
    answers(consented, withdrawn)
    mount()
    await settle()
    await wait(60_000)
    expect(calls.rpc).not.toHaveBeenCalled()
  })

  it('a different account starts from its own state', async () => {
    answers(consented, withdrawn)
    const view = mount()
    await settle()
    calls.auth = { user: { id: 'player-b' }, profile: { role: 'player' } }
    view.rerender(<PlayerConsentWatcher onWithdrawn={onWithdrawn} />)
    await settle()
    await wait(60_000)
    expect(onWithdrawn).not.toHaveBeenCalled()
  })

  it('a token refresh (same account, new render) keeps watching from what it knew', async () => {
    answers(consented, withdrawn)
    const view = mount()
    await settle()
    const refreshed = vi.fn()
    calls.auth = { user: { id: 'player-a' }, profile: { role: 'player' } }
    view.rerender(<PlayerConsentWatcher onWithdrawn={refreshed} />)
    await settle()
    expect(calls.rpc).toHaveBeenCalledTimes(1)
    await wait(30_000)
    expect(refreshed).toHaveBeenCalledTimes(1)
    expect(onWithdrawn).not.toHaveBeenCalled()
  })

  it('stops when it unmounts', async () => {
    answers(consented)
    const view = mount()
    await settle()
    view.unmount()
    const before = calls.rpc.mock.calls.length
    await wait(90_000)
    expect(calls.rpc.mock.calls.length).toBe(before)
  })
})
