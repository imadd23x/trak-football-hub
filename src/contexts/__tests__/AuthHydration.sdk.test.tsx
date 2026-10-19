import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { Session, User } from '@supabase/supabase-js';
import { server } from '../../../tests/msw/server';
import { AuthProvider, useAuth } from '../AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { RouteGuard } from '@/components/layout/RouteGuard';
import LandingPage from '@/pages/LandingPage';

const feedback = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: feedback.error, warning: feedback.warning, success: vi.fn() } }));
vi.mock('@/lib/telemetry', () => ({ setTelemetryRole: vi.fn(), trackSessionOpen: vi.fn() }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { supabase: createClient('https://test.supabase.co', 'test-anon-key', { auth: {
    storage: localStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } }),
    SUPABASE_FUNCTIONS_URL: 'https://test.supabase.co/functions/v1', SUPABASE_ANON_KEY: 'test-anon-key' };
});
const url = 'https://test.supabase.co';
const account = (id = 'a'): User => ({ id, email: `${id}@family.test`, aud: 'authenticated', created_at: '2026-09-20', app_metadata: {}, user_metadata: {} });
const session = (id = 'a'): Session => ({ user: account(id), access_token: `token-${id}`, refresh_token: `refresh-${id}`,
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
const profile = (id = 'a') => ({ id: `profile-${id}`, user_id: id, role: 'parent', full_name: id === 'a' ? 'Alex Parent' : 'Other Parent', nationality: null });
const pending = { role: 'parent', full_name: 'Alex Parent', nationality: null };
let queryClient: QueryClient; let expire: (() => void) | undefined;
let calls: { path: string; token: string | null }[];
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { resolve, promise }; }
function Controls() {
  const { user, profile, loading, refreshProfile, signIn } = useAuth();
  return <><output data-testid="identity">{user?.id}:{profile?.user_id}</output><output data-testid="loading">{String(loading)}</output>
    <button onClick={() => { void refreshProfile(); }}>Refresh access</button>
    <button onClick={() => { void signIn('b@family.test', 'SyntheticPass1!'); }}>Switch family</button></>;
}
function mount(path = '/') {
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[path]}><AuthProvider><Controls />
    <Routes><Route path="/" element={<LandingPage />} /><Route path="/protected" element={<RouteGuard allowedRole="parent"><input aria-label="Unsubmitted draft" /></RouteGuard>} /></Routes>
  </AuthProvider></MemoryRouter></QueryClientProvider>);
}
beforeEach(async () => {
  vi.clearAllMocks(); await supabase.auth.initialize(); window.history.replaceState({}, '', '/');
  localStorage.setItem('sb-test-auth-token', JSON.stringify(session()));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }); calls = []; expire = undefined;
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, milliseconds, ...args) => {
    if (milliseconds === 20_000 && typeof handler === 'function') expire = () => handler(...args);
    return timer(handler, milliseconds, ...args);
  });
  server.use(
    http.get(`${url}/auth/v1/user`, ({ request }) => {
      calls.push({ path: 'auth', token: request.headers.get('Authorization') });
      return HttpResponse.json(account(request.headers.get('Authorization') === 'Bearer token-b' ? 'b' : 'a'));
    }),
    http.get(`${url}/rest/v1/profiles`, ({ request }) => {
      calls.push({ path: 'profile', token: request.headers.get('Authorization') });
      return HttpResponse.json(profile(new URL(request.url).searchParams.get('user_id')!.slice(3)));
    }),
    http.post(`${url}/auth/v1/token`, () => HttpResponse.json(session('b'))),
    http.post(`${url}/rest/v1/rpc/provision_my_profile`, ({ request }) => { calls.push({ path: 'provision', token: request.headers.get('Authorization') }); return HttpResponse.json({ warnings: [] }); }),
    http.put(`${url}/auth/v1/user`, ({ request }) => { calls.push({ path: 'cleanup', token: request.headers.get('Authorization') }); return HttpResponse.json(account()); }),
  );
});
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); localStorage.removeItem('sb-test-auth-token'); });
async function timeout() { expect(expire).toBeTypeOf('function'); await act(async () => expire!()); }

