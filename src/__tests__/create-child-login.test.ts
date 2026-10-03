import { describe, expect, it, vi } from 'vitest'
import { handleCreateChildLogin, WeakPasswordError, type ChildLoginDependencies } from '../../supabase/functions/create-child-login/handler'

const child = '98c00000-0000-4000-8000-000000000030'
const reservation = { reservation_id: '98c00000-0000-4000-8000-000000000050', username: 'striker7', ready: false, guardian_user_id: '98c00000-0000-4000-8000-000000000003' }
const request = (body: unknown = { roster_child_id: child, username: 'striker7', password: 'Synthetic-Pass7!' }, token='parent-jwt') =>
  new Request('http://localhost/create-child-login', { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body:JSON.stringify(body) })
function dependencies(): ChildLoginDependencies {
  return { reserve:vi.fn().mockResolvedValue(reservation), createConfirmed:vi.fn().mockResolvedValue(undefined) }
}
describe('guardian-created child login handler', () => {
  it('creates a confirmed password identity with server-owned reservation metadata and returns only username/state', async () => {
    const d=dependencies()
    const response=await handleCreateChildLogin(request(),d)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ username:'striker7', state:'created' })
    expect(d.reserve).toHaveBeenCalledWith('parent-jwt',child,'striker7')
    expect(d.createConfirmed).toHaveBeenCalledWith({ email:'striker7@child.trakfootball.com',password:'Synthetic-Pass7!',email_confirm:true,
      app_metadata:{ trak_child_login:true, child_login_reservation:reservation.reservation_id, child_login_guardian:reservation.guardian_user_id } })
  })
  it('an acknowledged or lost-response retry never changes a completed child password', async () => {
    const d=dependencies()
    vi.mocked(d.reserve).mockResolvedValue({ ...reservation,ready:true })
    const response=await handleCreateChildLogin(request(),d)
    expect(await response.json()).toEqual({ username:'striker7',state:'already_created' })
    expect(d.createConfirmed).not.toHaveBeenCalled()
  })
  it('recovers a concurrent create/lost Auth response only when SQL confirms this owned reservation is ready', async () => {
    const d=dependencies()
    vi.mocked(d.createConfirmed).mockRejectedValue(new Error('private Auth failure'))
    vi.mocked(d.reserve).mockResolvedValueOnce(reservation).mockResolvedValueOnce({ ...reservation,ready:true })
    expect(await (await handleCreateChildLogin(request(),d)).json()).toEqual({username:'striker7',state:'already_created'})
  })
  it('never returns provider error details, technical addresses or passwords', async () => {
    const d=dependencies()
    vi.mocked(d.createConfirmed).mockRejectedValue(new Error('striker7@child.trakfootball.com Synthetic-Pass7!'))
    const response=await handleCreateChildLogin(request(),d)
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('{"error":"Could not create the login. Check its status and try again."}')
  })
  it('refuses a wrong or withdrawn guardian before any Admin operation', async () => {
    const d=dependencies()
    vi.mocked(d.reserve).mockRejectedValue(new Error('private SQL context'))
    const response=await handleCreateChildLogin(request(),d)
    expect(response.status).toBe(403)
    expect(d.createConfirmed).not.toHaveBeenCalled()
  })
  it('refuses a malformed reservation instead of trusting missing data', async () => {
    const d=dependencies()
    vi.mocked(d.reserve).mockResolvedValue({ ...reservation,reservation_id:'not-an-id' })
    expect((await handleCreateChildLogin(request(),d)).status).toBe(403)
    expect(d.createConfirmed).not.toHaveBeenCalled()
  })
  it.each([
    { roster_child_id:child,username:'bad@address',password:'Synthetic-Pass7!' },
    { roster_child_id:child,username:'striker7',password:'weak' },
    { roster_child_id:child,username:'striker7',password:'Synthetic-Pass7!',parent_user_id:'injected' },
  ])('rejects invalid input before reserving', async body => {
    const d=dependencies()
    expect((await handleCreateChildLogin(request(body),d)).status).toBe(400)
    expect(d.reserve).not.toHaveBeenCalled()
  })
  it('requires the guardian JWT, including on retries', async () => {
    const d=dependencies()
    expect((await handleCreateChildLogin(request(undefined,''),d)).status).toBe(401)
    expect(d.reserve).not.toHaveBeenCalled()
  })
})

// TRAK-106: Auth refuses a common password with 422 weak_password. Nothing was
// created, so there is nothing to recover; the guardian is told to pick another.
describe('a too-common password is reported as such (TRAK-106)', () => {
  it('answers 422 weak_password without the lost-response re-read', async () => {
    const d=dependencies()
    vi.mocked(d.createConfirmed).mockRejectedValue(new WeakPasswordError())
    const response=await handleCreateChildLogin(request(),d)
    expect(response.status).toBe(422)
    const reply=await response.json()
    expect(reply.reason).toBe('weak_password')
    expect(JSON.stringify(reply)).not.toContain('Synthetic-Pass7!')
    expect(JSON.stringify(reply)).not.toContain('child.trakfootball.com')
    expect(d.reserve).toHaveBeenCalledTimes(1)
  })
  it('CONTROL any other Auth failure keeps the 503 and the re-read', async () => {
    const d=dependencies()
    vi.mocked(d.createConfirmed).mockRejectedValue(new Error('Auth unavailable'))
    const response=await handleCreateChildLogin(request(),d)
    expect(response.status).toBe(503)
    expect(d.reserve).toHaveBeenCalledTimes(2)
  })
})
