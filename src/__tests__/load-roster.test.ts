import { describe, expect, it, vi } from 'vitest'
import { loadRows, parseArgs, parseCsv, planLoad, validateRoster } from '../../scripts/load-roster.mjs'

// TRAK-49 [J1]: the concierge roster file is checked before anything is
// written. Synthetic addresses only.
const HEADER = 'child_name,date_of_birth,age_group,child_email,guardian_emails,coach_email'
const TODAY = { today: '2026-09-24' }
const file = (...lines: string[]) => [HEADER, ...lines].join('\n')

describe('load-roster validation', () => {
  it('accepts a clean roster, normalizing emails and splitting guardians', () => {
    const { rows, errors } = validateRoster(file(
      'Sib One,2011-03-04,U15, Kid1@Roster.test ,g1@roster.test; G2@roster.test ;g1@roster.test,coach@roster.test',
      '"Sib, Two",2013-07-08,U13,kid2@roster.test,g1@roster.test,coach@roster.test',
    ), TODAY)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ line: 2, child_email: 'kid1@roster.test', guardian_emails: ['g1@roster.test', 'g2@roster.test'] })
    expect(rows[1].child_name).toBe('Sib, Two')
  })

  it('refuses a missing column', () => {
    const { errors } = validateRoster('child_name,date_of_birth\nA,2011-01-01', TODAY)
    expect(errors[0]).toMatch(/Missing column\(s\): age_group, child_email, guardian_emails, coach_email/)
  })

  it('refuses impossible and out-of-range dates of birth', () => {
    const { rows, errors } = validateRoster(file(
      'A,2011-02-31,U15,a@roster.test,g@roster.test,c@roster.test',
      'B,2027-01-01,U15,b@roster.test,g@roster.test,c@roster.test',
      'C,,U15,c1@roster.test,g@roster.test,c@roster.test',
    ), TODAY)
    expect(rows).toEqual([])
    expect(errors).toEqual([
      'Line 2: date_of_birth is not a real YYYY-MM-DD date',
      'Line 3: date_of_birth is out of range',
      'Line 4: date_of_birth is not a real YYYY-MM-DD date',
    ])
  })

  it('refuses a child with no guardian, or listed as their own guardian (G2/G5)', () => {
    const { errors } = validateRoster(file(
      'A,2011-01-01,U15,a@roster.test,,c@roster.test',
      'B,2011-01-01,U15,b@roster.test,B@roster.test,c@roster.test',
    ), TODAY)
    expect(errors).toEqual([
      'Line 2: no guardian email',
      "Line 3: the child's email is also listed as a guardian's",
    ])
  })

  it('refuses a duplicate child and a guardian who is another row\'s child', () => {
    const { errors } = validateRoster(file(
      'A,2011-01-01,U15,a@roster.test,g@roster.test,c@roster.test',
      'A again,2011-01-01,U15,A@roster.test,g@roster.test,c@roster.test',
      'B,2012-01-01,U13,b@roster.test,a@roster.test,c@roster.test',
    ), TODAY)
    expect(errors).toEqual([
      'Line 3: same child_email as line 2',
      'Line 4: a guardian email is the child_email on line 2',
    ])
  })

  it('never puts names, emails or dates of birth in its messages', () => {
    const { errors } = validateRoster(file(
      'Secret Name,2011-02-31,U15,secret@roster.test,secret@roster.test,not-an-email',
    ), TODAY)
    expect(errors).toHaveLength(1)
    expect(errors[0]).not.toMatch(/Secret|secret@|2011/)
  })

  it('parses quoted fields, doubled quotes and CRLF', () => {
    expect(parseCsv('a,"b ""x"", c"\r\nd,e\r\n')).toEqual([['a', 'b "x", c'], ['d', 'e']])
  })

  it('resumes a stopped load: skips children already in this academy, refuses ones in another', () => {
    const { rows } = validateRoster(file(
      'A,2011-01-01,U15,a@roster.test,g@roster.test,c@roster.test',
      'B,2011-01-01,U15,b@roster.test,g@roster.test,c@roster.test',
      'C,2011-01-01,U15,c1@roster.test,g@roster.test,c@roster.test',
    ), TODAY)
    const org = 'org-a'
    expect(planLoad(rows, [{ child_email: 'A@Roster.test', organization_id: org }], org)).toMatchObject({
      skipped: [2], conflicts: [], toLoad: [{ line: 3 }, { line: 4 }],
    })
    expect(planLoad(rows, [{ child_email: 'b@roster.test', organization_id: 'org-b' }], org)).toMatchObject({
      skipped: [], conflicts: [3],
    })
    expect(planLoad(rows, [], org).toLoad).toHaveLength(3)
  })
})

