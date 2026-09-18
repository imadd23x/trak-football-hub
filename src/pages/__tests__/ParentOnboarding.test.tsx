import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import ParentOnboarding from '../ParentOnboarding';
import { PASSWORD_HINT } from '@/lib/password';

const state = vi.hoisted(() => ({
  user: null as User | null,
  role: 'parent' as string | null,
  rpc: vi.fn(), updateUser: vi.fn(), signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), otp: vi.fn(), refresh: vi.fn(),
  error: vi.fn(), success: vi.fn(), fetch: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: state.error, success: state.success } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({
  user: state.user, profile: state.role ? { role: state.role, full_name: 'Parent' } : null,
  loading: false, signUp: state.signUp, signIn: state.signIn, signOut: state.signOut, refreshProfile: state.refresh,
}) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => client() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: client(), SUPABASE_FUNCTIONS_URL: 'https://test.supabase.co/functions/v1', SUPABASE_ANON_KEY: 'test-key',
}));
function client() {
  return {
    auth: {
      getSession: async () => ({ data: { session: state.user ? { user: state.user, access_token: `token-${state.user.id}` } : null }, error: null }),
      getUser: async () => ({ data: { user: state.user }, error: null }),
      updateUser: state.updateUser,
      signInWithOtp: state.otp,
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: state.role ? { role: state.role, full_name: 'Parent' } : null, error: null,
    }) }) }) }),
    rpc: (name: string, args?: unknown) => {
      const result = Promise.resolve(state.rpc(name, args));
      return Object.assign(result, { maybeSingle: async () => {
        const value = await result; return { ...value, data: Array.isArray(value.data) ? value.data[0] ?? null : value.data };
      } });
    },
  };
}
const recipient = (id = 'parent-a', email = 'parent@example.test'): User => ({
  id, email, email_confirmed_at: '2026-09-18T00:00:00Z', aud: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-09-18T00:00:00Z',
});
const token = '11111111-1111-4111-8111-111111111111';
const invitation = (name = 'Alex') => ({
  invite_id: name === 'Alex' ? '22222222-2222-4222-8222-222222222222' : '33333333-3333-4333-8333-333333333333',
  player_user_id: `player-${name}`, player_name: name, parent_email: 'parent@example.test',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
});
function mount(path = `/parent-invite?token=${token}`) {
  const Location = () => { const location = useLocation(); return <output aria-label="Current path">{location.pathname}{location.search}</output>; };
  const tree = () => <MemoryRouter initialEntries={[path]}><Location /><Routes>
    <Route path="/parent-invite" element={<ParentOnboarding />} />
    <Route path="/parent/consent" element={<h1>Consent next</h1>} />
  </Routes></MemoryRouter>;
  const view = render(tree());
  return { ...view, rerenderAccount: () => view.rerender(tree()) };
}
function fillSetup() {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New Parent' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'StrongNew1!' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'StrongNew1!' } });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.user = recipient(); state.role = 'parent';
  state.rpc.mockImplementation((name: string) => ({ error: null, data:
    name === 'get_parent_invite_by_token' ? [{ id: invitation().invite_id, parent_email: 'parent@example.test', invite_token: token }]
      : name.startsWith('get_my_pending_parent_invite') ? [invitation()] : {},
  }));
  state.updateUser.mockResolvedValue({ error: null }); state.otp.mockResolvedValue({ error: null });
  state.signIn.mockResolvedValue({ error: null }); state.signOut.mockResolvedValue({ error: null });
  state.refresh.mockResolvedValue(undefined);
  state.fetch.mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', state.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('verified parent invitation flow', () => {
  it('never looks up or reveals an invitation before sign-in', async () => {
    state.user = null; state.role = null;
    mount();
    await screen.findByRole('button', { name: /send sign-in link/i });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('parent@example.test')).not.toBeInTheDocument();
  });

  it('lets an existing parent claim a child without changing password or profile', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Link Alex' }));
    expect(await screen.findByText('Consent next')).toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledWith('accept_parent_invite', { p_invite_id: invitation().invite_id });
    expect(state.updateUser).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalledWith('provision_my_profile', expect.anything());
    expect(screen.queryByPlaceholderText(PASSWORD_HINT)).not.toBeInTheDocument();
  });

  it('blocks a player account before any credential or profile mutation', async () => {
    state.role = 'player';
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(/parent account/i);
    expect(screen.queryByPlaceholderText(PASSWORD_HINT)).not.toBeInTheDocument();
    expect(state.updateUser).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each([`/parent-invite?token=${token}`, '/parent-invite'])('keeps %s open while switching to the invited existing parent', async path => {
    state.user = recipient('player-a', 'player@example.test'); state.role = 'player';
    const view = mount(path);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out to use another account' }));
    await waitFor(() => expect(state.signOut).toHaveBeenCalledTimes(1));
    state.user = null; state.role = null;
    view.rerenderAccount();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with password' }));
    fireEvent.change(screen.getByLabelText('Your email address'), { target: { value: 'parent@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'ExistingPassword1!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(state.signIn).toHaveBeenCalledWith('parent@example.test', 'ExistingPassword1!'));
    expect(screen.getByLabelText('Current path')).toHaveTextContent(path);
    state.user = recipient(); state.role = 'parent';
    view.rerenderAccount();
    fireEvent.click(await screen.findByRole('button', { name: 'Link Alex' }));
    expect(await screen.findByText('Consent next')).toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledWith('accept_parent_invite', { p_invite_id: invitation().invite_id });
    expect(state.updateUser).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalledWith('provision_my_profile', expect.anything());
  });

  it('does not leave the invitation or switch accounts when signing out fails', async () => {
    state.role = 'player';
    state.signOut.mockResolvedValue({ error: new Error('Offline') });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out to use another account' }));
    await waitFor(() => expect(state.signOut).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert')).toHaveTextContent('This account is not a parent account');
    expect(screen.queryByLabelText('Your email address')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent(`/parent-invite?token=${token}`);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('offers account switching when a copied token is unavailable but this parent has other invitations', async () => {
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation((name: string, args: unknown) => name === 'get_parent_invite_by_token'
      ? { data: [], error: null } : original(name, args));
    mount();
    expect(await screen.findByRole('button', { name: 'Link Alex' })).toBeInTheDocument();
    expect(screen.getByText(/This link is no longer active/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out to use another account' })).toBeInTheDocument();
  });

  it('shows a password sign-in failure without leaving the invitation or claiming it', async () => {
    state.user = null; state.role = null;
    state.signIn.mockResolvedValue({ error: new Error('Invalid login credentials') });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with password' }));
    fireEvent.change(screen.getByLabelText('Your email address'), { target: { value: 'parent@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'WrongPassword1!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Invalid login credentials')));
    expect(screen.getByLabelText('Current path')).toHaveTextContent(`/parent-invite?token=${token}`);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.otp).not.toHaveBeenCalled();
  });

  it('discovers all of this verified parent’s pending invitations without a token', async () => {
    state.rpc.mockResolvedValue({ data: [invitation('Alex'), invitation('Zara')], error: null });
    mount('/parent-invite');
    expect(await screen.findByRole('button', { name: 'Link Alex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link Zara' })).toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledWith('get_my_pending_parent_invites', undefined);
  });

  it('shows a retryable lookup error instead of claiming no invitation exists', async () => {
    state.rpc.mockResolvedValue({ data: null, error: new Error('offline') });
    mount();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No invitation found')).not.toBeInTheDocument();
  });

  it('requires a verified email before reading an invite or offering setup', async () => {
    state.user = { ...recipient(), email_confirmed_at: undefined };
    mount();
    expect(await screen.findByText(/verify your email/i)).toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(PASSWORD_HINT)).not.toBeInTheDocument();
  });

  it.each([false, true])('creates an OTP account only after an explicit new-account choice (%s)', async createAccount => {
    state.user = null; state.role = null;
    mount();
    fireEvent.change(await screen.findByLabelText('Your email address'), { target: { value: 'my-own-email@example.test' } });
    if (createAccount) fireEvent.click(screen.getByLabelText('Create a new parent account'));
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }));
    expect(await screen.findByText(/Check your inbox/)).toBeInTheDocument();
    expect(state.otp).toHaveBeenCalledWith({ email: 'my-own-email@example.test', options: {
      emailRedirectTo: expect.stringContaining(`/parent-invite?token=${token}`), shouldCreateUser: createAccount,
    } });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('sets up only a verified new parent with a captured token, then refreshes the profile', async () => {
    state.role = null;
    mount();
    await screen.findByRole('button', { name: 'Set up parent account' });
    fillSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Set up parent account' }));
    expect(await screen.findByText('Consent next')).toBeInTheDocument();
    const [url, request] = state.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.supabase.co/auth/v1/user');
    expect(new Headers(request.headers).get('Authorization')).toBe('Bearer token-parent-a');
    expect(JSON.parse(request.body as string)).toEqual({ password: 'StrongNew1!', data: {
      trak_onboarding: { role: 'parent', full_name: 'New Parent', nationality: null },
    } });
    expect(state.rpc).toHaveBeenCalledWith('provision_my_profile', { p: { role: 'parent', full_name: 'New Parent', nationality: null } });
    expect(state.rpc).toHaveBeenCalledWith('accept_parent_invite', { p_invite_id: invitation().invite_id });
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it('does not change credentials when a previous setup attempt already created the parent profile', async () => {
    state.role = null;
    mount();
    await screen.findByRole('button', { name: 'Set up parent account' });
    fillSetup();
    state.role = 'parent';
    fireEvent.click(screen.getByRole('button', { name: 'Set up parent account' }));
    expect(await screen.findByText('Consent next')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalledWith('provision_my_profile', expect.anything());
  });

  it('re-checks the role at submit time before any mutation', async () => {
    mount();
    const button = await screen.findByRole('button', { name: 'Link Alex' });
    state.role = 'coach';
    fireEvent.click(button);
    await waitFor(() => expect(state.error).toHaveBeenCalledWith(expect.stringContaining('parent account')));
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalledWith('accept_parent_invite', expect.anything());
  });

  it('preserves an existing-parent invite for a safe retry after an uncertain claim result', async () => {
    let attempts = 0;
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation((name: string, args: unknown) => name === 'accept_parent_invite'
      ? (++attempts === 1 ? { data: null, error: new Error('Network interrupted') } : { data: 'player-Alex', error: null })
      : original(name, args));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Link Alex' }));
    await waitFor(() => expect(state.error).toHaveBeenCalledWith('Network interrupted'));
    fireEvent.click(screen.getByRole('button', { name: 'Link Alex' }));
    expect(await screen.findByText('Consent next')).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not offer expired invitations or change credentials to recover one', async () => {
    state.role = null;
    state.rpc.mockResolvedValue({ data: [{ ...invitation(), expires_at: '2020-01-01T00:00:00Z' }], error: null });
    mount('/parent-invite');
    expect(await screen.findByText('No active invitations')).toBeInTheDocument();
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up parent account' })).not.toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not provision after a new-parent request finishes under a different signed-in account', async () => {
    state.role = null;
    let resolve!: (value: Response) => void;
    state.fetch.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const view = mount();
    await screen.findByRole('button', { name: 'Set up parent account' });
    fillSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Set up parent account' }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
    state.user = recipient('parent-b', 'other@example.test');
    state.role = 'parent';
    view.rerenderAccount();
    expect(screen.queryByText('New Parent')).not.toBeInTheDocument();
    await act(async () => resolve(new Response('{}', { status: 200 })));
    expect(state.rpc).not.toHaveBeenCalledWith('provision_my_profile', expect.anything());
    expect(state.refresh).not.toHaveBeenCalled();
    expect(screen.queryByText('Consent next')).not.toBeInTheDocument();
  });
});
