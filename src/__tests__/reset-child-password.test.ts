import { describe, expect, it, vi } from 'vitest'
import { handleResetChildPassword, type ChildPasswordDependencies } from '../../supabase/functions/reset-child-password/handler'

const rosterId = '98c00000-0000-4000-8000-000000000030'
const authId = '98c00000-0000-4000-8000-000000000040'
const body = { roster_child_id: rosterId, password: 'Synthetic-Pass9!' }
const request = (value: unknown = body, token = 'guardian-jwt') => new Request('http://localhost/reset-child-password', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value),
})
function dependencies(): ChildPasswordDependencies {
  return { authorize: vi.fn().mockResolvedValue(authId), reset: vi.fn().mockResolvedValue(undefined),
    endSessions: vi.fn().mockResolvedValue(2) }
}
describe('guardian password recovery', () => {
  it('takes the Auth target only from caller-authorized SQL and returns no user/password/address', async () => {
    const d = dependencies()
    const response = await handleResetChildPassword(request(), d)
    expect(d.authorize).toHaveBeenCalledWith('guardian-jwt', rosterId)
    expect(d.reset).toHaveBeenCalledWith(authId, body.password)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: 'password_updated' })
  })
  it('refuses another, unconfirmed, unlinked or withdrawn guardian before changing Auth', async () => {
    const d = dependencies()
    vi.mocked(d.authorize).mockRejectedValue(new Error('private SQL context'))
    const response = await handleResetChildPassword(request(), d)
    expect(response.status).toBe(403)
    expect(d.reset).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('private')
  })
  it('refuses a malformed SQL target rather than passing it to Auth', async () => {
    const d = dependencies()
    vi.mocked(d.authorize).mockResolvedValue('not-an-id')
    expect((await handleResetChildPassword(request(), d)).status).toBe(403)
    expect(d.reset).not.toHaveBeenCalled()
  })
  it('never exposes a provider error, technical address or password', async () => {
    const d = dependencies()
    vi.mocked(d.reset).mockRejectedValue(new Error('striker7@child.trakfootball.com Synthetic-Pass9!'))
    const response = await handleResetChildPassword(request(), d)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Could not set the password. Please try again.' })
  })
  it.each([
    { ...body, auth_user_id: authId }, { ...body, parent_user_id: authId },
    { ...body, password: 'weak' }, { ...body, roster_child_id: 'not-an-id' },
  ])('rejects invalid or injected input before any SQL/Auth operation', async value => {
    const d = dependencies()
    expect((await handleResetChildPassword(request(value), d)).status).toBe(400)
    expect(d.authorize).not.toHaveBeenCalled()
    expect(d.reset).not.toHaveBeenCalled()
  })
  it('requires a guardian JWT', async () => {
    const d = dependencies()
    expect((await handleResetChildPassword(request(body, ''), d)).status).toBe(401)
    expect(d.authorize).not.toHaveBeenCalled()
  })
})

// TRAK-104: Auth's admin password update leaves the child's existing sessions
// alive, so a lost or shared phone stayed signed in. The reset now ends every
// session of the child login, and says so plainly when that part fails.
describe('a password reset signs the child out of every device (TRAK-104)', () => {
  it('ends the child login\'s sessions after the password is changed, and only then reports success', async () => {
    const d = dependencies()
    const calls: string[] = []
    vi.mocked(d.reset).mockImplementation(async () => { calls.push('reset') })
    vi.mocked(d.endSessions).mockImplementation(async () => { calls.push('end'); return 2 })
    const response = await handleResetChildPassword(request(), d)
    expect(d.endSessions).toHaveBeenCalledWith(authId)
    expect(calls).toEqual(['reset', 'end'])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: 'password_updated' })
  })

  it('says the password changed but the sign-out failed, never a plain success', async () => {
    const d = dependencies()
    vi.mocked(d.endSessions).mockRejectedValue(new Error('striker7@child.trakfootball.com private detail'))
    const response = await handleResetChildPassword(request(), d)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ state: 'password_updated_signout_failed' })
    expect(text).not.toContain('private')
  })

  it('ends no session when the password itself could not be changed', async () => {
    const d = dependencies()
    vi.mocked(d.reset).mockRejectedValue(new Error('Auth unavailable'))
    expect((await handleResetChildPassword(request(), d)).status).toBe(503)
    expect(d.endSessions).not.toHaveBeenCalled()
  })

  it('ends no session for a refused guardian', async () => {
    const d = dependencies()
    vi.mocked(d.authorize).mockRejectedValue(new Error('withdrawn'))
    expect((await handleResetChildPassword(request(), d)).status).toBe(403)
    expect(d.endSessions).not.toHaveBeenCalled()
  })
})
