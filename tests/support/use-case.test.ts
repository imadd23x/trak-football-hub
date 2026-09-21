import { describe, it, expect } from 'vitest'
import { useCase } from './use-case'
import { getUseCase } from './registry'

/**
 * The id this file binds to in order to prove useCase() works at all.
 *
 * It used to be UC-A02. Parking UC-A02 made useCase() skip the suite below —
 * correct behaviour for a parked use case, and it silently removed the only
 * test of the binding itself. Nothing failed; the count just went down by one.
 *
 * So the fixture moved to an enforced core journey, and BINDING_FIXTURE_LIVE
 * below turns a future repeat into a failure instead of a skip.
 */
const BINDING_FIXTURE = 'UC-C04'

describe('useCase binding', () => {
  it('throws on an unknown use-case id', () => {
    expect(() => useCase('UC-Z99', () => {})).toThrow(/UC-Z99/)
  })

  // A parked use case is skipped by useCase(), so if the fixture below is ever
  // parked the suite disappears without a failure. This assertion lives
  // OUTSIDE useCase() precisely so it still runs when that happens.
  it('binds to a use case that is not parked, or the suite below would vanish', () => {
    expect(getUseCase(BINDING_FIXTURE).status).not.toBe('parked')
  })
})

useCase(BINDING_FIXTURE, () => {
  it('names the suite after the bound use case\'s id and title', () => {
    // useCase() builds the describe() title as `${uc.id} · ${uc.title}` —
    // assert that binding actually happened, rather than a tautology that
    // would pass whether or not useCase() ran at all.
    const suite = expect.getState().currentTestName
    expect(suite).toMatch(new RegExp(`^${BINDING_FIXTURE} · `))
    expect(suite).toContain(getUseCase(BINDING_FIXTURE).title)
  })
})
