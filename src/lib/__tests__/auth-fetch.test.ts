import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createAuthFetch } from '../auth-fetch';
const url = 'https://test.supabase.co'; let key = 'bounded-auth-test'; let sequence = 0;
const user = (id = 'a') => ({ id, email: `${id}@family.test`, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-20' });
const session = (id = 'a') => ({ user: user(id), access_token: `token-${id}`, refresh_token: `refresh-${id}`, token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const asFetch = (fn: (...args: Parameters<typeof fetch>) => Promise<Response>) => vi.fn(fn) as typeof fetch;
function sdk(fetcher: typeof fetch) {
 return createClient(url, 'synthetic-anon', { auth: { storage: localStorage, storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: createAuthFetch(url, localStorage, key, fetcher) } });
}
beforeEach(() => { vi.useFakeTimers(); key = `bounded-auth-test-${++sequence}`; localStorage.removeItem(key); });
afterEach(() => { vi.useRealTimers(); localStorage.removeItem(key); });

describe('persistent SDK Auth transport', () => {
 it('bounds stalled headers, aborts transport and discards a late sign-in session', async () => {
  const held = deferred<Response>(); let signal: AbortSignal | null | undefined;
  const client = sdk(asFetch(async (_input, init) => { signal = init?.signal; return held.promise; }));
  await client.auth.initialize(); await client.auth.stopAutoRefresh();
  let settled = false; const pending = client.auth.signInWithPassword({ email: 'a@family.test', password: 'SyntheticPass1!' }).then(r => { settled = true; return r; });
  await vi.advanceTimersByTimeAsync(20_000); expect(signal?.aborted).toBe(true); expect(settled).toBe(true);
  expect((await pending).error).toBeTruthy(); held.resolve(Response.json(session())); await vi.advanceTimersByTimeAsync(0);
  expect(localStorage.getItem(key)).toBeNull();
 });
 it('includes a stalled response body in the same deadline', async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const client = sdk(asFetch(async () => new Response(new ReadableStream({ start(controller) { body = controller; } }), { headers: { 'content-type':'application/json' } })));
  await client.auth.initialize(); await client.auth.stopAutoRefresh();
  let settled = false; const pending = client.auth.signInWithPassword({ email:'a@family.test', password:'SyntheticPass1!' }).then(r => { settled = true; return r; });
  await vi.advanceTimersByTimeAsync(20_000); expect(settled).toBe(true); expect((await pending).error).toBeTruthy();
  try { body.enqueue(new TextEncoder().encode(JSON.stringify(session()))); body.close(); } catch { /* body was cancelled */ }
  await vi.advanceTimersByTimeAsync(0); expect(localStorage.getItem(key)).toBeNull();
 });
 it('keeps a timed-out sign-out honest and permits a later successful retry', async () => {
  localStorage.setItem(key, JSON.stringify(session())); const held = deferred<Response>(); let calls = 0;
  const client = sdk(asFetch(async () => ++calls === 1 ? held.promise : new Response(null, { status:204 })));
  await client.auth.initialize(); await client.auth.stopAutoRefresh();
  let settled = false; const pending = client.auth.signOut().then(r => { settled = true; return r; });
  await vi.advanceTimersByTimeAsync(20_000); expect(settled).toBe(true); expect((await pending).error).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('a');
  expect((await client.auth.signOut()).error).toBeNull(); expect(localStorage.getItem(key)).toBeNull();
  held.resolve(new Response(null,{status:204})); await vi.advanceTimersByTimeAsync(0);
 });
 it.each(['password','logout'])('rejects a late %s response after another family has signed in', async action => {
  localStorage.setItem(key, JSON.stringify(session())); const held = deferred<Response>();
  const client = sdk(asFetch(async () => held.promise)); await client.auth.initialize(); await client.auth.stopAutoRefresh();
  const pending = action === 'password' ? client.auth.signInWithPassword({ email:'a@family.test', password:'SyntheticPass1!' }) : client.auth.signOut();
  await vi.advanceTimersByTimeAsync(0); localStorage.setItem(key, JSON.stringify(session('b')));
  held.resolve(action === 'password' ? Response.json(session()) : new Response(null,{status:204}));
  expect((await pending).error).toBeTruthy(); expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('b');
 });
 it('blocks superseded refresh retries without removing the newer family', async () => {
  localStorage.setItem(key, JSON.stringify(session())); const held = deferred<Response>(); let calls = 0;
  const client = sdk(asFetch(async () => { calls++; return held.promise; })); await client.auth.initialize(); await client.auth.stopAutoRefresh();
  const pending = client.auth.refreshSession(); await vi.advanceTimersByTimeAsync(0);
  localStorage.setItem(key, JSON.stringify(session('b'))); held.resolve(Response.json(session()));
  await vi.advanceTimersByTimeAsync(40_000); expect((await pending).error).toBeTruthy();
  expect(calls).toBe(1); expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('b');
 });
 it('rejects an old refresh when the family changes between SDK retry attempts', async () => {
  localStorage.setItem(key, JSON.stringify(session())); const held = deferred<Response>(); let calls=0;
  const client=sdk(asFetch(async () => ++calls === 1 ? held.promise : Response.json(session())));
  await client.auth.initialize(); await client.auth.stopAutoRefresh();
  const pending=client.auth.refreshSession(); await vi.advanceTimersByTimeAsync(20_000);
  localStorage.setItem(key, JSON.stringify(session('b')));
  await vi.advanceTimersByTimeAsync(40_000); expect((await pending).error).toBeTruthy();
  expect(calls).toBe(1); expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('b');
  held.resolve(Response.json(session())); await vi.advanceTimersByTimeAsync(0);
 });
 it('keeps the original refresh owner when a background retry resumes much later', async () => {
  localStorage.setItem(key,JSON.stringify(session())); const held=deferred<Response>();let calls=0;
  const client=sdk(asFetch(async () => ++calls===1?held.promise:Response.json(session())));
  await client.auth.initialize();await client.auth.stopAutoRefresh();const pending=client.auth.refreshSession();
  await vi.advanceTimersByTimeAsync(20_000);localStorage.setItem(key,JSON.stringify(session('b')));
  vi.setSystemTime(Date.now()+120_000);await vi.advanceTimersByTimeAsync(1000);
  expect((await pending).error).toBeTruthy();expect(calls).toBe(1);expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('b');
  held.resolve(Response.json(session()));await vi.advanceTimersByTimeAsync(0);
 });
 it('aborts a live request on a real cross-tab storage notification', async () => {
  localStorage.setItem(key,JSON.stringify(session())); const held=deferred<Response>(); let signal:AbortSignal|null|undefined;
  const client=sdk(asFetch(async (_input,init) => {signal=init?.signal;return held.promise;}));
  await client.auth.initialize();await client.auth.stopAutoRefresh();
  const pending=client.auth.signInWithPassword({email:'a@family.test',password:'SyntheticPass1!'}); await vi.advanceTimersByTimeAsync(0);
  localStorage.setItem(key,JSON.stringify(session('b'))); window.dispatchEvent(new StorageEvent('storage',{key}));
  await vi.advanceTimersByTimeAsync(0); expect(signal?.aborted).toBe(true);expect((await pending).error).toBeTruthy();
  held.resolve(Response.json(session()));await vi.advanceTimersByTimeAsync(0);expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('b');
 });
 it('honours an already-cancelled caller without sending a request', async () => {
  const raw=asFetch(async () => Response.json(user()));const outer=new AbortController();outer.abort();
  const fetcher=createAuthFetch(url,localStorage,key,raw);
  await expect(fetcher(`${url}/auth/v1/user`,{signal:outer.signal})).rejects.toMatchObject({name:'AbortError'});
  expect(raw).not.toHaveBeenCalled();
 });
 it('preserves an explicit successful account adoption and refresh-token reuse', async () => {
  localStorage.setItem(key,JSON.stringify(session()));
  const client=sdk(asFetch(async () => Response.json(session('b')))); await client.auth.initialize();await client.auth.stopAutoRefresh();
  expect((await client.auth.refreshSession({refresh_token:'refresh-b'})).error).toBeNull();
  expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('b');
  expect((await client.auth.refreshSession()).error).toBeNull();
  expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('b');
 });
 it('preserves HTTP rejection details and a successful authenticated response', async () => {
  let reject = true; const client = sdk(asFetch(async () => reject
   ? Response.json({ error_code:'invalid_credentials', msg:'Invalid login credentials' }, {status:400}) : Response.json(session())));
  await client.auth.initialize(); await client.auth.stopAutoRefresh();
  const first = await client.auth.signInWithPassword({ email:'a@family.test',password:'SyntheticPass1!' });
  expect(first.error?.status).toBe(400); expect(first.error?.message).toBe('Invalid login credentials');
  reject=false; expect((await client.auth.signInWithPassword({email:'a@family.test',password:'SyntheticPass1!'})).error).toBeNull();
  expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('a');
 });
 it('passes non-Auth streaming through unchanged', async () => {
  const response = new Response(new ReadableStream()); const raw = asFetch(async () => response);
  const fetcher=createAuthFetch(url,localStorage,key,raw); const outer=new AbortController();
  const options={method:'POST',signal:outer.signal,body:'synthetic'};
  expect(await fetcher(`${url}/functions/v1/coach-assistant`,options)).toBe(response);
  expect(raw).toHaveBeenCalledWith(`${url}/functions/v1/coach-assistant`,options);
 });
});
