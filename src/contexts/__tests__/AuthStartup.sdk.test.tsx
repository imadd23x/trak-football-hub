import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import { AuthProvider, useAuth } from '../AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { AccountLoading } from '@/components/layout/AccountLoading';
vi.mock('sonner', () => ({toast:{error:vi.fn(),warning:vi.fn(),success:vi.fn()}}));
vi.mock('@/lib/telemetry', () => ({setTelemetryRole:vi.fn(),trackSessionOpen:vi.fn()}));
vi.mock('@/integrations/supabase/client',async()=>{
 const {createClient}=await import('@supabase/supabase-js');const {createAuthFetch}=await import('@/lib/auth-fetch');
 return {supabase:createClient('https://test.supabase.co','synthetic-anon',{auth:{storage:localStorage,storageKey:'startup-sdk',autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:createAuthFetch('https://test.supabase.co',localStorage,'startup-sdk')}}),SUPABASE_FUNCTIONS_URL:'https://test.supabase.co/functions/v1',SUPABASE_ANON_KEY:'synthetic-anon'};
});
const url='https://test.supabase.co';const user=(id='a')=>({id,email:`${id}@family.test`,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-09-20'});
const session=(id='a',expired=false)=>({user:user(id),access_token:`token-${id}`,refresh_token:`refresh-${id}`,token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+(expired?-120:3600),expires_in:3600});
let query:QueryClient;
function View(){const {user,profile,loading,sessionError,signIn}=useAuth();return <><output data-testid="identity">{user?.id}:{profile?.user_id}</output>{loading&&<AccountLoading error={sessionError}/>}<button onClick={()=>{void signIn('b@family.test','SyntheticPass1!');}}>Sign in B</button></>;}
function mount(){return render(<QueryClientProvider client={query}><MemoryRouter><AuthProvider><View/></AuthProvider></MemoryRouter></QueryClientProvider>);}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{resolve,promise};}
beforeEach(async()=>{vi.clearAllMocks();await supabase.auth.initialize();await supabase.auth.stopAutoRefresh();localStorage.setItem('startup-sdk',JSON.stringify(session('a',true)));query=new QueryClient({defaultOptions:{queries:{retry:false}}});
 server.use(http.post(`${url}/auth/v1/token`,()=>HttpResponse.json(session('b'))),http.get(`${url}/auth/v1/user`,({request})=>HttpResponse.json(user(request.headers.get('Authorization')==='Bearer token-b'?'b':'a'))),http.get(`${url}/rest/v1/profiles`,({request})=>{const id=new URL(request.url).searchParams.get('user_id')!.slice(3);return HttpResponse.json({id:`profile-${id}`,user_id:id,role:'parent',full_name:id,nationality:null});}));
});
afterEach(()=>{cleanup();query.clear();vi.restoreAllMocks();localStorage.removeItem('startup-sdk');});
it('does not let an old INITIAL_SESSION failure erase a newer completed sign-in',async()=>{
 const held=deferred();let started=false;
 server.use(http.post(`${url}/auth/v1/token`,async({request})=>{if(new URL(request.url).searchParams.get('grant_type')==='refresh_token'){started=true;await held.promise;return HttpResponse.json(session());}return HttpResponse.json(session('b'));}));
 const events:string[]=[];const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{events.push(event);});
 try{mount();await waitFor(()=>expect(started).toBe(true));fireEvent.click(screen.getByRole('button',{name:'Sign in B'}));await waitFor(()=>expect(screen.getByTestId('identity')).toHaveTextContent('b:b'));
  // Let the real SDK end the old refresh retry cycle without sleeping for it.
  const later=Date.now()+31_000;vi.spyOn(Date,'now').mockReturnValue(later);await act(async()=>held.resolve());
  await waitFor(()=>expect(events).toContain('INITIAL_SESSION'));expect(screen.getByTestId('identity')).toHaveTextContent('b:b');
  expect(JSON.parse(localStorage.getItem('startup-sdk')!).user.id).toBe('b');
 }finally{held.resolve();subscription.unsubscribe();}
});
it('offers startup recovery without treating a still-unverified session as signed out',async()=>{
 const held=deferred();let started=false;const timers:(()=>void)[]=[];const native=setTimeout;
 vi.spyOn(globalThis,'setTimeout').mockImplementation((handler,ms,...args)=>{if(ms===20_000&&typeof handler==='function')timers.push(()=>handler(...args));return native(handler,ms,...args);});
 server.use(http.post(`${url}/auth/v1/token`,async()=>{started=true;await held.promise;return HttpResponse.json(session());}));
 try{mount();await waitFor(()=>expect(started).toBe(true));await act(async()=>timers[0]());
  expect(await screen.findByRole('alert')).toHaveTextContent('could not restore');expect(screen.getByRole('button',{name:'Try again'})).toBeEnabled();expect(screen.getByTestId('identity')).toHaveTextContent(':');
  expect(JSON.parse(localStorage.getItem('startup-sdk')!).user.id).toBe('a');
  await act(async()=>held.resolve());await waitFor(()=>expect(screen.getByTestId('identity')).toHaveTextContent('a:a'));expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 }finally{held.resolve();}
});
