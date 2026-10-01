import { describe, expect, it } from 'vitest'
import { describeTarget, parseArgs, report } from '../../scripts/correct-roster-email.mjs'

// TRAK-16 (G5) / TRAK-11 (J3): the operator's side of correct_roster_email().
// The database enforces the rules; the script refuses bad input before it
// connects, and never prints an address.

const ID = '98b00000-0000-0000-0000-000000000070'
const base = ['--roster-child', ID, '--kind', 'guardian', '--old', 'old@x.test', '--new', 'new@x.test',
  '--by', 'Kostas', '--reason', 'academy typo']

describe('parseArgs', () => {
  it('reads a correction and is a dry run unless --apply', () => {
    expect(parseArgs(base)).toEqual({ rosterChild: ID, kind: 'guardian', old: 'old@x.test', new: 'new@x.test',
      by: 'Kostas', reason: 'academy typo', apply: false })
    expect(parseArgs([...base, '--apply']).apply).toBe(true)
  })

  it.each([
    [['--roster-child', 'not-a-uuid'], 'roster-child'],
    [['--kind', 'coach'], 'kind'],
    [['--new', 'not an address'], 'new'],
    [['--new', ' OLD@x.test'], 'same'],
    [['--by', ' '], 'by'],
    [['--reason', ''], 'reason'],
  ])('refuses %j before connecting', (override, word) => {
    const args = [...base]
    for (let i = 0; i < override.length; i += 2) args[args.indexOf(override[i]) + 1] = override[i + 1]
    expect(() => parseArgs(args)).toThrow(new RegExp(word, 'i'))
  })

  it('refuses an unknown flag', () => {
    expect(() => parseArgs([...base, '--send'])).toThrow(/Unknown argument/)
  })
})

describe('describeTarget (the dry run)', () => {
  const row = {
    child_email: 'kid@x.test', player_user_id: null, invited_at: null,
    roster_guardians: [
      { email: 'old@x.test', parent_user_id: null, invited_at: '2026-10-01T09:00:00Z' },
      { email: 'claimed@x.test', parent_user_id: 'u1', invited_at: null },
    ],
  }

  it('finds the guardian address and says an invitation already went', () => {
    expect(describeTarget(row, 'guardian', ' OLD@x.test')).toEqual({ status: 'ready', wasInvited: true })
  })
  it('says when the address has been claimed, or is not there', () => {
    expect(describeTarget(row, 'guardian', 'claimed@x.test').status).toBe('already_claimed')
    expect(describeTarget(row, 'guardian', 'nobody@x.test').status).toBe('not_on_roster')
    expect(describeTarget(null, 'guardian', 'old@x.test').status).toBe('not_on_roster')
  })
  it('handles the child address, a signed-up child and a child with no email', () => {
    expect(describeTarget(row, 'child', 'kid@x.test')).toEqual({ status: 'ready', wasInvited: false })
    expect(describeTarget({ ...row, player_user_id: 'u2' }, 'child', 'kid@x.test').status).toBe('already_claimed')
    expect(describeTarget({ ...row, child_email: null }, 'child', 'kid@x.test').status).toBe('no_child_email')
  })
})

describe('report', () => {
  it('never prints an address, and says what to do next', () => {
    const lines = [
      ...report({ apply: false, rosterChild: ID, kind: 'guardian', status: 'ready', wasInvited: true }),
      ...report({ apply: true, rosterChild: ID, kind: 'guardian', status: 'ready', wasInvited: true, auditId: 'a1' }),
      ...report({ apply: false, rosterChild: ID, kind: 'child', status: 'already_claimed', wasInvited: false }),
    ]
    expect(lines.join('\n')).not.toMatch(/@/)
    expect(lines.join('\n')).toMatch(/--apply/)
    expect(lines.join('\n')).toMatch(/re-invite/i)
    expect(lines.join('\n')).toMatch(/G5 near-miss/)
    expect(lines.join('\n')).toMatch(/incident/i)
  })
})
