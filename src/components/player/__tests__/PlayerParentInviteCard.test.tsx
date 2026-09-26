import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerParentInviteCard } from '../PlayerParentInviteCard'
import { ParentInviteCard } from '../ParentInviteCard'

const calls = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), session: vi.fn(), copy: vi.fn(), userId: 'player-a' }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: calls.userId } }) }))
vi.mock('@/lib/onboarding-session', () => ({ createOnboardingSession: vi.fn() }))
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: (name: string) => ({ abortSignal: () => calls.rpc(name) }),
  functions: { invoke: calls.invoke },
  auth: { getSession: calls.session },
} }))

const invite = (id = 'first', status = 'pending', expired = false) => ({
  id, player_user_id: 'player-a', parent_email: `${id}@example.test`, invite_token: `${id}-old-token`, status,
  expires_at: new Date(Date.now() + (expired ? -86_400_000 : 86_400_000)).toISOString(),
})
const fresh = () => ({ ...invite(), invite_token: 'new-token', expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })
const clients: QueryClient[] = []
function mount(player = 'player-a', profile = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  calls.userId = player
  const tree = (id: string, showProfile = profile) => <QueryClientProvider client={client}>
    {showProfile ? <ParentInviteCard /> : <PlayerParentInviteCard playerUserId={id} />}
  </QueryClientProvider>
  const view = render(tree(player))
  return {
    ...view,
    changePlayer: (id: string) => { calls.userId = id; view.rerender(tree(id)) },
    goToProfile: () => view.rerender(tree(player, true)),
  }
}
const row = (id = 'first') => screen.getByRole('group', { name: `${id}@example.test` })

beforeEach(() => {
  vi.resetAllMocks()
  calls.rpc.mockResolvedValue({ data: [invite()], error: null })
  calls.invoke.mockResolvedValue({ data: { sent: true }, error: null })
  calls.session.mockResolvedValue({ data: { session: { user: { id: 'player-a' }, access_token: 'player-a-token' } }, error: null })
  calls.copy.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: calls.copy } })
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.useRealTimers() })

