/**
 * TRAK-353 (Season plan 5/18): the panel's rules. Roles come grouped by the positions a player plays, then the coach's
 * own; Can also play is up to two of the other three; a new main position leaves Can also play. Synthetic roles.
 */
import { describe, expect, it } from 'vitest'
import { ROLES, ownRoles, pickMain, roleGroups, toggleAlso } from '@/lib/positions'

describe('TRAK-353 Can also play and roles', () => {
  it("keeps the mockup's presets for each position", () => {
    expect(ROLES).toEqual({
      Goalkeeper: ['Sweeper-keeper', 'Shot-stopper', 'Distributor'],
      Defender: ['Ball-playing centre back', 'Stopper', 'Covering centre back', 'Attacking full-back', 'Defensive full-back', 'Inverted full-back'],
      Midfielder: ['Controller', 'Box-to-box', 'Ball-winner', 'Wide midfielder'],
      Attacker: ['Winger', 'Inside forward', 'Runner', 'Target striker', 'False nine'],
    })
  })

  it('groups roles by the main position, then each Can also play, then the coach\'s own', () => {
    const groups = roleGroups('Defender', ['Midfielder'], ['Stopper', 'Win the second ball', 'Winger'], ['Press the keeper'])
    expect(groups.map(g => g.heading)).toEqual(['As a defender', 'As a midfielder', 'Yours'])
    expect(groups[0].roles).toEqual(ROLES.Defender)
    // A role they hold from somewhere else (Winger, from before a move) stays pickable under Yours.
    expect(groups[2].roles).toEqual(['Press the keeper', 'Win the second ball', 'Winger'])
    expect(roleGroups('Attacker', [], [], []).map(g => g.heading)).toEqual(['As an attacker'])
    expect(roleGroups(null, [], [], ['Press the keeper'])).toEqual([])
  })

  it("finds the coach's own roles among every role their players hold, each once", () => {
    expect(ownRoles(['Stopper', 'Win the second ball', 'Runner', 'Win the second ball', 'Press the keeper'])).toEqual(['Press the keeper', 'Win the second ball'])
  })

  it('takes up to two Can also play and refuses a third, never the main position', () => {
    expect(toggleAlso([], 'Midfielder', 'Defender')).toEqual({ also: ['Midfielder'], refused: false })
    expect(toggleAlso(['Midfielder'], 'Attacker', 'Defender')).toEqual({ also: ['Midfielder', 'Attacker'], refused: false })
    expect(toggleAlso(['Midfielder', 'Attacker'], 'Goalkeeper', 'Defender')).toEqual({ also: ['Midfielder', 'Attacker'], refused: true })
    expect(toggleAlso(['Midfielder', 'Attacker'], 'Attacker', 'Defender')).toEqual({ also: ['Midfielder'], refused: false })
    expect(toggleAlso([], 'Defender', 'Defender')).toEqual({ also: [], refused: true })
  })

  it('drops the new main position from Can also play', () => {
    expect(pickMain('Midfielder', ['Midfielder', 'Attacker'])).toEqual(['Attacker'])
    expect(pickMain('Goalkeeper', ['Midfielder'])).toEqual(['Midfielder'])
  })
})
