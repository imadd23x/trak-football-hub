import { describe, expect, it } from 'vitest'
import { parseCsv, validateRoster } from '../../scripts/load-roster.mjs'

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
})
