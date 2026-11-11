import { afterEach, describe, expect, it } from 'vitest'
import { i18n, showLanguage, SOURCE_LANGUAGE } from '@/lib/i18n'
import { STATE, matchActions, type GameState } from '@/lib/games/loop'
import { MATCH_WORD } from '@/lib/games/match-words'
import { matchResult } from '@/lib/games/results'
import { shown } from '@/lib/squad/trait-words'
import { gameTitle } from '@/components/coach/games/useGames'

/* TRAK-407 (Languages 2/8, Matches): every state and action of a match has a word; results and titles follow the language. */

afterEach(async () => {
  await i18n.changeLanguage(SOURCE_LANGUAGE)
  localStorage.clear()
})

const labels = () => {
  const states = Object.keys(STATE) as GameState[]
  return [...new Set(states.flatMap(state => [STATE[state].label, ...(matchActions(state) ? [matchActions(state)!.main, ...matchActions(state)!.more].map(a => a.label) : [])]))]
}

describe('TRAK-407: Matches in Greek', () => {
  it('has a word for every state and action, the same in English', async () => {
    for (const label of labels()) expect(shown(MATCH_WORD, label)).toBe(label)
    await showLanguage('el')
    for (const label of labels()) expect(shown(MATCH_WORD, label)).not.toBe(label)
  })

  it('says a result and a title in the language showing', async () => {
    expect(matchResult(2, 1).label).toBe('Won 2–1')
    expect(matchResult(0, 0).label).toBe('Drew 0–0')
    expect(matchResult(1, 3).label).toBe('Lost 1–3')
    expect(matchResult(null, null).label).toBe('Published')
    expect(gameTitle({ opponent: 'Rivals', title: 'x' })).toBe('vs Rivals')
    await showLanguage('el')
    expect(matchResult(2, 1).label).toBe('Νίκη 2–1')
    expect(gameTitle({ opponent: 'Rivals', title: 'x' })).toBe('εναντίον Rivals')
  })
})
