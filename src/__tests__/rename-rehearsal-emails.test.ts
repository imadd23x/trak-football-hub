import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs script without type declarations
import { renamed } from '../../scripts/rename-rehearsal-emails.mjs'

// TRAK-89: only rehearsal accounts move, and each keeps its name.
describe('rename-rehearsal-emails', () => {
  it('moves a rehearsal address to our domain, keeping the name', () => {
    expect(renamed('coach.u15@rehearsal.trak.dev')).toBe('coach.u15@rehearsal.trakfootball.com')
    expect(renamed(' Parent.Kostas.Savvas@Rehearsal.Trak.Dev ')).toBe('parent.kostas.savvas@rehearsal.trakfootball.com')
  })

  it('leaves every other account alone', () => {
    for (const email of ['tester@yopmail.com', 'coach@trak.dev', 'x@notrehearsal.trak.dev',
      'x@rehearsal.trak.dev.evil.com', '@rehearsal.trak.dev', 'a@rehearsal.trakfootball.com', null, undefined]) {
      expect(renamed(email)).toBeNull()
    }
  })
})
