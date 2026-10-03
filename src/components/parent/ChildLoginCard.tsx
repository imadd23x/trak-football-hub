import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { createChildLogin } from '@/lib/parent-consent'
import { ChildPasswordError, validateChildUsername, WEAK_PASSWORD_MESSAGE, type ChildLoginState } from '@/lib/child-login'
import { PASSWORD_HINT, validatePassword } from '@/lib/password'

export function ChildLoginCard({parentId,child,onContinue}:{parentId:string;child:ChildLoginState;onContinue:()=>void}) {
  const [username,setUsername]=useState(child.username??'')
  const [password,setPassword]=useState('')
  const [confirm,setConfirm]=useState('')
  const [ready,setReady]=useState(child.ready)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const request=useRef<AbortController|null>(null)
  useEffect(()=>()=>{request.current?.abort()},[])
  const save=async()=>{
    if(request.current) return
    const problem=validateChildUsername(username)||validatePassword(password)
      || (password!==confirm ? 'Passwords do not match' : null)
    if(problem){setError(problem);return}
    const controller=new AbortController();request.current=controller
    setBusy(true);setError(null)
    try {
      await createChildLogin(parentId,child.roster_child_id,username,password,controller.signal)
      if(controller.signal.aborted)return
      setPassword('');setConfirm('');setReady(true)
    } catch(e) {
      // TRAK-106: only a refused reservation is about the username or approval.
      const reason=e instanceof ChildPasswordError ? e.reason : 'failed'
      if(controller.signal.aborted)return
      if(reason==='weak_password'){setPassword('');setConfirm('');setError(WEAK_PASSWORD_MESSAGE)}
      else setError(reason==='refused'
        ? 'Could not create the login. Check the username and your approval, then try again.'
        : 'Could not create the login. Please try again.')
    }
    finally {if(!controller.signal.aborted){request.current=null;setBusy(false)}}
  }
  return <div className="p-6 flex flex-col gap-4">
    <h1 className="text-xl text-foreground">{ready ? `${child.first_name}'s login is ready` : `Create ${child.first_name}'s login`}</h1>
    {ready ? <>
      <p className="text-sm text-foreground">Username: <strong>{username}</strong></p>
      <p className="text-sm text-muted-foreground">Share this username and the password you set with {child.first_name}. They sign in on Trak and finish their account setup. No email is sent.</p>
      <Button onClick={onContinue}>Continue</Button>
    </> : <>
      <p className="text-sm text-muted-foreground">Your approval is saved. Choose a username different from your child's name and a password to share with them. They do not need an email address.</p>
      <label htmlFor="child-username" className="text-sm text-muted-foreground">Child's username</label>
      <Input id="child-username" autoComplete="off" value={username} disabled={!!child.username||busy}
        onChange={e=>setUsername(e.target.value.toLowerCase())} maxLength={30}/>
      <p className="text-xs text-muted-foreground">4–30 letters, numbers, dots, underscores or hyphens. Include a number.</p>
      <PasswordInput label="Child's password" autoComplete="new-password" placeholder={PASSWORD_HINT} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} />
      <PasswordInput label="Confirm child's password" autoComplete="new-password" value={confirm} disabled={busy} onChange={e=>setConfirm(e.target.value)} />
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy} onClick={()=>{void save()}}>{busy?'Creating…':'Create login'}</Button>
    </>}
  </div>
}
