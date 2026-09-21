import { type Band } from '@/lib/clubMock'
import { BANDS } from '@/lib/types'
import { bandForScore } from '@/lib/rating-engine'

export const BAND_COLORS: Record<Band, string> =
  Object.fromEntries(BANDS.map(b => [b.word, b.color])) as Record<Band, string>

// Self-rating mapping
export const SELF_RATING_BAND: Record<string, Band> = {
  excellent: 'Exceptional',
  good: 'Good',
  average: 'Steady',
  poor: 'Mixed',
}

// Map a 0–10 coach category score to a band word.
//
// This used to carry its own ladder, and it disagreed with scoreToBand below
// the midpoint: a 4 read "Developing" here and "Mixed" everywhere else, a 3
// read "Difficult" here and "Developing" everywhere else. Same child, same
// number, a different answer on the match-detail screen. Now there is one
// ladder and this is a spelling change on top of it.
export function categoryScoreToBand(score: number): Band {
  return bandForScore(score).word as Band
}