describe('player parent invitation recovery', () => {
  it('shows all pending invitations, hides expired sharing and offers no resend for accepted invites', async () => {
    calls.rpc.mockResolvedValue({ data: [invite(), invite('expired', 'pending', true), invite('accepted', 'accepted')], error: null })
    mount()
    await screen.findByRole('group', { name: 'first@example.test' })
    expect(within(row()).getByRole('button', { name: 'Share link' })).toBeEnabled()
    expect(within(row('expired')).getByText(/Invitation expired/)).toBeInTheDocument()
    expect(within(row('expired')).queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument()
    expect(within(row('expired')).getByRole('button', { name: 'Resend email' })).toBeEnabled()
    expect(within(row('accepted')).getByText('Parent linked')).toBeInTheDocument()
    expect(within(row('accepted')).queryByRole('button')).not.toBeInTheDocument()
    expect(calls.invoke).not.toHaveBeenCalled()
  })

  it('preserves the valid manual sharing path', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Share link' }))
    await waitFor(() => expect(calls.copy).toHaveBeenCalledWith(`${window.location.origin}/parent-invite?token=first-old-token`))
    expect(await screen.findByText(/Link copied/)).toBeInTheDocument()
  })

  it('reveals a selectable current link when clipboard sharing fails', async () => {
    calls.copy.mockRejectedValue(new Error('Clipboard unavailable'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Share link' }))
    expect(await screen.findByRole('textbox')).toHaveValue(`${window.location.origin}/parent-invite?token=first-old-token`)
  })

  it('resends only the chosen expired invite and reloads its rotated token alongside sibling invitations', async () => {
    calls.rpc.mockResolvedValueOnce({ data: [invite('first', 'pending', true), invite('sibling')], error: null })
      .mockResolvedValue({ data: [fresh(), invite('sibling')], error: null })
    mount()
    await screen.findByRole('group', { name: 'first@example.test' })
    fireEvent.click(within(row()).getByRole('button', { name: 'Resend email' }))
    expect(await screen.findByText(/Email sent/)).toBeInTheDocument()
    expect(calls.invoke).toHaveBeenCalledExactlyOnceWith('send-parent-invite', {
      body: { invite_id: 'first', resend: true }, headers: { Authorization: 'Bearer player-a-token' },
    })
    expect(calls.rpc).toHaveBeenCalledTimes(2)
    fireEvent.click(within(row()).getByRole('button', { name: 'Share link' }))
    await waitFor(() => expect(calls.copy).toHaveBeenCalledWith(`${window.location.origin}/parent-invite?token=new-token`))
    expect(within(row('sibling')).getByRole('button', { name: 'Share link' })).toBeEnabled()
  })

  it.each(['http', 'network'])('reloads the rotated link even when email delivery reports a %s failure', async failure => {
    calls.rpc.mockResolvedValueOnce({ data: [invite()], error: null }).mockResolvedValue({ data: [fresh()], error: null })
    if (failure === 'http') calls.invoke.mockResolvedValue({ data: null, error: new Error('Email rejected') })
    else calls.invoke.mockRejectedValue(new Error('Response lost'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Resend email' }))
    expect(await screen.findByText(/Couldn't confirm email delivery/)).toBeInTheDocument()
    expect(calls.rpc).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }))
    await waitFor(() => expect(calls.copy).toHaveBeenCalledWith(`${window.location.origin}/parent-invite?token=new-token`))
    expect(screen.queryByText(/Email sent/)).not.toBeInTheDocument()
  })

  it('keeps an unchanged token blocked when recovery reads race a delayed server rotation, including on the profile page', async () => {
    let serverInvite = invite()
    calls.rpc.mockImplementation(async () => ({ data: [serverInvite], error: null }))
    // The caller loses the response while the server is still running the RPC.
    calls.invoke.mockRejectedValue(new Error('Client disconnected'))
    const view = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Resend email' }))
    await screen.findByRole('button', { name: 'Retry loading' })
    expect(screen.getByRole('button', { name: 'Share link' })).toBeDisabled()
    expect(calls.copy).not.toHaveBeenCalled()

    // A successful read of the unchanged record must not count as recovery.
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    await waitFor(() => expect(calls.rpc).toHaveBeenCalledTimes(3))
    expect(screen.getByRole('button', { name: 'Share link' })).toBeDisabled()
    view.goToProfile()
    await screen.findByRole('button', { name: 'Retry loading' })
    expect(screen.getByRole('button', { name: 'Share link' })).toBeDisabled()

    // The original server operation finally commits. A later read confirms it.
    serverInvite = fresh()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry loading' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share link' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }))
    await waitFor(() => expect(calls.copy).toHaveBeenCalledWith(`${window.location.origin}/parent-invite?token=new-token`))
    expect(calls.invoke).toHaveBeenCalledTimes(1)
  })

  it.each(['pending', 'disconnected'])('blocks a second resend after navigating away from a %s first attempt', async outcome => {
    let serverInvite = invite()
    let finish!: (value: unknown) => void
    calls.rpc.mockImplementation(async () => ({ data: [serverInvite, invite('sibling')], error: null }))
    calls.invoke.mockImplementation(() => outcome === 'disconnected'
      ? Promise.reject(new Error('Response lost'))
      : new Promise(resolve => { finish = resolve }))
    const view = mount()
    await screen.findByRole('group', { name: 'first@example.test' })
    fireEvent.click(within(row()).getByRole('button', { name: 'Resend email' }))
    await waitFor(() => expect(calls.invoke).toHaveBeenCalledTimes(1))
    view.goToProfile()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry loading' })).toBeEnabled())

    const secondAttempt = within(row()).getByRole('button', { name: 'Resend email' })
    expect(secondAttempt).toBeDisabled()
    fireEvent.click(secondAttempt)
    expect(calls.invoke).toHaveBeenCalledTimes(1)
    expect(within(row()).getByRole('button', { name: 'Share link' })).toBeDisabled()
    expect(within(row('sibling')).getByRole('button', { name: 'Resend email' })).toBeEnabled()
    expect(screen.getByText(/ask your academy to check this invitation/i)).toBeInTheDocument()

    // Re-reading the old record cannot authorize a second write.
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry loading' })).toBeEnabled())
    expect(within(row()).getByRole('button', { name: 'Resend email' })).toBeDisabled()

    serverInvite = fresh()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    await waitFor(() => expect(within(row()).getByRole('button', { name: 'Resend email' })).toBeEnabled())
    if (outcome === 'pending') await act(async () => { finish({ data: { sent: true }, error: null }) })
    fireEvent.click(within(row()).getByRole('button', { name: 'Share link' }))
    await waitFor(() => expect(calls.copy).toHaveBeenCalledWith(`${window.location.origin}/parent-invite?token=new-token`))
    expect(calls.invoke).toHaveBeenCalledTimes(1)
  })

  it('never offers an old revealed token after a failed refresh, and retries loading without resending again', async () => {
    calls.copy.mockRejectedValue(new Error('Clipboard unavailable'))
    calls.rpc.mockResolvedValueOnce({ data: [invite(), invite('sibling')], error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('offline') })
      .mockResolvedValue({ data: [fresh(), invite('sibling')], error: null })
    mount()
    await screen.findByRole('group', { name: 'first@example.test' })
    fireEvent.click(within(row()).getByRole('button', { name: 'Share link' }))
    expect(await screen.findByRole('textbox')).toHaveValue(`${window.location.origin}/parent-invite?token=first-old-token`)
    fireEvent.click(within(row()).getByRole('button', { name: 'Resend email' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load current invitations")
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(row()).getByRole('button', { name: 'Share link' })).toBeDisabled()
    expect(row('sibling')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    await waitFor(() => expect(within(row()).getByRole('button', { name: 'Share link' })).toBeEnabled())
    fireEvent.click(within(row()).getByRole('button', { name: 'Share link' }))
    expect(await screen.findByRole('textbox')).toHaveValue(`${window.location.origin}/parent-invite?token=new-token`)
    expect(calls.invoke).toHaveBeenCalledTimes(1)
  })

  it('removes actions when acceptance races a resend', async () => {
    calls.rpc.mockResolvedValueOnce({ data: [invite()], error: null })
      .mockResolvedValue({ data: [invite('first', 'accepted')], error: null })
    calls.invoke.mockResolvedValue({ data: { sent: false, reason: 'already_accepted' }, error: null })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Resend email' }))
    expect(await screen.findByText('Parent linked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resend email' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument()
  })

  it('does not send under a different account that replaced the initiating player', async () => {
    calls.session.mockResolvedValue({ data: { session: { user: { id: 'player-b' }, access_token: 'player-b-token' } }, error: null })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Resend email' }))
    await waitFor(() => expect(calls.rpc).toHaveBeenCalledTimes(2))
    expect(calls.invoke).not.toHaveBeenCalled()
  })

  it('drops old-account links and ignores delayed resend feedback after an account change', async () => {
    let finish!: (value: unknown) => void
    calls.invoke.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const view = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Resend email' }))
    await waitFor(() => expect(calls.invoke).toHaveBeenCalledTimes(1))
    calls.rpc.mockResolvedValue({ data: [], error: null })
    view.changePlayer('player-b')
    expect(screen.queryByText('first@example.test')).not.toBeInTheDocument()
    await act(async () => { finish({ data: { sent: true }, error: null }) })
    expect(screen.queryByText(/Email sent/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument()
  })

  it('reports a lookup failure and fails closed when expiry or ownership is missing', async () => {
    const { expires_at: _expires, ...missingExpiry } = invite()
    calls.rpc.mockResolvedValue({ data: [missingExpiry], error: null })
    mount()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument()
    calls.rpc.mockResolvedValue({ data: [{ ...invite(), player_user_id: 'another-player' }], error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    await waitFor(() => expect(calls.rpc).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('first@example.test')).not.toBeInTheDocument()
  })

  it('rechecks expiry at the moment of sharing', async () => {
    mount()
    const shareButton = await screen.findByRole('button', { name: 'Share link' })
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 86_400_000)
    fireEvent.click(shareButton)
    expect(await screen.findByText(/Invitation expired/)).toBeInTheDocument()
    expect(calls.copy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('uses the same expiry and resend rules at the existing profile entry point', async () => {
    calls.rpc.mockResolvedValue({ data: [invite('expired', 'pending', true)], error: null })
    mount('player-a', true)
    expect(await screen.findByText(/Invitation expired/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send link' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend email' })).toBeEnabled()
  })

  it.each(['empty', 'pending', 'expired', 'accepted'])('Profile directs guardian changes to the academy with %s invitations', async state => {
    calls.rpc.mockResolvedValue({ data: state === 'empty' ? [] : [invite('first', state === 'accepted' ? 'accepted' : 'pending', state === 'expired')], error: null })
    mount('player-a', true)
    await waitFor(() => expect(screen.queryByText('Loading invitations…')).not.toBeInTheDocument())
    const card = screen.getByRole('region', { name: 'Parent invitations' })
    expect(within(card).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument()
    expect(within(card).getByText('Contact your academy to add a guardian or correct their email.')).toBeInTheDocument()
    if (state !== 'empty') expect(within(card).getByText('first@example.test')).toBeInTheDocument()
    expect(calls.invoke).not.toHaveBeenCalled()
  })

  it('keeps Profile retry actionable without offering guardian creation after a failed lookup', async () => {
    calls.rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') })
      .mockResolvedValue({ data: [], error: null })
    mount('player-a', true)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load current invitations")
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByText('Contact your academy to add a guardian or correct their email.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(calls.rpc).toHaveBeenCalledTimes(2)
    expect(calls.invoke).not.toHaveBeenCalled()
  })

  it('resends the existing Profile invitation without changing its recipient', async () => {
    calls.rpc.mockResolvedValueOnce({ data: [invite('first', 'pending', true)], error: null })
      .mockResolvedValue({ data: [fresh()], error: null })
    mount('player-a', true)
    fireEvent.click(await screen.findByRole('button', { name: 'Resend email' }))
    expect(await screen.findByText(/Email sent/)).toBeInTheDocument()
    expect(calls.invoke).toHaveBeenCalledExactlyOnceWith('send-parent-invite', {
      body: { invite_id: 'first', resend: true }, headers: { Authorization: 'Bearer player-a-token' },
    })
    expect(screen.getByText('first@example.test')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }))
    await waitFor(() => expect(calls.copy).toHaveBeenCalledWith(`${window.location.origin}/parent-invite?token=new-token`))
  })

  it('removes the prior Profile recipient on account change without adding an editor for the new account', async () => {
    const view = mount('player-a', true)
    await screen.findByText('first@example.test')
    calls.rpc.mockResolvedValue({ data: [], error: null })
    view.changePlayer('player-b')
    expect(screen.queryByText('first@example.test')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Loading invitations…')).not.toBeInTheDocument())
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument()
    expect(screen.getByText('Contact your academy to add a guardian or correct their email.')).toBeInTheDocument()
  })

  it('keeps the Home invitation card hidden when the player has no invitations', async () => {
    calls.rpc.mockResolvedValue({ data: [], error: null })
    mount()
    await waitFor(() => expect(screen.queryByText('Loading invitations…')).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Parent invitations' })).not.toBeInTheDocument()
  })
})
