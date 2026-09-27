import { describe, it, expect, beforeEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { registerAuthUser } from '../../../../tests/msw/auth-sessions'
import { server } from '../../../../tests/msw/server'
import { table, insertInto, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { supabase } from '@/integrations/supabase/client'

const COACH={id:'coach-1'}
const row=(id:string,player_name:string)=>({id,coach_user_id:COACH.id,player_name,
 linked_player_id:`player-${id}`,position:'Defender',age_group:'U15',age:15})
const READY=row('ready','Rea Ready'), WITHDRAWN=row('withdrawn','Wes Withdrawn')
function setup(players=[READY,WITHDRAWN]) {
 const inserted: Record<string,unknown>[]=[]
 server.use(
  table('profiles',[{id:'p',user_id:COACH.id,role:'coach',full_name:'Coach',invite_code:'ABCD'}]),
  table('squad_players',players), table('coach_sessions',[]),
  insertInto('coach_sessions',body=>({id:'session-1',...body})),
  http.post(`${SUPABASE_URL}/rest/v1/session_attendance`,async({request})=>{
   inserted.push(...await request.json() as Record<string,unknown>[])
   return new HttpResponse(null,{status:201})
  }),
  http.post(`${SUPABASE_URL}/auth/v1/token`,()=>{
   const previous=JSON.parse(localStorage.getItem('sb-test-auth-token')!)
   const user=structuredClone(previous.user)
   return HttpResponse.json({...previous,user,access_token:registerAuthUser(user),
    expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600})
  }),
 )
 return inserted
}
async function refresh(){await act(async()=>{const {error}=await supabase.auth.refreshSession();expect(error).toBeNull()})}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}}

describe('independent #126 consent refresh review',()=>{
 beforeEach(()=>signInAs(COACH))
 it('excludes a selected child from the outgoing batch after a fresh check marks them waiting',async()=>{
  const inserted=setup();let withdrawn=false
  server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`,async({request})=>{
   const {p_squad_player_id}=await request.json() as {p_squad_player_id:string}
   return HttpResponse.json(withdrawn&&p_squad_player_id==='withdrawn')
  }))
  const user=userEvent.setup();renderApp('/coach/sessions/add')
  await screen.findByRole('button',{name:/Wes Withdrawn/})
  await user.click(screen.getByRole('button',{name:/Technical/}))
  await user.click(screen.getByRole('button',{name:'ALL'}))
  withdrawn=true;await refresh()
  await screen.findByText(/Wes Withdrawn \(waiting for a parent\)/)
  expect(screen.queryByRole('button',{name:/Wes Withdrawn/})).toBeNull()
  await user.click(screen.getByRole('button',{name:'Save session'}))
  await waitFor(()=>expect(inserted.length).toBeGreaterThan(0))
  expect(inserted.map(p=>p.squad_player_id)).toEqual(['ready'])
 })
 it('offers no cached players when a later roster load fails',async()=>{
  setup([READY]);let fail=false
  server.use(http.get(`${SUPABASE_URL}/rest/v1/squad_players`,()=> fail
   ? HttpResponse.json({message:'roster unavailable',code:'XX000'},{status:400}) : HttpResponse.json([READY])),
   http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`,()=>HttpResponse.json(false)))
  renderApp('/coach/sessions/add');await screen.findByRole('button',{name:/Rea Ready/})
  fail=true;await refresh();await screen.findByText(/Couldn't load your squad/)
  expect(screen.queryByRole('button',{name:/Rea Ready/})).toBeNull()
 })
 it('ignores an older ready response after the newer check has marked the child waiting',async()=>{
  setup([READY]);const held=deferred();let checks=0
  server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`,async()=>{
   const call=++checks
   if(call===1){await held.promise;return HttpResponse.json(false)}
   return HttpResponse.json(true)
  }))
  renderApp('/coach/sessions/add');await waitFor(()=>expect(checks).toBe(1))
  await refresh();await screen.findByText(/Rea Ready \(waiting for a parent\)/)
  await act(async()=>{held.resolve();await held.promise;await new Promise(r=>setTimeout(r,50))})
  expect(screen.queryByRole('button',{name:/Rea Ready/})).toBeNull()
  expect(screen.getByText(/Rea Ready \(waiting for a parent\)/)).toBeInTheDocument()
 })
})
