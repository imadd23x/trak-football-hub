import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import { supabase } from '@/integrations/supabase/client';
import AuthConfirm from '../AuthConfirm';

const base = 'https://test.supabase.co';
const storageKey = 'sb-test-auth-token';
const account = (id: string) => ({ id, email: `${id}@family.test`, aud: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-09-20', email_confirmed_at: '2026-09-20' });
const session = (id: string) => ({ user: account(id), access_token: `synthetic-${id}`, refresh_token: `refresh-${id}`,
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
let verifies: { token_hash: string; type: string }[] = [];
let logouts: { scope: string | null; authorization: string | null }[] = [];
function mount(query = '?token_hash=synthetic-confirmation&type=signup') {
  return render(<StrictMode><MemoryRouter initialEntries={[`/auth/confirm${query}`]}><Routes>
    <Route path="/auth/confirm" element={<AuthConfirm />} />
    <Route path="/" element={<h1>Account choice</h1>} />
  </Routes></MemoryRouter></StrictMode>);
}
function remembered() { const saved = JSON.stringify(session('parent-a')); localStorage.setItem(storageKey, saved); return saved; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(async () => {
  verifies = []; logouts = [];
  await supabase.auth.initialize(); localStorage.removeItem(storageKey);
  server.use(
    http.post(`${base}/auth/v1/verify`, async ({ request }) => {
      verifies.push(await request.json() as { token_hash: string; type: string });
      return HttpResponse.json(session('confirmed-b'));
    }),
    http.post(`${base}/auth/v1/logout`, ({ request }) => {
      logouts.push({ scope: new URL(request.url).searchParams.get('scope'), authorization: request.headers.get('Authorization') });
      return HttpResponse.json({});
    }),
  );
});
afterEach(() => { vi.restoreAllMocks(); cleanup(); localStorage.removeItem(storageKey); });

describe('confirmation through the real Auth SDK', () => {
  it('confirms once in StrictMode without persisting or signing into the app', async () => {
    mount(); expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
    expect(verifies).toHaveLength(1); expect(verifies[0]).toMatchObject({ token_hash: 'synthetic-confirmation', type: 'signup' });
    expect(logouts).toEqual([{ scope: 'local', authorization: 'Bearer synthetic-confirmed-b' }]);
    expect(localStorage.getItem(storageKey)).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Continue to sign in' }));
    expect(await screen.findByRole('heading', { name: 'Account choice' })).toBeInTheDocument();
  });
  it('preserves another family account while confirming the email recipient', async () => {
    const saved = remembered(); mount(); await screen.findByRole('heading', { name: 'Email confirmed' });
    expect(localStorage.getItem(storageKey)).toBe(saved);
    expect(logouts).toEqual([{ scope: 'local', authorization: 'Bearer synthetic-confirmed-b' }]);
  });
  it('retries failed cleanup without re-consuming the one-use confirmation token', async () => {
    const saved = remembered(); let failures = 1;
    server.use(http.post(`${base}/auth/v1/logout`, ({ request }) => {
      logouts.push({ scope: new URL(request.url).searchParams.get('scope'), authorization: request.headers.get('Authorization') });
      return failures-- > 0 ? HttpResponse.json({ message: 'Unavailable' }, { status: 503 }) : HttpResponse.json({});
    }));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Your email is confirmed');
    expect(screen.queryByRole('link', { name: 'Continue to sign in' })).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBe(saved);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Email confirmed' });
    expect(verifies).toHaveLength(1); expect(logouts).toHaveLength(2);
    expect(logouts.every(item => item.scope === 'local' && item.authorization === 'Bearer synthetic-confirmed-b')).toBe(true);
    expect(localStorage.getItem(storageKey)).toBe(saved);
  });
  it.each(['', '?token_hash=', '?token_hash=one&token_hash=two', '?token_hash=one&type=signup&type=email',
    '?token_hash=one&type=recovery', '?token_hash=one&type=invite', '?token_hash=one&type=magiclink', '?token_hash=one&type=unknown'])('rejects malformed or wrong-purpose links before any Auth call: %s', async query => {
    const saved = remembered(); mount(query);
    expect(await screen.findByRole('alert')).toHaveTextContent('confirmation link');
    expect(verifies).toEqual([]); expect(logouts).toEqual([]); expect(localStorage.getItem(storageKey)).toBe(saved);
  });
  it('shows an expired-link outcome and preserves the remembered account', async () => {
    const saved = remembered();
    server.use(http.post(`${base}/auth/v1/verify`, () => HttpResponse.json({ code: 'otp_expired', msg: 'Token has expired or is invalid' }, { status: 403 })));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('expired');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/');
    expect(logouts).toEqual([]); expect(localStorage.getItem(storageKey)).toBe(saved);
  });
  it('does not label an unrelated authorization error as an expired link', async () => {
    server.use(http.post(`${base}/auth/v1/verify`, () => HttpResponse.json({ code: 'access_denied', msg: 'Request denied' }, { status: 403 })));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('could not finish');
    expect(screen.getByRole('alert')).not.toHaveTextContent('expired'); expect(logouts).toEqual([]);
  });
  it('recovers after a verification service failure', async () => {
    let attempts = 0;
    server.use(http.post(`${base}/auth/v1/verify`, () => ++attempts === 1
      ? HttpResponse.json({ message: 'Unavailable' }, { status: 503 }) : HttpResponse.json(session('confirmed-b'))));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('could not finish');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Email confirmed' }); expect(attempts).toBe(2); expect(logouts).toHaveLength(1);
  });
  it('does not claim an email change is complete when the other confirmation is still required', async () => {
    server.use(http.post(`${base}/auth/v1/verify`, () => HttpResponse.json({ msg: 'Confirm the other email address' })));
    const saved = remembered(); mount('?token_hash=synthetic-change&type=email_change');
    expect(await screen.findByRole('heading', { name: 'Check your other inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Email confirmed' })).not.toBeInTheDocument();
    expect(logouts).toEqual([]); expect(localStorage.getItem(storageKey)).toBe(saved);
  });
  it('turns a thrown transport error into an actionable state', async () => {
    const saved = remembered();
    const original = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input).endsWith('/verify')) throw new Error('Synthetic transport failure');
      return original(input, init);
    });
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('could not finish');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(localStorage.getItem(storageKey)).toBe(saved); expect(logouts).toEqual([]);
  });
  it('ends a stalled verification request and lets the user retry', async () => {
    const original = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout, ...args) =>
      original(handler, timeout === 20_000 ? 30 : timeout, ...args));
    let aborted = false;
    server.use(http.post(`${base}/auth/v1/verify`, ({ request }) => new Promise<Response>(resolve => {
      request.signal.addEventListener('abort', () => { aborted = true; resolve(HttpResponse.error()); });
    })));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('could not finish');
    expect(aborted).toBe(true); expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    server.use(http.post(`${base}/auth/v1/verify`, () => HttpResponse.json(session('confirmed-b'))));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Email confirmed' });
  });
  it('does not treat a malformed successful response as confirmation', async () => {
    server.use(http.post(`${base}/auth/v1/verify`, () => HttpResponse.json({})));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('could not finish');
    expect(logouts).toEqual([]);
  });
  it('accepts the documented email confirmation type', async () => {
    mount('?token_hash=synthetic-email&type=email'); await screen.findByRole('heading', { name: 'Email confirmed' });
    expect(verifies[0].type).toBe('email');
  });
  it('finishes isolated cleanup after navigation without touching the newly remembered account', async () => {
    const response = deferred(); let started = false;
    server.use(http.post(`${base}/auth/v1/verify`, async () => { started = true; await response.promise; return HttpResponse.json(session('confirmed-b')); }));
    const view = mount(); await waitFor(() => expect(started).toBe(true)); view.unmount();
    const saved = remembered(); await act(async () => response.resolve());
    await waitFor(() => expect(logouts).toHaveLength(1)); expect(localStorage.getItem(storageKey)).toBe(saved);
    expect(logouts[0]).toEqual({ scope: 'local', authorization: 'Bearer synthetic-confirmed-b' });
  });
});
