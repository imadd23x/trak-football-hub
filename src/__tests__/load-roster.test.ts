import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { reinviteExitCode, describeInviteFailure, inviteRequest, loadRows, operatorKey, parseArgs, parseCsv, pendingGuardianNote, planLoad, planReinvite, reinviteRows, syntheticInviteLines, validateRoster } from '../../scripts/load-roster.mjs'
import { handleRosterInviteRequest } from '../../supabase/functions/send-roster-invites/handler'

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

// TRAK-91 (Kostas's #178 review): a failed or interrupted invitation left the
// family uninvited for good, because a re-run skips admitted children.
// --reinvite runs the same file again, admits nothing, and re-sends only where
// a guardian has neither been invited nor signed up.
describe('load-roster --reinvite', () => {
  const rows = validateRoster(file(
    'One Kid,2013-03-04,U13,kid1@roster.test,g1@roster.test,coach@roster.test',
    'Two Kid,2013-05-06,U13,kid2@roster.test,g2@roster.test;g2b@roster.test,coach@roster.test',
    'Three Kid,2013-07-08,U13,kid3@roster.test,g3@roster.test,coach@roster.test',
    'Four Kid,2013-09-10,U13,kid4@roster.test,g4@roster.test,coach@roster.test',
    'Young One,2016-02-03,U11,,g5@roster.test,coach@roster.test',
  ), TODAY).rows
  const guardian = (invited_at: string | null, parent_user_id: string | null = null) => ({ invited_at, parent_user_id })
  const onRoster = [
    // Line 2: its invitation failed, so nobody was ever invited.
    { id: 'roster-2', child_email: 'kid1@roster.test', date_of_birth: '2013-03-04', player_name: 'One Kid', guardians: [guardian(null)] },
    // Line 3: one guardian invited, the second never was.
    { id: 'roster-3', child_email: 'kid2@roster.test', date_of_birth: '2013-05-06', player_name: 'Two Kid', guardians: [guardian('2026-09-28T10:00:00Z'), guardian(null)] },
    // Line 4: invited. Line 5 is not on the roster at all.
    { id: 'roster-4', child_email: 'kid3@roster.test', date_of_birth: '2013-07-08', player_name: 'Three Kid', guardians: [guardian('2026-09-28T10:00:00Z')] },
    // Line 6: an email-less child, found by name and date of birth.
    { id: 'roster-6', child_email: null, date_of_birth: '2016-02-03', player_name: ' young one ', guardians: [guardian(null)] },
  ]

  it('re-invites only children with a guardian never invited and not signed up', () => {
    const plan = planReinvite(rows, onRoster)
    expect(plan.toInvite).toEqual([
      { line: 2, rosterChildId: 'roster-2' },
      { line: 3, rosterChildId: 'roster-3' },
      { line: 6, rosterChildId: 'roster-6' },
    ])
    expect(plan.upToDate).toEqual([4])
    expect(plan.notOnRoster).toEqual([5])
  })

  it('leaves a family alone once the guardian has signed up, even if never invited', () => {
    const signedUp = [{ ...onRoster[0], guardians: [guardian(null, 'parent-1')] }]
    expect(planReinvite(rows.slice(0, 1), signedUp)).toMatchObject({ toInvite: [], upToDate: [2] })
  })

  it('never matches an email-less child on name alone', () => {
    const otherBirthday = [{ ...onRoster[3], date_of_birth: '2016-02-04' }]
    expect(planReinvite(rows.slice(4), otherBirthday)).toMatchObject({ toInvite: [], notOnRoster: [6] })
  })

  it('sends each re-invitation, reporting failures by line and carrying on', async () => {
    const invite = vi.fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(false)
    const log = vi.fn()
    const out = await reinviteRows([
      { line: 2, rosterChildId: 'roster-2' },
      { line: 3, rosterChildId: 'roster-3' },
      { line: 6, rosterChildId: 'roster-6' },
    ], invite, log)
    expect(invite.mock.calls.map(c => c[0])).toEqual(['roster-2', 'roster-3', 'roster-6'])
    expect(out).toEqual({ invited: 1, failed: [3, 6] })
    expect(log.mock.calls.flat().join(' ')).not.toMatch(/@|Kid|Young/)
  })

  it('stands alone: it sends by itself, so it refuses --send-invites and --no-invites', () => {
    const base = ['--file', 'r.csv', '--org', 'org', '--loaded-by', 'op', '--reinvite']
    expect(parseArgs(base).reinvite).toBe(true)
    expect(parseArgs(['--file', 'r.csv']).reinvite).toBe(false)
    expect(() => parseArgs([...base, '--send-invites'])).toThrow(/--reinvite/)
    expect(() => parseArgs([...base, '--no-invites'])).toThrow(/--reinvite/)
  })
})

