import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { server } from '../../../tests/msw/server';
import { supabase } from '@/integrations/supabase/client';
import ResetPassword from '../ResetPassword';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const base = 'https://test.supabase.co'; const key = 'sb-test-auth-token';
const account = (name = 'alex') => ({ id: name === 'alex' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222',
  email: `${name}@family.test`, email_confirmed_at: '2026-09-20', aud: 'authenticated', role: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-09-20' });
const session = (name = 'alex'): Session => ({ user: account(name), access_token: `synthetic-${name}`, refresh_token: `refresh-${name}`,
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
let writes: { authorization: string | null; body: unknown }[] = [];
let reads: (string | null)[] = [];
let listeners: ((event: AuthChangeEvent, session: Session | null) => void | Promise<void>)[] = [];
function mount() { return render(<MemoryRouter initialEntries={['/reset-password']}><Routes>
  <Route path="/reset-password" element={<ResetPassword />} /><Route path="/" element={<h1>Account choice</h1>} />
</Routes></MemoryRouter>); }
async function fill(password = 'SyntheticPass1!', confirm = password) {
  fireEvent.change(await screen.findByLabelText('New password', { exact: true }), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password', { exact: true }), { target: { value: confirm } });
}
function submit() { fireEvent.click(screen.getByRole('button', { name: 'Update password' })); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function switchAccount(name = 'other') {
  const next = session(name); localStorage.setItem(key, JSON.stringify(next));
  // Simulate the SDK's cross-tab auth notification; session reads and HTTP
  // requests still use the real client and actual token-bearing transport.
  await act(async () => { for (const callback of listeners) await callback('SIGNED_IN', next); });
}
beforeEach(async () => {
  vi.clearAllMocks(); writes = []; reads = []; listeners = [];
  window.history.replaceState({}, '', '/reset-password'); await supabase.auth.initialize();
  localStorage.setItem(key, JSON.stringify(session()));
  const subscribe = supabase.auth.onAuthStateChange.bind(supabase.auth);
  vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation(callback => { listeners.push(callback); return subscribe(callback); });
  server.use(
    http.get(`${base}/auth/v1/user`, ({ request }) => {
      const header = request.headers.get('Authorization'); reads.push(header);
      return HttpResponse.json(account(header === 'Bearer synthetic-other' ? 'other' : 'alex'));
    }),
    http.put(`${base}/auth/v1/user`, async ({ request }) => {
      const header = request.headers.get('Authorization'); writes.push({ authorization: header, body: await request.json() });
      return HttpResponse.json(account(header === 'Bearer synthetic-other' ? 'other' : 'alex'));
    }),
  );
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.removeItem(key); window.history.replaceState({}, '', '/'); });

describe('password recovery with account-bound Auth requests', () => {
  it('shows the Auth-verified account before accepting a new password', async () => {
    mount(); expect(await screen.findByText('alex@family.test')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(reads).toContain('Bearer synthetic-alex'); expect(writes).toEqual([]);
  });
  it('ends verification when no session is available', async () => {
    localStorage.removeItem(key); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('reset link');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeVisible();
  });
  it.each(['#error=access_denied&error_code=otp_expired', '?error=access_denied&error_description=Expired'])('refuses a failed recovery link even with another account remembered: %s', async suffix => {
    window.history.replaceState({}, '', `/reset-password${suffix}`); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('reset link');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument(); expect(writes).toEqual([]);
  });
  it('rejects a session that Auth no longer accepts', async () => {
    server.use(http.get(`${base}/auth/v1/user`, () => HttpResponse.json({ message: 'JWT expired' }, { status: 401 })));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('reset link');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
  it('recovers after the account check fails', async () => {
    let fail = true;
    server.use(http.get(`${base}/auth/v1/user`, () => fail ? HttpResponse.json({ message: 'Unavailable' }, { status: 503 }) : HttpResponse.json(account())));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('check your account');
    fail = false; fireEvent.click(screen.getByRole('button', { name: 'Check account again' }));
    expect(await screen.findByText('alex@family.test')).toBeInTheDocument();
  });
  it.each([['short', 'short', 'at least'], ['SyntheticPass1!', 'DifferentPass1!', 'do not match']])('validates passwords before sending %s', async (password, confirm, message) => {
    mount(); await fill(password, confirm); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(message); expect(writes).toEqual([]);
  });
  it('reveals each password accessibly without submitting', async () => {
    mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Show new password' }));
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password'); expect(writes).toEqual([]);
  });
  it('updates the verified account and returns to account choice', async () => {
    mount(); await fill(); submit(); await screen.findByRole('heading', { name: 'Account choice' });
    expect(writes).toEqual([{ authorization: 'Bearer synthetic-alex', body: { password: 'SyntheticPass1!' } }]);
    expect(toast.success).toHaveBeenCalledWith('Password updated');
  });
  it('allows a corrected password after a server rejection', async () => {
    server.use(http.put(`${base}/auth/v1/user`, () => HttpResponse.json({ code: 'weak_password', msg: 'Password rejected' }, { status: 422 })));
    mount(); await fill(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent('different password');
    expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled(); expect(toast.success).not.toHaveBeenCalled();
  });
  it('explains reauthentication instead of repeatedly submitting an unusable session', async () => {
    server.use(http.put(`${base}/auth/v1/user`, () => HttpResponse.json({ code: 'reauthentication_needed', msg: 'Reauthentication required' }, { status: 400 })));
    mount(); await fill(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent('new reset link');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
  it('does not claim that a failed response means the password stayed unchanged', async () => {
    server.use(http.put(`${base}/auth/v1/user`, () => HttpResponse.json({ message: 'Unavailable' }, { status: 503 })));
    mount(); await fill(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent('could not confirm whether');
    expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled(); expect(toast.success).not.toHaveBeenCalled();
  });
  it('recovers a thrown save without remaining disabled', async () => {
    const original = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (init?.method === 'PUT') throw new Error('Synthetic disconnected request'); return original(input, init);
    });
    mount(); await fill(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent('could not confirm whether');
    expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled();
  });
  it('clears entered passwords when a different account appears', async () => {
    mount(); await fill(); await switchAccount();
    expect(await screen.findByRole('alert')).toHaveTextContent('account changed'); expect(writes).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Check account again' }));
    expect(await screen.findByText('other@family.test')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue(''); expect(screen.getByLabelText('Confirm password')).toHaveValue('');
  });
  it('does not acquire account B while verifying a pending account A save', async () => {
    let count = 0; const pending = deferred();
    server.use(http.get(`${base}/auth/v1/user`, async ({ request }) => {
      const header = request.headers.get('Authorization'); if (header === 'Bearer synthetic-alex' && ++count > 1) await pending.promise;
      return HttpResponse.json(account(header === 'Bearer synthetic-other' ? 'other' : 'alex'));
    }));
    mount(); await fill(); submit(); await waitFor(() => expect(count).toBe(2)); await switchAccount();
    await act(async () => pending.resolve());
    expect(await screen.findByRole('alert')).toHaveTextContent('account changed'); expect(writes).toEqual([]); expect(toast.success).not.toHaveBeenCalled();
  });
  it('keeps a dispatched request bound to A and ignores its late success after switching to B', async () => {
    const pending = deferred();
    server.use(http.put(`${base}/auth/v1/user`, async ({ request }) => {
      writes.push({ authorization: request.headers.get('Authorization'), body: await request.json() });
      await pending.promise; return HttpResponse.json(account());
    }));
    mount(); await fill(); submit(); await waitFor(() => expect(writes).toHaveLength(1)); await switchAccount();
    await act(async () => pending.resolve()); expect(await screen.findByRole('alert')).toHaveTextContent('account changed');
    expect(writes[0].authorization).toBe('Bearer synthetic-alex'); expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Account choice' })).not.toBeInTheDocument();
  });
  it.each([['same_password', 400, 'already set'], ['over_request_rate_limit', 429, 'Too many attempts']])('handles %s without a false success', async (code, status, message) => {
    server.use(http.put(`${base}/auth/v1/user`, () => HttpResponse.json({ code }, { status: Number(status) })));
    mount(); await fill(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent(String(message));
    expect(toast.success).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled();
  });
  it('rejects a success response naming a different account', async () => {
    server.use(http.put(`${base}/auth/v1/user`, () => HttpResponse.json(account('other'))));
    mount(); await fill(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent('could not confirm whether');
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('prevents duplicate submits while a save is pending', async () => {
    const pending = deferred();
    server.use(http.put(`${base}/auth/v1/user`, async ({ request }) => {
      writes.push({ authorization: request.headers.get('Authorization'), body: await request.json() });
      await pending.promise; return HttpResponse.json(account());
    }));
    mount(); await fill(); const form = screen.getByLabelText('New password').closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(writes).toHaveLength(1)); expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
    await act(async () => pending.resolve()); await screen.findByRole('heading', { name: 'Account choice' });
    expect(writes).toHaveLength(1);
  });
  it('does not redirect or report success after leaving during a save', async () => {
    const pending = deferred();
    server.use(http.put(`${base}/auth/v1/user`, async ({ request }) => {
      writes.push({ authorization: request.headers.get('Authorization'), body: await request.json() });
      await pending.promise; return HttpResponse.json(account());
    }));
    const view = mount(); await fill(); submit(); await waitFor(() => expect(writes).toHaveLength(1));
    view.unmount(); await act(async () => pending.resolve()); expect(toast.success).not.toHaveBeenCalled();
  });
  it.each(['check', 'save'])('ends a stalled %s and restores a usable screen', async phase => {
    let expire: (() => void) | undefined; let requestStarted = false; let aborted = false;
    const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, milliseconds, ...args) => {
      if (milliseconds === 20_000 && typeof handler === 'function') expire = () => handler(...args);
      return timer(handler, milliseconds, ...args);
    });
    const stalled = ({ request }: { request: Request }) => new Promise<Response>(resolve => {
      requestStarted = true;
      request.signal.addEventListener('abort', () => { aborted = true; resolve(HttpResponse.error()); });
    });
    if (phase === 'check') server.use(http.get(`${base}/auth/v1/user`, stalled));
    else server.use(http.put(`${base}/auth/v1/user`, stalled));
    mount(); if (phase === 'save') { await fill(); submit(); }
    await waitFor(() => expect(requestStarted).toBe(true)); await act(async () => expire!());
    expect(await screen.findByRole('alert')).toHaveTextContent(phase === 'check' ? 'check your account' : 'could not confirm whether');
    expect(aborted).toBe(true);
    expect(screen.getByRole('button', { name: phase === 'check' ? 'Check account again' : 'Update password' })).toBeEnabled();
  });

});
