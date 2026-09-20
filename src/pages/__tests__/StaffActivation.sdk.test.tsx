import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { Session, User } from '@supabase/supabase-js';
import { server } from '../../../tests/msw/server';
import { supabase } from '@/integrations/supabase/client';
import StaffActivation from '../StaffActivation';

const state = vi.hoisted(() => ({ user: null as User | null, profile: null as { role: string; full_name: string } | null,
  refresh: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), requests: [] as string[] }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user, profile: state.profile, loading: false,
  refreshProfile: state.refresh, signIn: state.signIn, signOut: state.signOut }) }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { supabase: createClient('https://staff.test.supabase.co', 'test-anon', {
    auth: { storage: localStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  }), SUPABASE_FUNCTIONS_URL: 'https://staff.test.supabase.co/functions/v1', SUPABASE_ANON_KEY: 'test-anon' };
});
const base = 'https://staff.test.supabase.co';
const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaabbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = (id = 'a'): User => ({ id, email: `${id}@staff.test`, email_confirmed_at: '2026-01-01',
  aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' });
const session = (id = 'a'): Session => ({ user: user(id), access_token: `token-${id}`, refresh_token: `refresh-${id}`,
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function mount(flow = 'new') {
  const tree = () => <MemoryRouter initialEntries={[`/staff-invite?token=${token}&flow=${flow}`]}><Routes>
    <Route path="/staff-invite" element={<StaffActivation />} /><Route path="/coach/home" element={<h1>Coach home</h1>} />
  </Routes></MemoryRouter>;
  const view = render(tree()); return { ...view, rerenderAccount: () => view.rerender(tree()) };
}
async function fill() {
  fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'New Coach' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'StrongPass1!' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'StrongPass1!' } });
}
beforeEach(async () => {
  vi.clearAllMocks(); state.requests = []; state.user = user(); state.profile = null;
  state.refresh.mockResolvedValue(undefined); state.signOut.mockResolvedValue({ error: null });
  await supabase.auth.initialize(); localStorage.setItem('sb-staff-auth-token', JSON.stringify(session()));
  server.use(
    http.get(`${base}/auth/v1/user`, ({ request }) => {
      state.requests.push(`getUser:${request.headers.get('Authorization')}`);
      return HttpResponse.json(user(request.headers.get('Authorization') === 'Bearer token-b' ? 'b' : 'a'));
    }),
    http.get(`${base}/rest/v1/profiles`, () => HttpResponse.json(state.profile)),
    http.post(`${base}/rest/v1/rpc/inspect_staff_invite`, ({ request }) => {
      state.requests.push(`inspect:${request.headers.get('Authorization')}`);
      return request.headers.get('Authorization') === 'Bearer token-b' ? HttpResponse.json({ code: '42501', message: 'Unavailable' }, { status: 403 })
        : HttpResponse.json({ role: 'coach', academy_name: 'Synthetic Academy', state: 'pending', expires_at: '2027-01-01T00:00:00Z' });
    }),
    http.put(`${base}/auth/v1/user`, async ({ request }) => {
      state.requests.push(`password:${request.headers.get('Authorization')}`); expect(await request.json()).toEqual({ password: 'StrongPass1!' });
      return HttpResponse.json(user());
    }),
    http.post(`${base}/rest/v1/rpc/accept_staff_invite`, async ({ request }) => {
      state.requests.push(`accept:${request.headers.get('Authorization')}`);
      expect(await request.json()).toEqual({ p_token: token, p_full_name: state.profile?.full_name ?? 'New Coach' });
      return HttpResponse.json({ role: 'coach', organization_id: org, replayed: false });
    }),
  );
});
afterEach(() => { cleanup(); localStorage.removeItem('sb-staff-auth-token'); });

describe('staff activation using real Supabase transport', () => {
  it('does not reveal or query invitation details before sign-in', async () => {
    state.user = null; localStorage.removeItem('sb-staff-auth-token'); mount();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Synthetic Academy')).not.toBeInTheDocument(); expect(state.requests).toEqual([]);
  });
  it('requests an existing-account email sign-in link and preserves the activation route', async () => {
    state.user = null; localStorage.removeItem('sb-staff-auth-token');
    let otpRequests = 0;
    server.use(http.post(`${base}/auth/v1/otp`, async ({ request }) => {
      otpRequests++;
      expect(await request.json()).toMatchObject({ email: 'a@staff.test', create_user: false });
      const redirect = new URL(new URL(request.url).searchParams.get('redirect_to')!);
      expect(redirect.origin).toBe(window.location.origin);
      expect(redirect.pathname).toBe('/staff-invite');
      expect(redirect.searchParams.get('token')).toBe(token);
      expect(redirect.searchParams.get('flow')).toBe('existing');
      return HttpResponse.json({});
    }));
    mount('existing');
    fireEvent.click(await screen.findByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByText('Enter your email address first.')).toBeInTheDocument();
    expect(otpRequests).toBe(0);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@staff.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('If this account can sign in by email');
    expect(otpRequests).toBe(1); expect(state.requests).toEqual([]);
  });
  it('keeps the sign-in form usable after an email-provider error', async () => {
    state.user = null; localStorage.removeItem('sb-staff-auth-token');
    server.use(http.post(`${base}/auth/v1/otp`, () => HttpResponse.json({ msg: 'Email rate limit exceeded', code: 'over_email_send_rate_limit' }, { status: 429 })));
    mount('existing');
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@staff.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email rate limit exceeded');
    expect(screen.getByRole('button', { name: 'Email me a sign-in link' })).toBeEnabled();
    expect(screen.getByLabelText('Email')).toHaveValue('a@staff.test');
    expect(screen.queryByRole('status')).not.toBeInTheDocument(); expect(state.requests).toEqual([]);
  });
  it('sets the invited account password, activates, then waits for profile hydration before navigation', async () => {
    const view = mount(); await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Activate access' }));
    expect(await screen.findByText(/Your academy access is activated/)).toBeInTheDocument();
    expect(state.requests).toContain('password:Bearer token-a'); expect(state.requests).toContain('accept:Bearer token-a');
    expect(screen.queryByText('Coach home')).not.toBeInTheDocument();
    state.profile = { role: 'coach', full_name: 'New Coach' }; view.rerenderAccount();
    expect(await screen.findByText('Coach home')).toBeInTheDocument();
  });
  it.each(['new', 'existing'])('preserves an existing profile’s password with flow=%s', async flow => {
    state.profile = { role: 'coach', full_name: 'Existing Coach' }; mount(flow);
    fireEvent.click(await screen.findByRole('button', { name: 'Activate access' }));
    expect(await screen.findByText('Coach home')).toBeInTheDocument();
    expect(state.requests.some(value => value.startsWith('password:'))).toBe(false);
  });
  it('does not change credentials for an existing Auth account without a profile', async () => {
    mount('existing'); fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'New Coach' } });
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activate access' }));
    expect(await screen.findByText(/Your academy access is activated/)).toBeInTheDocument();
    expect(state.requests.some(value => value.startsWith('password:'))).toBe(false);
  });
  it('does not activate when password saving fails and permits retry with the form intact', async () => {
    let failures = 1;
    server.use(http.put(`${base}/auth/v1/user`, () => failures-- ? HttpResponse.json({ message: 'Unavailable' }, { status: 503 }) : HttpResponse.json(user())));
    mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Activate access' }));
    expect(await screen.findByText(/Could not save your password/)).toBeInTheDocument();
    expect(state.requests.some(value => value.startsWith('accept:'))).toBe(false);
    expect(screen.getByLabelText('Full name')).toHaveValue('New Coach');
    fireEvent.click(screen.getByRole('button', { name: 'Activate access' }));
    expect(await screen.findByText(/Your academy access is activated/)).toBeInTheDocument();
  });
  it('keeps an in-flight password write bound to A and stops before activation after switching to B', async () => {
    const hold = deferred(); const entered = deferred();
    server.use(http.put(`${base}/auth/v1/user`, async ({ request }) => {
      state.requests.push(`password:${request.headers.get('Authorization')}`); entered.resolve(); await hold.promise; return HttpResponse.json(user());
    }));
    const view = mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Activate access' }));
    await entered.promise;
    state.user = user('b'); localStorage.setItem('sb-staff-auth-token', JSON.stringify(session('b'))); view.rerenderAccount();
    await act(async () => { hold.resolve(); await hold.promise; });
    expect(await screen.findByText(/invitation is unavailable for your account/)).toBeInTheDocument();
    expect(screen.queryByText('Synthetic Academy')).not.toBeInTheDocument();
    expect(state.requests).toContain('password:Bearer token-a');
    expect(state.requests.some(value => value.startsWith('accept:'))).toBe(false);
    expect(state.requests).not.toContain('password:Bearer token-b');
  });
  it('keeps the current account visible after sign-out fails', async () => {
    state.signOut.mockResolvedValue({ error: new Error('Sign-out failed') }); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out to use another account' }));
    expect(await screen.findByText('Sign-out failed')).toBeInTheDocument();
    expect(screen.getByText('Signed in as a@staff.test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });
  it('offers retry after a failed invitation lookup instead of presenting an empty successful state', async () => {
    let failures = 1;
    server.use(http.post(`${base}/rest/v1/rpc/inspect_staff_invite`, () => failures-- ? HttpResponse.json({ message: 'Unavailable' }, { status: 500 })
      : HttpResponse.json({ role: 'coach', academy_name: 'Synthetic Academy', state: 'pending', expires_at: '2027-01-01T00:00:00Z' })));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Retry invitation' }));
    expect(await screen.findByLabelText('Full name')).toBeInTheDocument();
  });
});
