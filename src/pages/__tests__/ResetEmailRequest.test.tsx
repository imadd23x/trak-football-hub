import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import LandingPage from '../LandingPage';

const messages = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: messages }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, profile: null, loading: false,
  signIn: async () => ({ error: null }), signOut: vi.fn(), refreshProfile: vi.fn() }) }));
const endpoint = 'https://test.supabase.co/auth/v1/recover';
let requests: unknown[] = [];
function mount() { return render(<MemoryRouter><LandingPage /></MemoryRouter>); }
function email(value: string) { fireEvent.change(screen.getByLabelText('Email'), { target: { value } }); }
function send() { fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' })); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { resolve, promise }; }
beforeEach(() => {
  vi.clearAllMocks(); requests = []; window.history.replaceState({}, '', '/');
  server.use(http.post(endpoint, async ({ request }) => { requests.push(await request.json()); return HttpResponse.json({}); }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Landing password-reset email requests through the real SDK', () => {
  it.each(['', '   ', 'invalid-email'])('rejects malformed input without a request: %j', async value => {
    mount(); email(value); send(); expect(await screen.findByRole('alert')).toHaveTextContent('valid email'); expect(requests).toEqual([]);
  });
  it('trims the captured email, uses the recovery redirect and reports no delivery guarantee', async () => {
    server.use(http.post(endpoint, async ({ request }) => {
      requests.push(await request.json()); expect(new URL(request.url).searchParams.get('redirect_to')).toBe(`${location.origin}/reset-password`);
      return HttpResponse.json({});
    }));
    mount(); email('  alex@family.test  '); send();
    await waitFor(() => expect(screen.getByRole('status', { name: 'Password reset request' })).toHaveTextContent('If this email is registered'));
    expect(requests).toEqual([expect.objectContaining({ email: 'alex@family.test' })]); expect(messages.success).not.toHaveBeenCalled();
  });
  it('does not submit duplicate requests while pending', async () => {
    const held = deferred(); server.use(http.post(endpoint, async ({ request }) => { requests.push(await request.json()); await held.promise; return HttpResponse.json({}); }));
    try {
      mount(); email('alex@family.test'); const button = screen.getByRole('button', { name: 'Forgot password?' });
      fireEvent.click(button); fireEvent.click(button); await waitFor(() => expect(requests).toHaveLength(1));
      expect(button).toBeDisabled(); await act(async () => held.resolve());
      await waitFor(() => expect(screen.getByRole('status', { name: 'Password reset request' })).toHaveTextContent('If this email is registered'));
    } finally { held.resolve(); }
  });
  it.each([[429, 'Too many requests'], [503, 'could not confirm']])('handles HTTP %s without claiming delivery', async (status, message) => {
    server.use(http.post(endpoint, () => HttpResponse.json({ code: 'synthetic_error', msg: 'Private provider detail' }, { status: Number(status) })));
    mount(); email('alex@family.test'); send(); expect(await screen.findByRole('alert')).toHaveTextContent(String(message));
    expect(screen.queryByText('Private provider detail')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeEnabled(); expect(messages.success).not.toHaveBeenCalled();
  });
  it('ignores the old request after its email target changes', async () => {
    const held = deferred(); server.use(http.post(endpoint, async ({ request }) => { requests.push(await request.json()); await held.promise; return HttpResponse.json({}); }));
    try {
      mount(); email('alex@family.test'); send(); await waitFor(() => expect(requests).toHaveLength(1));
      email('other@family.test'); await act(async () => held.resolve());
      expect(screen.queryByRole('status')).not.toBeInTheDocument(); expect(messages.success).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeEnabled();
      expect(requests).toEqual([expect.objectContaining({ email: 'alex@family.test' })]);
    } finally { held.resolve(); }
  });
  it('does not show global feedback after navigating away', async () => {
    const held = deferred(); server.use(http.post(endpoint, async ({ request }) => { requests.push(await request.json()); await held.promise; return HttpResponse.json({}); }));
    try {
      const view = mount(); email('alex@family.test'); send(); await waitFor(() => expect(requests).toHaveLength(1));
      view.unmount(); await act(async () => held.resolve()); expect(messages.success).not.toHaveBeenCalled(); expect(messages.error).not.toHaveBeenCalled();
    } finally { held.resolve(); }
  });
  it('bounds a stalled request and offers an honest retry', async () => {
    let expire: (() => void) | undefined; let started = false; let aborted = false; const held = deferred(); const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, milliseconds, ...args) => {
      if (milliseconds === 20_000 && typeof handler === 'function') expire = () => handler(...args);
      return timer(handler, milliseconds, ...args);
    });
    server.use(http.post(endpoint, async ({ request }) => { started = true; request.signal.addEventListener('abort', () => { aborted = true; held.resolve(); }); await held.promise; return HttpResponse.json({}); }));
    try {
      mount(); email('alex@family.test'); send(); await waitFor(() => expect(started).toBe(true)); expect(expire).toBeTypeOf('function');
      await act(async () => expire!()); expect(await screen.findByRole('alert')).toHaveTextContent('could not confirm');
      expect(aborted).toBe(true); expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeEnabled();
    } finally { held.resolve(); }
  });
});