// TRAK-91 follow-up: a reserved test address (.test, example.com …, the J7
// rule) can't receive mail. Inviting one is an operator mistake (loading the
// synthetic TRAK-24 file with --send-invites, or --reinvite on it): 22
// undeliverable sends just before the real invitations. The command refuses
// before anything is loaded or sent, dry run included.
describe('load-roster never invites a reserved test address', () => {
  const LOADER = resolve(__dirname, '../../scripts/load-roster.mjs')
  const ORG = 'fe06597a-e57f-448d-81ed-b0c4d12cf7a0'
  const synthetic = file(
    'Synthetic One,2012-01-10,U15,roster.01@rehearsal.trak.test,parent.roster.01@rehearsal.trak.test,coach.u15@rehearsal.trak.test',
    'Synthetic Two,2012-02-10,U15,roster.02@rehearsal.trak.test,parent.roster.02@rehearsal.trak.test,coach.u15@rehearsal.trak.test',
  )
  const run = (csv: string, ...flags: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'trak-loader-'))
    try {
      const path = join(dir, 'roster.csv')
      writeFileSync(path, csv)
      return spawnSync(process.execPath, [LOADER, '--file', path, '--org', ORG, '--loaded-by', 'test', ...flags],
        { encoding: 'utf8', env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }

  it('finds every line that holds a reserved test address, child or guardian', () => {
    const { rows } = validateRoster(file(
      'Real Kid,2012-01-10,U15,kid@gmail.com,parent@gmail.com,coach@club.com',
      'Test Guardian,2012-01-11,U15,kid2@gmail.com,parent@example.com,coach@club.com',
      'Test Child,2012-01-12,U15,kid3@squad.test,parent3@gmail.com,coach@club.com',
      'Mixed,2012-01-13,U15,kid4@gmail.com,parent4@gmail.com;other@x.invalid,coach@club.com',
    ), TODAY)
    expect(syntheticInviteLines(rows)).toEqual([3, 4, 5])
  })

  it('refuses --send-invites for a file with synthetic addresses, even in a dry run, and loads nothing', () => {
    const out = run(synthetic, '--send-invites')
    expect(out.status).toBe(1)
    expect(out.stdout).toMatch(/Line\(s\) 2, 3 use a reserved test address/)
    expect(out.stdout).toMatch(/Nothing loaded or sent/)
    expect(out.stdout).not.toMatch(/Dry run\. Re-run with --apply/)
  })

  it('refuses --reinvite on it too, before it needs a key', () => {
    const out = run(synthetic, '--reinvite')
    expect(out.status).toBe(1)
    expect(out.stdout).toMatch(/reserved test address/)
    expect(out.stderr).not.toMatch(/SUPABASE_URL/)
  })

  it('CONTROL the same file loads (dry run) without invitations', () => {
    const out = run(synthetic)
    expect(out.status).toBe(0)
    expect(out.stdout).toMatch(/Nobody will be emailed/)
  })
})

// Imad's P2 on #202: --reinvite posts only roster_child_id, and
// send-roster-invites emails the guardians *stored* on the roster (every one
// who hasn't signed up). A file corrected since the load passes the CSV guard,
// so the stored addresses must be checked too.
describe('load-roster --reinvite checks the stored guardian addresses', () => {
  const { rows } = validateRoster(file('Real Kid,2012-01-10,U15,kid@gmail.com,parent@gmail.com,coach@club.com'), TODAY)
  const child = (guardians: { email: string; invited_at: string | null; parent_user_id: string | null }[]) =>
    [{ id: 'rc-1', child_email: 'kid@gmail.com', date_of_birth: '2012-01-10', player_name: 'Real Kid', guardians }]

  it('refuses a line whose stored guardian is on a reserved test domain, though the file now has a real one', () => {
    const plan = planReinvite(rows, child([{ email: 'parent@rehearsal.trak.test', invited_at: null, parent_user_id: null }]))
    expect(plan.toInvite).toEqual([])
    expect(plan.synthetic).toEqual([2])
  })

  it('refuses it too when that stored guardian was invited before: the function would email them again', () => {
    const plan = planReinvite(rows, child([
      { email: 'real@gmail.com', invited_at: null, parent_user_id: null },
      { email: 'parent@rehearsal.trak.test', invited_at: '2026-09-28T16:13:00Z', parent_user_id: null },
    ]))
    expect(plan.toInvite).toEqual([])
    expect(plan.synthetic).toEqual([2])
  })

  it('CONTROL a signed-up guardian on a reserved domain is not a recipient, so a real one still gets re-invited', () => {
    const plan = planReinvite(rows, child([
      { email: 'parent@rehearsal.trak.test', invited_at: null, parent_user_id: 'parent-1' },
      { email: 'real@gmail.com', invited_at: null, parent_user_id: null },
    ]))
    expect(plan.toInvite).toEqual([{ line: 2, rosterChildId: 'rc-1' }])
    expect(plan.synthetic).toEqual([])
  })
})

// TRAK-9 (30 Sep TRAK-24 run): the invitations were refused because the loader
// sent the legacy service_role JWT on Authorization. It now uses a secret key
// (sb_secret_…), sent on apikey only, and says why an invitation failed.
describe('load-roster authenticates with a secret key', () => {
  it('reads the secret key from SUPABASE_SECRET_KEY', () => {
    expect(operatorKey({ SUPABASE_SECRET_KEY: ' sb_secret_abc ' })).toBe('sb_secret_abc')
  })

  it.each([
    ['missing', {}],
    ['the legacy service_role JWT', { SUPABASE_SECRET_KEY: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig' }],
    ['a publishable key', { SUPABASE_SECRET_KEY: 'sb_publishable_abc' }],
    ['only the old variable', { SUPABASE_SERVICE_ROLE_KEY: 'eyJ.legacy.key' }],
  ])('refuses a key that is %s, before anything is loaded', (_what, env) => {
    expect(() => operatorKey(env as Record<string, string>)).toThrow(/SUPABASE_SECRET_KEY.*sb_secret_/)
  })

  it('sends the key on apikey only, never as a Bearer token', () => {
    const { url, init } = inviteRequest('https://project.example.test/', 'sb_secret_abc', 'rc-1')
    expect(url).toBe('https://project.example.test/functions/v1/send-roster-invites')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ apikey: 'sb_secret_abc', 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ roster_child_id: 'rc-1' })
  })

  it('says why an invitation failed, with the status and reason only', () => {
    expect(describeInviteFailure(401, { sent: 0, error: 'Not authenticated' })).toBe('HTTP 401, Not authenticated')
    expect(describeInviteFailure(403, { sent: 0, reason: 'consent_required' })).toBe('HTTP 403, consent_required')
    expect(describeInviteFailure(502, { sent: 1, failed: 1, results: [{ kind: 'guardian', sent: false, reason: 'delivery_failed' }] }))
      .toBe('HTTP 502, 1 delivery failed')
    expect(describeInviteFailure(500, null)).toBe('HTTP 500')
  })
})

// TRAK-91 (Imad, 30 Sep / 1 Oct): a family with one invited and one never-
// invited guardian. Before the fix, --reinvite picked the child and the
// function emailed BOTH unsigned guardians. Planner → request → real handler,
// with targets that follow roster_invite_targets()'s SQL predicate.
describe('load-roster --reinvite end to end (mixed family)', () => {
  // Not .test addresses: --reinvite refuses a stored reserved address (#202).
  const guardians = [
    { email: 'g2@club.com', invited_at: '2026-09-28T10:00:00Z', parent_user_id: null },
    { email: 'g2b@club.com', invited_at: null, parent_user_id: null },
  ]
  const rows = validateRoster(file('Two Kid,2013-05-06,U13,kid2@club.com,g2@club.com;g2b@club.com,coach@club.com'), TODAY).rows
  const onRoster = [{ id: '98a00000-0000-0000-0000-000000000073', child_email: 'kid2@club.com', date_of_birth: '2013-05-06', player_name: 'Two Kid', guardians }]

  async function run(onlyUninvited: boolean) {
    const delivered: string[] = []
    const deps = {
      siteUrl: 'https://trakfootball.test', secretKeys: ['sb_secret_op'],
      getCaller: vi.fn(),
      // The SQL: every guardian not signed up; with only_uninvited, never invited too.
      getTargets: vi.fn(async (_id: string, _guardian: string | null, only: boolean) => ({ error: null,
        data: guardians.filter(g => !g.parent_user_id && (!only || !g.invited_at))
          .map(g => ({ kind: 'guardian' as const, email: g.email, first_name: 'Two', academy: 'Roster FC' })) })),
      markSent: vi.fn(async () => ({ error: null })),
      sendInvite: vi.fn(async (email: string) => { delivered.push(email); return { error: null } }),
      sendMagicLink: vi.fn(async () => ({ error: null })),
      // TRAK-97: these two guardians have different addresses, so neither has a sibling's fresh invitation.
      recentGuardianInvite: vi.fn(async () => ({ data: false, error: null })),
    }
    const plan = planReinvite(rows, onRoster)
    const out = await reinviteRows(plan.toInvite, async (rosterChildId: string) => {
      const { url, init } = inviteRequest('https://p.example.test', 'sb_secret_op', rosterChildId, { onlyUninvited })
      const res = await handleRosterInviteRequest(new Request(url, init), deps)
      return res.ok && (await res.json()).failed === 0
    }, vi.fn())
    return { plan, out, delivered }
  }

  it('re-sends only to the guardian who was never invited', async () => {
    const { plan, out, delivered } = await run(true)
    expect(plan.toInvite).toHaveLength(1)
    expect(out).toEqual({ invited: 1, failed: [] })
    expect(delivered).toEqual(['g2b@club.com'])
  })

  it('CONTROL without only_uninvited the same call emails both (the bug)', async () => {
    expect((await run(false)).delivered).toEqual(['g2@club.com', 'g2b@club.com'])
  })

  it('the request carries only_uninvited only when asked', () => {
    expect(JSON.parse(inviteRequest('https://p.example.test', 'sb_secret_op', 'rc-1', { onlyUninvited: true }).init.body))
      .toEqual({ roster_child_id: 'rc-1', only_uninvited: true })
    expect(JSON.parse(inviteRequest('https://p.example.test', 'sb_secret_op', 'rc-1').init.body)).toEqual({ roster_child_id: 'rc-1' })
  })
})

// TRAK-97: a sibling's invitation that went to the guardian already isn't sent
// again; the operator is told so instead of seeing it counted silently.
describe('load-roster says when a guardian already had a fresh invitation (TRAK-97)', () => {
  it('names the case and needs no action', () => {
    expect(pendingGuardianNote({ sent: 0, failed: 0, results: [{ kind: 'guardian', sent: false, reason: 'guardian_invite_pending' }] }))
      .toBe("A guardian already had a fresh invitation for another child, so no second email went; their consent screen lists every child.")
  })
  it.each([
    ['an ordinary send', { sent: 1, failed: 0, results: [{ kind: 'guardian', sent: true, via: 'invite' }] }],
    ['a failure', { sent: 0, failed: 1, results: [{ kind: 'guardian', sent: false, reason: 'delivery_failed' }] }],
    ['no body', null],
  ])('says nothing for %s', (_what, body) => {
    expect(pendingGuardianNote(body)).toBeNull()
  })
})

// TRAK-91 (Imad's ship check of #202, 2 Oct): --reinvite printed a refused line
// but exited 0, so a wrapper script couldn't tell the run needed attention.
// A line it couldn't act on (a stored reserved address, or not on the roster)
// or a failed send now exits 1; "already invited" is not a problem.
describe('load-roster --reinvite exits non-zero when a line needs the operator (TRAK-91)', () => {
  const plan = (over: Partial<{ toInvite: { line: number; rosterChildId: string }[]; upToDate: number[]; notOnRoster: number[]; synthetic: number[] }>) =>
    ({ toInvite: [], upToDate: [], notOnRoster: [], synthetic: [], ...over })
  it.each([
    ['a stored reserved address was refused', plan({ synthetic: [3] }), 0, 1],
    ['a line is not on the roster', plan({ notOnRoster: [2] }), 0, 1],
    ['a re-invitation failed', plan({ toInvite: [{ line: 2, rosterChildId: 'rc-1' }] }), 1, 1],
    ['CONTROL every guardian already invited', plan({ upToDate: [2, 3] }), 0, 0],
    ['CONTROL everything re-sent', plan({ toInvite: [{ line: 2, rosterChildId: 'rc-1' }] }), 0, 0],
  ] as const)('%s', (_what, p, failedCount, expected) => {
    expect(reinviteExitCode(p, failedCount)).toBe(expected)
  })
})
