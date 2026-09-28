import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
// @ts-expect-error: plain .mjs script, no types
import { rows, toCsv, COACHES, insideRepo } from '../../scripts/rehearsal/make-roster.mjs'
import { parseCsv } from '../../scripts/load-roster.mjs'

const REPO_ROOT = resolve(__dirname, '../..')
const TODAY = new Date('2026-09-27T00:00:00Z')
const PILOT_END = new Date('2026-11-29T00:00:00Z')
const ageOn = (dob: string, day: Date) => {
  const b = new Date(`${dob}T00:00:00Z`)
  let a = day.getUTCFullYear() - b.getUTCFullYear()
  if (day.getUTCMonth() < b.getUTCMonth() || (day.getUTCMonth() === b.getUTCMonth() && day.getUTCDate() < b.getUTCDate())) a--
  return a
}

describe('TRAK-24 rehearsal roster', () => {
  const list = rows('tester@example.com', TODAY)

  it('has 25 children: 3 phone children at the tester inbox, 22 at the synthetic domain', () => {
    expect(list).toHaveLength(25)
    expect(list.filter((r: { child_email: string }) => r.child_email.endsWith('@example.com'))).toHaveLength(3)
    expect(list.filter((r: { child_email: string }) => r.child_email.endsWith('@rehearsal.trakfootball.com'))).toHaveLength(22)
  })

  it('keeps every child under 18 and over 12 for the whole pilot, so every one needs consent', () => {
    for (const r of list) {
      expect(ageOn(r.date_of_birth, TODAY), r.child_name).toBeGreaterThanOrEqual(13)
      expect(ageOn(r.date_of_birth, PILOT_END), r.child_name).toBeLessThan(18)
    }
  })

  it('gives the two siblings one guardian, and the withheld child a different one', () => {
    const [sib1, sib2, withheld] = list
    expect(sib1.guardian_emails).toBe(sib2.guardian_emails)
    expect(withheld.guardian_emails).not.toBe(sib1.guardian_emails)
    expect(new Set(list.map((r: { child_email: string }) => r.child_email)).size).toBe(25)
  })

  it('assigns each age group to its rehearsal coach', () => {
    for (const r of list) expect(r.coach_email).toBe(COACHES[r.age_group as 'U15' | 'U17'])
  })

  it('writes a CSV the loader parses back to the same 25 rows', () => {
    const parsed = parseCsv(toCsv(list))
    expect(parsed[0]).toEqual(['child_name', 'date_of_birth', 'age_group', 'child_email', 'guardian_emails', 'coach_email'])
    expect(parsed).toHaveLength(26)
  })

  it('refuses an inbox that already carries a +tag', () => {
    expect(() => rows('tester+x@example.com', TODAY)).toThrow(/plain address/)
  })

  // Kostas's #169 review: the guard compared against the folder the script
  // was run from, so `cd scripts && … --out ../x.csv` wrote real inboxes into
  // the public repository.
  it('treats any path under the repository root as inside, wherever it is run from', () => {
    expect(insideRepo(resolve(REPO_ROOT, 'x.csv'), REPO_ROOT)).toBe(true)
    expect(insideRepo(resolve(REPO_ROOT, 'scripts', '..', 'x.csv'), REPO_ROOT)).toBe(true)
    expect(insideRepo(resolve(REPO_ROOT, '..data', 'x.csv'), REPO_ROOT)).toBe(true)
    expect(insideRepo(resolve(REPO_ROOT, '..', 'outside.csv'), REPO_ROOT)).toBe(false)
  })

  it('refuses --out ../x.csv when run from scripts/, and writes nothing', () => {
    const target = resolve(REPO_ROOT, 'leak-test.csv')
    rmSync(target, { force: true })
    const run = spawnSync(process.execPath, ['rehearsal/make-roster.mjs', '--inbox', 'tester@example.com', '--out', '../leak-test.csv'],
      { cwd: resolve(REPO_ROOT, 'scripts'), encoding: 'utf8' })
    const leaked = existsSync(target)
    rmSync(target, { force: true })
    expect(run.status).toBe(1)
    expect(run.stderr).toMatch(/outside the repository/)
    expect(leaked).toBe(false)
  })
})
