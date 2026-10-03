// Real routed App and SDK; synthetic intercepted HTTP. SQL authority is tested
// separately in guardian_child_login.sql. This is not live/phone proof.
import { cleanup,render,screen,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '@supabase/supabase-js'
import { http,HttpResponse } from 'msw'
import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import App from '@/App'
import { supabase } from '@/integrations/supabase/client'
import { CONSENT_STATEMENT } from '@/lib/consent'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

const id='98d00000-0000-4000-8000-000000000030'
const roster={roster_child_id:id,first_name:'Ana',age_years:12}
const url=(path:string)=>`${SUPABASE_URL}/rest/v1/${path}`
let sequence=0
let session:Session
let approved:boolean
let ready:boolean
let created:unknown[]
let invites:unknown[]
let stateFailure:boolean
let createReply:{status:number;body:Record<string,string>}|null
beforeEach(()=>{
  approved=false;ready=false;created=[];invites=[];stateFailure=false;createReply=null
  vi.stubEnv('DEV',false)
  const uid=`98d00000-0000-4000-8000-${String(++sequence+100).padStart(12,'0')}`
  const expiresAt=Math.floor(Date.now()/1000)+3600
  const token=[{alg:'HS256',typ:'JWT'},{sub:uid,exp:expiresAt,role:'authenticated'}].map(p=>Buffer.from(JSON.stringify(p)).toString('base64url')).join('.')+'.'+Buffer.from('synthetic-signature').toString('base64url')
  session={access_token:token,refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:expiresAt,
    user:{id:uid,aud:'authenticated',role:'authenticated',email:'parent@child-login.test',email_confirmed_at:'2026-09-30T00:00:00Z',app_metadata:{},user_metadata:{},created_at:'2026-09-30T00:00:00Z'}}
  server.use(
    http.get(`${SUPABASE_URL}/auth/v1/user`,()=>HttpResponse.json(session.user)),
    http.get(url('profiles'),()=>HttpResponse.json([{id:uid,user_id:uid,role:'parent',full_name:'Synthetic Parent',nationality:null}])),
    http.get(url('player_parent_links'),()=>HttpResponse.json([])),
    http.post(url('rpc/get_children_awaiting_consent'),()=>HttpResponse.json([])),
    http.post(url('rpc/get_roster_children_awaiting_consent'),()=>HttpResponse.json(approved?[]:[roster])),
    http.post(url('rpc/get_my_child_logins'),()=>stateFailure
      ? HttpResponse.json({message:'synthetic unavailable'},{status:503})
      : HttpResponse.json(approved?[{roster_child_id:id,first_name:'Ana',username:ready?'striker7':null,ready}]:[])),
    http.post(url('rpc/record_roster_consent'),()=>{approved=true;return HttpResponse.json('98d00000-0000-4000-8000-000000000050')}),
    http.post(`${SUPABASE_URL}/functions/v1/create-child-login`,async({request})=>{
      expect(request.headers.get('authorization')).toBe(`Bearer ${session.access_token}`)
      if(createReply){created.push(await request.json());return HttpResponse.json(createReply.body,{status:createReply.status})}
      created.push(await request.json());ready=true
      return HttpResponse.json({username:'striker7',state:'created'})
    }),
    http.post(`${SUPABASE_URL}/functions/v1/send-roster-invites`,async({request})=>{
      invites.push(await request.json());return HttpResponse.json({sent:1})
    }),
  )
})
afterEach(()=>{cleanup();vi.unstubAllEnvs()})
async function open(path='/parent/consent'){
  expect((await supabase.auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token})).error).toBeNull()
  window.history.replaceState({},'',path);render(<App/>);
}
it('approves first, creates a login without mail, then clears password fields',async()=>{
  await open()
  await screen.findByRole('heading',{name:"Approve Ana's account"})
  expect(created).toEqual([])
  await userEvent.click(screen.getByRole('checkbox',{name:CONSENT_STATEMENT}))
  await userEvent.click(screen.getByRole('button',{name:"Approve Ana's account"}))
  await screen.findByRole('heading',{name:"Create Ana's login"})
  await userEvent.type(screen.getByLabelText("Child's username"),'striker7')
  await userEvent.type(screen.getByLabelText("Child's password"),'Synthetic-Pass7!')
  await userEvent.type(screen.getByLabelText("Confirm child's password"),'Synthetic-Pass7!')
  await userEvent.click(screen.getByRole('button',{name:'Create login'}))
  await screen.findByRole('heading',{name:"Ana's login is ready"})
  expect(created).toEqual([{roster_child_id:id,username:'striker7',password:'Synthetic-Pass7!'}])
  expect(invites).toEqual([])
  expect(screen.queryByLabelText("Child's password")).toBeNull()
  expect(document.body.textContent).not.toContain('child.trakfootball.com')
})
it('recovers a consented unfinished child after reload through the Home banner',async()=>{
  approved=true;await open('/parent/home')
  await userEvent.click(await screen.findByText("Finish your child's login setup"))
  await userEvent.click(await screen.findByRole('button',{name:"Create Ana's login"}))
  expect(await screen.findByLabelText("Child's username")).toBeInTheDocument()
  expect(invites).toEqual([])
})
it('shows the previously created username after a lost creation response, without another create',async()=>{
  approved=true;ready=true;await open()
  await userEvent.click(await screen.findByRole('button',{name:"View Ana's login"}))
  expect(await screen.findByText('striker7')).toBeInTheDocument()
  expect(created).toEqual([])
})
it('a failed login-state check remains an error and cannot fall through to an email send',async()=>{
  stateFailure=true;await open()
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load pending approvals"))
  expect(screen.queryByText('Nothing to approve')).toBeNull()
  expect(invites).toEqual([])
})

