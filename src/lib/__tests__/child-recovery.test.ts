import { expect, it } from 'vitest'
import { parseChildCredentials } from '../child-recovery'

const row = { roster_child_id: '98c00000-0000-4000-8000-000000000030', first_name: 'Ana', username: 'striker7' }
it('keeps only the safe credential fields from a server response', () => {
  expect(parseChildCredentials([{ ...row, auth_user_id: 'private-id', email: 'striker7@child.trakfootball.com' }])).toEqual([row])
  expect(parseChildCredentials([])).toEqual([])
})
it.each([null, [null], [{ ...row, username: null }], [{ ...row, username: 'striker7@child.trakfootball.com' }], [row, row]])(
  'a missing or malformed credential reply is an error rather than empty success', data => {
    expect(() => parseChildCredentials(data)).toThrow()
  },
)