// TRAK-11 phase 3: after each admission the loader asks send-roster-invites to
// invite that child's guardians. A skipped row is never invited, a failed send
// never undoes or stops an admission, and --no-invites (invite = null) sends
// nothing.
// TRAK-84: a child without an email; the guardian creates their login later.
describe('load-roster children without email', () => {
  it('accepts a blank child email as none, still checking everything else', () => {
    const { rows, errors } = validateRoster(file(
      'Young One,2016-02-03,U11,,g1@roster.test,coach@roster.test',
      'Young Two,2016-04-05,U11,  ,g1@roster.test,coach@roster.test',
    ), TODAY)
    expect(errors).toEqual([])
    expect(rows.map(r => r.child_email)).toEqual([null, null])
  })

  it('refuses the same email-less child twice in one file (name and date of birth)', () => {
    const { errors } = validateRoster(file(
      'Young One,2016-02-03,U11,,g1@roster.test,coach@roster.test',
      ' young one ,2016-02-03,U11,,g2@roster.test,coach@roster.test',
    ), TODAY)
    expect(errors).toEqual(['Line 3: same child (name and date of birth, no email) as line 2'])
  })

  it('always tries an email-less child, and a re-run skips one the academy already has', async () => {
    const rows = validateRoster(file(
      'Young One,2016-02-03,U11,,g1@roster.test,coach@roster.test',
      'Young Two,2016-04-05,U11,,g2@roster.test,coach@roster.test',
    ), TODAY).rows
    const { toLoad } = planLoad(rows, [], 'org')
    expect(toLoad).toHaveLength(2)
    const admit = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: "This child is already on the academy's roster" } })
      .mockResolvedValueOnce({ data: 'roster-3', error: null })
    const out = await loadRows(toLoad, { admit, invite: null }, () => {})
    expect(out).toMatchObject({ loaded: 1, alreadyOnRoster: [2] })
    expect(out.stoppedAt).toBeUndefined()
  })
})

describe('load-roster invitations', () => {
  const rows = validateRoster(file(
    'One Kid,2013-03-04,U13,kid1@roster.test,g1@roster.test,coach@roster.test',
    'Two Kid,2013-05-06,U13,kid2@roster.test,g2@roster.test,coach@roster.test',
    'Three Kid,2013-07-08,U13,kid3@roster.test,g3@roster.test,coach@roster.test',
  ), TODAY).rows
  const admitted: Parameters<typeof loadRows>[1]['admit'] = (r) => Promise.resolve({ data: `roster-${r.line}`, error: null })

  it('invites once per admitted child, never for a row skipped as already admitted', async () => {
    const { toLoad } = planLoad(rows, [{ child_email: 'kid2@roster.test', organization_id: 'org' }], 'org')
    const invite = vi.fn().mockResolvedValue(true)
    const out = await loadRows(toLoad, { admit: vi.fn(admitted), invite }, () => {})
    expect(invite.mock.calls).toEqual([['roster-2'], ['roster-4']])
    expect(out).toMatchObject({ loaded: 2, invited: 2, inviteFailed: [] })
  })

  it('sends nothing with --no-invites', async () => {
    const out = await loadRows(rows, { admit: vi.fn(admitted), invite: null }, () => {})
    expect(out).toMatchObject({ loaded: 3, invited: 0, inviteFailed: [] })
  })

  it('keeps loading after a failed send, and names the line without an address', async () => {
    const admit = vi.fn(admitted)
    const invite = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('offline g3@roster.test'))
    const log: string[] = []
    const out = await loadRows(rows, { admit, invite }, (m: string) => log.push(m))
    expect(admit).toHaveBeenCalledTimes(3)
    expect(out).toMatchObject({ loaded: 3, invited: 1, inviteFailed: [3, 4] })
    expect(log.join('\n')).toMatch(/line 3/i)
    expect(log.join('\n')).not.toMatch(/@/)
  })

  it('stops at a refused admission and invites nobody for that line', async () => {
    const admit = vi.fn(admitted).mockResolvedValueOnce({ data: 'roster-2', error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'refused' } })
    const invite = vi.fn().mockResolvedValue(true)
    const out = await loadRows(rows, { admit, invite }, () => {})
    expect(invite.mock.calls).toEqual([['roster-2']])
    expect(out).toMatchObject({ loaded: 1, invited: 1, stoppedAt: 3 })
  })
})

// Until phase 4's landing pages exist, an invitation link lands on a page that
// can't finish signup, so the loader sends nothing unless asked (Tarek, #178).
describe('load-roster invitation switch', () => {
  const base = ['--file', 'r.csv', '--org', 'org', '--loaded-by', 'op', '--apply']
  it('sends no invitations unless --send-invites is given', () => {
    expect(parseArgs(base)['send-invites']).toBe(false)
    expect(parseArgs([...base, '--no-invites'])['send-invites']).toBe(false)
    expect(parseArgs([...base, '--send-invites'])['send-invites']).toBe(true)
  })
  it('refuses both switches at once', () => {
    expect(() => parseArgs([...base, '--send-invites', '--no-invites'])).toThrow(/either/)
  })
})
