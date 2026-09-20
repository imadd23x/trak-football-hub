import { describe, it, expect } from 'vitest'
import { BANDS, bandConfig, type BandType } from '@/lib/types'
import { scoreToBand, bandForScore } from '@/lib/rating-engine'
import { categoryScoreToBand } from '@/lib/matchDetailHelpers'
import { BAND_COLORS as CLUB_BAND_COLORS } from '@/lib/clubMock'
import { BAND_COLORS as MATCH_BAND_COLORS } from '@/lib/matchDetailHelpers'

// F-1. A score of 5 read "Mixed" in orange on the player's home screen and
// "Steady" in blue on their profile, because PlayerProfilePage carried its own
// ladder. Looking for the other copies found a fifth, in matchDetailHelpers,
// which disagreed below the midpoint and was live on match detail.
//
// These tests compare behaviour rather than grepping for hex strings. A grep
// was tried first and matched 52 files, because the band palette shares its
// colours with the brand accent — it would have been noise, not a guard.

const SCORES = Array.from({ length: 41 }, (_, i) => i * 0.25)   // 0 .. 10

describe('there is exactly one score to band ladder', () => {
  it('bandForScore agrees with scoreToBand at every quarter point', () => {
    for (const score of SCORES) {
      expect({ score, word: bandForScore(score).word.toLowerCase() })
        .toEqual({ score, word: scoreToBand(score) })
    }
  })

  it('categoryScoreToBand agrees with scoreToBand at every quarter point', () => {
    // The two that used to disagree: 4 was Developing here and Mixed
    // canonically; 3 was Difficult here and Developing canonically.
    for (const score of SCORES) {
      expect({ score, word: categoryScoreToBand(score).toLowerCase() })
        .toEqual({ score, word: scoreToBand(score) })
    }
  })

  it('BANDS.minScore is the same ladder, not a second one that agrees today', () => {
    for (const score of SCORES) {
      const fromMinScore = BANDS.find(b => score >= b.minScore) ?? BANDS[BANDS.length - 1]
      expect({ score, word: fromMinScore.word.toLowerCase() })
        .toEqual({ score, word: scoreToBand(score) })
    }
  })
})

describe('there is exactly one band to colour map', () => {
  const words = BANDS.map(b => b.word)

  it('every band a score can produce has a config', () => {
    const produced = new Set(SCORES.map(scoreToBand))
    for (const band of produced) {
      expect(BANDS.some(b => b.word.toLowerCase() === band)).toBe(true)
    }
    // All seven are reachable; a band nobody can score is dead config.
    expect(produced.size).toBe(BANDS.length)
  })

  it('bandConfig resolves every band and never silently falls through', () => {
    for (const b of BANDS) {
      expect(bandConfig(b.word.toLowerCase() as BandType)).toBe(b)
    }
  })

  it('the derived colour maps carry the canonical colours', () => {
    for (const word of words) {
      const canonical = BANDS.find(b => b.word === word)!.color
      expect({ word, color: CLUB_BAND_COLORS[word as keyof typeof CLUB_BAND_COLORS] })
        .toEqual({ word, color: canonical })
      expect({ word, color: MATCH_BAND_COLORS[word as keyof typeof MATCH_BAND_COLORS] })
        .toEqual({ word, color: canonical })
    }
  })
})

describe('the specific contradictions Kostas saw', () => {
  it('a 5 is Mixed and orange, on every screen', () => {
    expect(bandForScore(5).word).toBe('Mixed')
    expect(bandForScore(5).color).toBe('#fb923c')
    expect(categoryScoreToBand(5)).toBe('Mixed')
  })

  it('9.5 is Exceptional, not Standout', () => {
    // The removed ladder topped out at Standout and had no Exceptional at all.
    expect(bandForScore(9.5).word).toBe('Exceptional')
    expect(categoryScoreToBand(9.5)).toBe('Exceptional')
  })

  it('a 0 is Difficult, which the removed ladder could not express', () => {
    expect(bandForScore(0).word).toBe('Difficult')
    expect(categoryScoreToBand(0)).toBe('Difficult')
  })
})
