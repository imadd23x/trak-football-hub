import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { cleanup,screen,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http,HttpResponse } from 'msw'
import { renderApp } from '../../../tests/support/render-app'
import { signInAs } from '../../../tests/support/session'
import { server } from '../../../tests/msw/server'
import { rpc,SUPABASE_URL } from '../../../tests/msw/supabase'

let id:string
let sequence=0
let provisioned:boolean
let profiles:unknown[]
let passwords:unknown[]
let recovery:unknown[]
beforeEach(()=>{
 id=`guardian-created-child-${++sequence}`;provisioned=false;profiles=[];passwords=[];recovery=[]
 vi.stubEnv('DEV',false)
 signInAs({id,email:'striker7@child.trakfootball.com',app_metadata:{trak_child_login:true},user_metadata:{child_first_name:'Ana'}})
 server.use(
  http.get(`${SUPABASE_URL}/rest/v1/profiles`,()=>HttpResponse.json(provisioned
   ? [{id,user_id:id,role:'player',full_name:'Ana Synthetic',nationality:null}] : [])),
  http.put(`${SUPABASE_URL}/auth/v1/user`,async({request})=>{passwords.push(await request.json());return HttpResponse.json({id})}),
  http.post(`${SUPABASE_URL}/auth/v1/recover`,async({request})=>{recovery.push(await request.json());return HttpResponse.json({})}),
  rpc('provision_my_profile',args=>{profiles.push(args);provisioned=true;return {warnings:[]}}),
  rpc('my_consent_status',()=>({required:false,granted:true,invited_parent:null})),
  rpc('get_player_invites_for_current_user',()=>[]),
  http.get(`${SUPABASE_URL}/rest/v1/:table`,()=>HttpResponse.json([])),
 )
})
afterEach(()=>{cleanup();vi.unstubAllEnvs()})
it('recovers a forgotten child username through guardian guidance when the identity field is blank, without sending email',async()=>{
 localStorage.clear()
 renderApp('/')
 await screen.findByLabelText('Email or username')
 await userEvent.click(screen.getByRole('button',{name:'Forgot password?'}))
 expect(await screen.findByText(/Forgot a child username\? Ask your parent or guardian/)).toBeInTheDocument()
 expect(recovery).toEqual([])
})
it('does not send reset mail when a technical child address is pasted with whitespace',async()=>{
 localStorage.clear()
 renderApp('/')
 await userEvent.type(await screen.findByLabelText('Email or username'),'striker7@child.trakfootball.com ')
 await userEvent.click(screen.getByRole('button',{name:'Forgot password?'}))
 expect(await screen.findByText(/Ask your parent or guardian to set a new password/)).toBeInTheDocument()
 expect(recovery).toEqual([])
})
it('routes an unprofiled guardian-created child from sign-in to the existing setup, without setting the password again',async()=>{
 renderApp('/')
 expect(await screen.findByText('Your academy has your name, date of birth and age group.')).toBeInTheDocument()
 expect(window.location.pathname).toBe('/onboarding/player')
 expect(screen.queryByLabelText('New password')).toBeNull()
 // TRAK-103: the guardian-created child types no name either.
 expect(screen.queryByLabelText('Your name')).toBeNull()
 await userEvent.click(screen.getByRole('button',{name:'Finish'}))
 await waitFor(()=>expect(window.location.pathname).toBe('/player/home'))
 expect(profiles).toEqual([{p:{role:'player',player_details:{}}}])
 expect(passwords).toEqual([])
 expect(document.body.textContent).not.toContain('child.trakfootball.com')
})
it('cannot skip password setup by forging the user-editable metadata marker',async()=>{
 signInAs({id,email:'ordinary@example.test',user_metadata:{trak_child_login:true}})
 renderApp('/onboarding/player')
 expect(await screen.findByLabelText('New password')).toBeInTheDocument()
 expect(screen.queryByLabelText('Your name')).toBeNull()
})
it('Settings exposes the username and directs recovery to the guardian without sending email',async()=>{
 provisioned=true;renderApp('/settings')
 expect(await screen.findByText('striker7')).toBeInTheDocument()
 expect(screen.getByText('Username')).toBeInTheDocument()
 expect(document.body.textContent).not.toContain('child.trakfootball.com')
 await userEvent.click(screen.getByRole('button',{name:'Ask your guardian'}))
 expect(await screen.findByText(/Ask your parent or guardian to set a new password/)).toBeInTheDocument()
 expect(recovery).toEqual([])
})
it('maps a username only inside the Auth request and gives a private generic failure',async()=>{
 localStorage.clear()
 const tokens:unknown[]=[]
 server.use(http.post(`${SUPABASE_URL}/auth/v1/token`,async({request})=>{
   tokens.push(await request.json());return HttpResponse.json({msg:'striker7@child.trakfootball.com refused'},{status:400})
 }))
 renderApp('/')
 await userEvent.type(await screen.findByLabelText('Email or username'),'striker7')
 await userEvent.type(screen.getByLabelText('Password'),'Synthetic-Pass7!')
 await userEvent.click(screen.getByRole('button',{name:'Sign in'}))
 await waitFor(()=>expect(tokens).toHaveLength(1))
 expect(tokens[0]).toMatchObject({email:'striker7@child.trakfootball.com',password:'Synthetic-Pass7!'})
 expect(await screen.findByText('Could not sign in. Check your email or username and password.')).toBeInTheDocument()
 expect(document.body.textContent).not.toContain('child.trakfootball.com')
 await userEvent.click(screen.getByRole('button',{name:'Forgot password?'}))
 expect(await screen.findByText(/Ask your parent or guardian to set a new password/)).toBeInTheDocument()
 expect(recovery).toEqual([])
})
