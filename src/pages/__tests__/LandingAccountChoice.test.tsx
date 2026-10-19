import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import LandingPage from '../LandingPage';

const state = vi.hoisted(() => ({ user: null as User | null,
  profile: null as { role: string; full_name: string } | null, loading: false,
  signIn: vi.fn(), signOut: vi.fn(), refreshProfile: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => state }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { resetPasswordForEmail: vi.fn() } } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
function account(id = 'a', role = 'parent') {
  state.user = { id, email: `${id}@family.test` } as User;
  state.profile = { role, full_name: id === 'a' ? 'Alex Parent' : 'Other Account' };
}
function mount() {
  const tree = () => <MemoryRouter><Routes>
    <Route path="/" element={<LandingPage />} />
    {['parent', 'player', 'coach', 'club'].map(role => <Route key={role} path={`/${role}/home`} element={<h1>{role} dashboard</h1>} />)}
    <Route path="/parent-invite" element={<h1>Wrong invitation redirect</h1>} />
  </Routes></MemoryRouter>;
  const view = render(tree()); return { ...view, rerenderAccount: () => view.rerender(tree()) };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fillSignIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@family.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-password' } });
}
beforeEach(() => { vi.clearAllMocks(); state.user = null; state.profile = null; state.loading = false;
  state.signIn.mockResolvedValue({ error: null }); state.signOut.mockResolvedValue({ error: null }); state.refreshProfile.mockResolvedValue(undefined); });
afterEach(cleanup);

describe('returning account choice', () => {
  it.each(['parent', 'player', 'coach', 'club'])('requires a choice before opening a remembered %s account', async role => {
    account('a', role); mount();
    const next = await screen.findByRole('button', { name: 'Continue as Alex Parent' });
    expect(screen.queryByText(`${role} dashboard`)).not.toBeInTheDocument();
    expect(screen.getByText('a@family.test')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    fireEvent.click(next); expect(await screen.findByText(`${role} dashboard`)).toBeInTheDocument();
  });
  it('does not flash a sign-in form while restoring the session', () => {
    state.loading = true; mount(); expect(screen.getByRole('status')).toHaveTextContent('Checking your account');
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });
  it('does not redirect when the token refreshes or a different account appears', async () => {
    account(); const view = mount(); account('b', 'coach'); view.rerenderAccount();
    expect(await screen.findByRole('button', { name: 'Continue as Other Account' })).toBeInTheDocument();
    expect(screen.queryByText('coach dashboard')).not.toBeInTheDocument();
    state.user = { ...state.user! }; view.rerenderAccount();
    expect(screen.getByRole('button', { name: 'Continue as Other Account' })).toBeInTheDocument();
  });
  it.each(['returned', 'thrown'])('keeps the account usable when sign-out fails (%s)', async failure => {
    account(); if (failure === 'returned') state.signOut.mockResolvedValue({ error: new Error('offline') });
    else state.signOut.mockRejectedValue(new Error('offline'));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Sign in with another account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign out');
    expect(screen.getByRole('button', { name: 'Continue as Alex Parent' })).toBeEnabled();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });
  it('waits for a successful sign-out before exposing an empty sign-in form', async () => {
    account(); const pending = deferred<{ error: null }>(); state.signOut.mockReturnValue(pending.promise);
    const view = mount(); fireEvent.click(await screen.findByRole('button', { name: 'Sign in with another account' }));
    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue as Alex Parent' })).toBeDisabled();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    await act(async () => { state.user = null; state.profile = null; pending.resolve({ error: null }); }); view.rerenderAccount();
    expect(await screen.findByLabelText('Email')).toHaveValue(''); expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(state.signOut).toHaveBeenCalledTimes(1);
  });
  it('does not attach a stale account-A logout error to account B', async () => {
    account(); const pending = deferred<{ error: Error }>(); state.signOut.mockReturnValue(pending.promise);
    const view = mount(); fireEvent.click(await screen.findByRole('button', { name: 'Sign in with another account' }));
    account('b', 'coach'); view.rerenderAccount(); await act(async () => pending.resolve({ error: new Error('offline') }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue as Other Account' })).toBeEnabled();
  });
  it.each([null, 'unexpected', '__proto__'])('does not infer a destination from an unavailable role (%s)', async role => {
    account(); state.profile = role ? { role, full_name: 'Alex Parent' } : null; const view = mount();
    expect(await screen.findByText(/Your account access is not available yet/)).toBeInTheDocument();
    expect(screen.queryByText('Wrong invitation redirect')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check access again' })); await waitFor(() => expect(state.refreshProfile).toHaveBeenCalledTimes(1));
    account(); view.rerenderAccount(); expect(screen.getByRole('button', { name: 'Continue as Alex Parent' })).toBeInTheDocument();
    expect(screen.queryByText('parent dashboard')).not.toBeInTheDocument();
  });
  it('continues a deliberate successful sign-in only after the matching profile loads', async () => {
    const pending = deferred<{ error: null }>(); state.signIn.mockReturnValue(pending.promise); const view = mount(); fillSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await act(async () => { account(); state.loading = true; state.profile = null; pending.resolve({ error: null }); }); view.rerenderAccount();
    expect(screen.queryByText('parent dashboard')).not.toBeInTheDocument();
    state.loading = false; account(); view.rerenderAccount(); expect(await screen.findByText('parent dashboard')).toBeInTheDocument();
  });
  it('does not use a successful sign-in response to auto-open a different account', async () => {
    const pending = deferred<{ error: null }>(); state.signIn.mockReturnValue(pending.promise); const view = mount(); fillSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    account('b', 'coach'); view.rerenderAccount(); await act(async () => pending.resolve({ error: null }));
    expect(screen.getByRole('button', { name: 'Continue as Other Account' })).toBeInTheDocument();
    expect(screen.queryByText('coach dashboard')).not.toBeInTheDocument();
  });
  it('recovers from an unexpected sign-in error without leaving the form disabled', async () => {
    state.signIn.mockRejectedValue(new Error('Network unavailable')); mount(); fillSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.getByLabelText('Email')).toHaveValue('a@family.test');
  });
});
