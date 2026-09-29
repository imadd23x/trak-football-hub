/**
 * TRAK-88 (G6): "Withdrawal ... takes effect immediately, including for
 * sessions that are already open" (MVP J2). The database hides a withdrawn
 * child's coach records from their linked parents (#174), but a guardian's open
 * app keeps what it already shows. The watcher re-checks which linked children
 * need consent and reloads when one it knew as consented starts to need it.
 */
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentConsentWatcher } from '../ParentConsentWatcher'

const ALEX = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ZARA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
type Awaiting = string[] | Error
const calls = vi.hoisted(() => ({
  fetch: vi.fn(),
  family: { parentId: 'parent-a' } as { parentId: string | null; children: { id: string }[]; loading?: boolean },
}))
vi.mock('@/contexts/ParentChildrenContext', () => ({ useParentChildren: () => calls.family }))
vi.mock('@/lib/parent-consent', () => ({ fetchAwaitingConsent: () => calls.fetch() }))

const answers = (...list: Awaiting[]) => {
  const reply = (answer: Awaiting) => answer instanceof Error ? Promise.reject(answer)
    : Promise.resolve(answer.map(player_user_id => ({ player_user_id, full_name: 'Child', age_years: 12 })))
  for (const answer of list) calls.fetch.mockImplementationOnce(() => reply(answer))
  calls.fetch.mockImplementation(() => reply(list[list.length - 1]))
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

let onWithdrawn: ReturnType<typeof vi.fn>
let client: QueryClient
beforeEach(() => {
  vi.useFakeTimers()
  calls.fetch.mockReset()
  calls.family = { parentId: 'parent-a', children: [{ id: ALEX }] }
  onWithdrawn = vi.fn()
  client = new QueryClient()
})
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers() })

const tree = (callback = onWithdrawn, path = '/parent/home') => <QueryClientProvider client={client}>
  <MemoryRouter initialEntries={[path]}><ParentConsentWatcher onWithdrawn={callback} /></MemoryRouter>
</QueryClientProvider>
const mount = (path?: string) => render(tree(onWithdrawn, path))

describe('ParentConsentWatcher', () => {
  it('reloads within 30 s when a consented child\'s consent is withdrawn', async () => {
    answers([], [ALEX])
    mount()
    await settle()
    expect(onWithdrawn).not.toHaveBeenCalled()
    await wait(30_000)
    expect(onWithdrawn).toHaveBeenCalledTimes(1)
  })

  it('does nothing while consent stands', async () => {
    answers([])
    mount()
    await settle()
    await wait(90_000)
    expect(calls.fetch).toHaveBeenCalledTimes(4)
    expect(onWithdrawn).not.toHaveBeenCalled()
  })

  it('checks at once when the guardian returns to the tab', async () => {
    answers([], [ALEX])
    mount()
    await settle()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(onWithdrawn).toHaveBeenCalledTimes(1)
  })

  it('a failed or malformed read never reloads, and the next good read still does', async () => {
    answers([], new Error('boom'), new Error('Invalid pending approval response'), [ALEX])
    mount()
    await settle()
    await wait(60_000)
    expect(onWithdrawn).not.toHaveBeenCalled()
    await wait(30_000)
    expect(onWithdrawn).toHaveBeenCalledTimes(1)
  })

  it('does not reload for a child who is still waiting for approval', async () => {
    answers([ALEX])
    mount()
    await settle()
    await wait(90_000)
    expect(onWithdrawn).not.toHaveBeenCalled()
  })

  it('does not reload when a newly linked child arrives waiting for approval', async () => {
    answers([], [ZARA])
    const view = mount()
    await settle()
    calls.family = { parentId: 'parent-a', children: [{ id: ALEX }, { id: ZARA }] }
    view.rerender(tree())
    await wait(60_000)
    expect(onWithdrawn).not.toHaveBeenCalled()
  })

  it('reloads once, not on every check after the withdrawal', async () => {
    answers([], [ALEX])
    mount()
    await settle()
    await wait(120_000)
    expect(onWithdrawn).toHaveBeenCalledTimes(1)
  })

  it('waits for the children list before its first check', async () => {
    calls.family = { parentId: 'parent-a', children: [], loading: true }
    answers([], [ALEX])
    const view = mount()
    await settle()
    expect(calls.fetch).not.toHaveBeenCalled()
    calls.family = { parentId: 'parent-a', children: [{ id: ALEX }], loading: false }
    view.rerender(tree())
    await settle()
    await wait(30_000)
    expect(onWithdrawn).toHaveBeenCalledTimes(1)
  })

  // The consent page shows no child records and runs its own reads of the list.
  it('does not check on the consent page', async () => {
    answers([], [ALEX])
    mount('/parent/consent')
    await settle()
    await wait(60_000)
    expect(calls.fetch).not.toHaveBeenCalled()
  })

  it('watches parents only', async () => {
    calls.family = { parentId: null, children: [] }
    answers([], [ALEX])
    mount()
    await settle()
    await wait(60_000)
    expect(calls.fetch).not.toHaveBeenCalled()
  })

  it('a different account starts from its own state', async () => {
    answers([], [ALEX])
    const view = mount()
    await settle()
    calls.family = { parentId: 'parent-b', children: [{ id: ALEX }] }
    view.rerender(tree())
    await settle()
    await wait(60_000)
    expect(onWithdrawn).not.toHaveBeenCalled()
  })

  // The context shows no children while it reloads or after a failed read.
  it('a refreshed or briefly empty children list keeps what it knew', async () => {
    answers([], [], [ALEX])
    const view = mount()
    await settle()
    const refreshed = vi.fn()
    calls.family = { parentId: 'parent-a', children: [] }
    view.rerender(tree(refreshed))
    await settle()
    expect(calls.fetch).toHaveBeenCalledTimes(1)
    await wait(30_000)
    expect(refreshed).not.toHaveBeenCalled()
    await wait(30_000)
    expect(refreshed).toHaveBeenCalledTimes(1)
  })

  it('stops when it unmounts', async () => {
    answers([])
    const view = mount()
    await settle()
    view.unmount()
    const before = calls.fetch.mock.calls.length
    await wait(90_000)
    expect(calls.fetch.mock.calls.length).toBe(before)
  })
})