// TRAK-106: a too-common password was reported as an approval problem. Each
// failure now says what happened; a weak password keeps the username.
async function tryCreate(){
  approved=true;await open('/parent/home')
  await userEvent.click(await screen.findByText("Finish your child's login setup"))
  await userEvent.click(await screen.findByRole('button',{name:"Create Ana's login"}))
  await userEvent.type(await screen.findByLabelText("Child's username"),'striker7')
  await userEvent.type(screen.getByLabelText("Child's password"),'Synthetic-Pass7!')
  await userEvent.type(screen.getByLabelText("Confirm child's password"),'Synthetic-Pass7!')
  await userEvent.click(screen.getByRole('button',{name:'Create login'}))
}
it('a too-common password says so, keeps the username and clears only the passwords',async()=>{
  createReply={status:422,body:{reason:'weak_password',error:'That password is too easy to guess. Choose a different one.'}}
  await tryCreate()
  const alert=await screen.findByRole('alert')
  expect(alert).toHaveTextContent('That password is too easy to guess (it appears in known leaks). Choose a different one.')
  expect(alert).not.toHaveTextContent(/approval/)
  expect(screen.getByLabelText("Child's username")).toHaveValue('striker7')
  expect(screen.getByLabelText("Child's password")).toHaveValue('')
  expect(screen.getByLabelText("Confirm child's password")).toHaveValue('')
  expect(screen.queryByRole('heading',{name:"Ana's login is ready"})).toBeNull()
})
it('only a refused reservation (403) is pointed at the username and approval',async()=>{
  createReply={status:403,body:{error:'Could not reserve this login. Check the username and your guardian approval.'}}
  await tryCreate()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not create the login. Check the username and your approval, then try again.')
})
it('CONTROL any other failure says try again, with no approval wording',async()=>{
  createReply={status:503,body:{error:'Could not create the login. Check its status and try again.'}}
  await tryCreate()
  const alert=await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Could not create the login. Please try again.')
  expect(alert).not.toHaveTextContent(/approval|too easy/)
  expect(screen.getByLabelText("Child's password")).toHaveValue('Synthetic-Pass7!')
})
