import { describe, expect, it, vi } from 'vitest'
import { handleResetChildPassword, type ChildPasswordDependencies } from '../../supabase/functions/reset-child-password/handler'

const rosterId = '98c00000-0000-4000-8000-000000000030'
const authId = '98c00000-0000-4000-8000-000000000040'
const body = { roster_child_id: rosterId, password: 'Synthetic-Pass9!' }
const request = (value: unknown = body, token = 'guardian-jwt') => new Request('http://localhost/reset-child-password', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value),
})
function dependencies(): ChildPasswordDependencies {
  return { authorize: vi.fn().mockResolvedValue(authId), reset: vi.fn().mockResolvedValue(undefined) }
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