describe('profile hydration with the real provider and SDK', () => {
  it.each(['auth', 'profile'])('bounds stalled %s and recovers on the existing account-choice retry', async phase => {
    const held = deferred(); let started = false; let aborted = false; let fail = true;
    const endpoint = phase === 'auth' ? `${url}/auth/v1/user` : `${url}/rest/v1/profiles`;
    server.use(http.get(endpoint, async ({ request }) => {
      if (fail) { started = true; request.signal.addEventListener('abort', () => { aborted = true; held.resolve(); }); await held.promise; }
      return HttpResponse.json(phase === 'auth' ? account() : profile());
    }));
    try {
      mount(); await waitFor(() => expect(started).toBe(true)); await timeout();
      expect(await screen.findByRole('alert')).toHaveTextContent('too long'); expect(aborted).toBe(true);
      expect(screen.getByRole('button', { name: 'Check access again' })).toBeEnabled();
      fail = false; fireEvent.click(screen.getByRole('button', { name: 'Check access again' }));
      expect(await screen.findByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally { held.resolve(); }
  });
  it('provides visible loading and a bounded retry on protected routes', async () => {
    const held = deferred(); let started = false;
    server.use(http.get(`${url}/auth/v1/user`, async () => { started = true; await held.promise; return HttpResponse.json(account()); }));
    try {
      mount('/protected'); expect(await screen.findByRole('status', { name: 'Account access' })).toHaveTextContent('Checking your account');
      await waitFor(() => expect(started).toBe(true)); await timeout();
      expect(await screen.findByRole('alert')).toHaveTextContent('too long'); expect(screen.getByRole('button', { name: 'Retry setup' })).toBeEnabled();
      expect(screen.queryByLabelText('Unsubmitted draft')).not.toBeInTheDocument();
    } finally { held.resolve(); }
  });
  it('keeps an existing profile and draft usable when its refresh times out', async () => {
    mount('/protected'); fireEvent.change(await screen.findByLabelText('Unsubmitted draft'), { target: { value: 'Keep this draft' } });
    const held = deferred(); let started = false; let aborted = false;
    server.use(http.get(`${url}/auth/v1/user`, async ({ request }) => {
      started = true; request.signal.addEventListener('abort', () => { aborted = true; held.resolve(); }); await held.promise; return HttpResponse.json(account());
    }));
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh access' })); await waitFor(() => expect(started).toBe(true)); await timeout();
      expect(screen.getByLabelText('Unsubmitted draft')).toHaveValue('Keep this draft'); expect(aborted).toBe(true);
      expect(screen.getByTestId('identity')).toHaveTextContent('a:a'); expect(screen.getByTestId('loading')).toHaveTextContent('false');
    } finally { held.resolve(); }
  });
  it('aborts A on account switch and never provisions A from its late verified metadata', async () => {
    const held = deferred(); let started = false; let aborted = false;
    server.use(http.get(`${url}/auth/v1/user`, async ({ request }) => {
      if (request.headers.get('Authorization') === 'Bearer token-b') return HttpResponse.json(account('b'));
      started = true; request.signal.addEventListener('abort', () => { aborted = true; held.resolve(); }); await held.promise;
      return HttpResponse.json({ ...account(), user_metadata: { trak_onboarding: pending } });
    }));
    try {
      mount(); await waitFor(() => expect(started).toBe(true)); fireEvent.click(screen.getByRole('button', { name: 'Switch family' }));
      expect(await screen.findByRole('button', { name: 'Continue as Other Parent' })).toBeVisible();
      expect(aborted).toBe(true); expect(calls.some(call => call.path === 'provision')).toBe(false); expect(feedback.error).not.toHaveBeenCalled();
    } finally { held.resolve(); }
  });
  it('aborts pending transport on unmount without global error feedback', async () => {
    const held = deferred(); let started = false; let aborted = false;
    server.use(http.get(`${url}/auth/v1/user`, async ({ request }) => {
      started = true; request.signal.addEventListener('abort', () => { aborted = true; held.resolve(); }); await held.promise; return HttpResponse.json(account());
    }));
    try {
      const view = mount(); await waitFor(() => expect(started).toBe(true)); view.unmount(); await act(async () => held.resolve());
      expect(aborted).toBe(true); expect(feedback.error).not.toHaveBeenCalled();
    } finally { held.resolve(); }
  });
  it('deduplicates concurrent retries and preserves the profile during a stalled idempotent repair', async () => {
    const held = deferred(); let started = false; let aborted = false; let repairs = 0;
    server.use(http.get(`${url}/auth/v1/user`, () => HttpResponse.json({ ...account(), user_metadata: { trak_onboarding: pending } })),
      http.post(`${url}/rest/v1/rpc/provision_my_profile`, async ({ request }) => {
        repairs++; started = true; request.signal.addEventListener('abort', () => { aborted = true; held.resolve(); }); await held.promise; return HttpResponse.json({ warnings: [] });
      }));
    try {
      mount(); expect(await screen.findByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
      await waitFor(() => expect(started).toBe(true)); fireEvent.click(screen.getByRole('button', { name: 'Refresh access' })); fireEvent.click(screen.getByRole('button', { name: 'Refresh access' }));
      await timeout(); expect(aborted).toBe(true); expect(repairs).toBe(1);
      expect(screen.getByRole('button', { name: 'Continue as Alex Parent' })).toBeEnabled();
      expect(calls.some(call => call.path === 'cleanup')).toBe(false);
    } finally { held.resolve(); }
  });
  it('ignores an uncooperative old response after a same-account retry succeeds', async () => {
    const held = deferred(); let authReads = 0; const originalFetch = globalThis.fetch; let first = true;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      // Fault injection: this one request does not honour transport abort.
      // Attempt ownership must still prevent any late follow-up or UI write.
      if (String(input) === `${url}/auth/v1/user` && (!init?.method || init.method === 'GET') && first) {
        first = false; return originalFetch(input, { ...init, signal: undefined });
      }
      return originalFetch(input, init);
    });
    server.use(http.get(`${url}/auth/v1/user`, async () => {
      if (++authReads === 1) { await held.promise; return HttpResponse.json({ ...account(), user_metadata: { trak_onboarding: pending } }); }
      return HttpResponse.json(account());
    }));
    try {
      mount(); await waitFor(() => expect(authReads).toBe(1)); await timeout();
      fireEvent.click(await screen.findByRole('button', { name: 'Check access again' }));
      expect(await screen.findByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
      await act(async () => held.resolve());
      expect(calls.filter(call => call.path === 'profile')).toHaveLength(1);
      expect(calls.some(call => call.path === 'provision' || call.path === 'cleanup')).toBe(false);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally { held.resolve(); }
  });
  it('retries from actual profile state after losing a committed provisioning acknowledgement', async () => {
    const held = deferred(); let rowExists = false; let repairs = 0; let createdRows = 0; let cleanupCount = 0;
    server.use(http.get(`${url}/auth/v1/user`, () => HttpResponse.json({ ...account(), user_metadata: { trak_onboarding: pending } })),
      http.get(`${url}/rest/v1/profiles`, () => HttpResponse.json(rowExists ? profile() : null)),
      http.post(`${url}/rest/v1/rpc/provision_my_profile`, async ({ request }) => {
        expect(request.headers.get('Authorization')).toBe('Bearer token-a'); repairs++;
        // Model the existing server idempotency contract, not a SQL proof.
        if (!rowExists) { rowExists = true; createdRows++; }
        if (repairs === 1) { request.signal.addEventListener('abort', held.resolve); await held.promise; }
        return HttpResponse.json({ warnings: [] });
      }), http.put(`${url}/auth/v1/user`, ({ request }) => {
        expect(request.headers.get('Authorization')).toBe('Bearer token-a'); cleanupCount++; return HttpResponse.json(account());
      }));
    try {
      mount(); await waitFor(() => expect(repairs).toBe(1)); await timeout(); expect(cleanupCount).toBe(0);
      fireEvent.click(await screen.findByRole('button', { name: 'Check access again' }));
      expect(await screen.findByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
      await waitFor(() => expect(cleanupCount).toBe(1)); expect(createdRows).toBe(1); expect(repairs).toBe(2);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally { held.resolve(); }
  });

});
