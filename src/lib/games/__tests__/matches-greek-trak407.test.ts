import { afterEach, describe, expect, it } from 'vitest'
import { i18n, showLanguage, SOURCE_LANGUAGE } from '@/lib/i18n'
import { STATE, matchActions, type GameState } from '@/lib/games/loop'
import { MATCH_WORD, optionWords } from '@/lib/games/match-words'
import { CONTEXT, EXPECTATIONS, markerWords } from '@/lib/games/lineup'
import { STRENGTHS } from '@/lib/games/plan'
import { AGAINST, DID_JOB, PLAN_WORKED, summary } from '@/lib/games/evaluation'
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

  it('has a word for every strength, context and expectation, the same in English', async () => {
    const lists = () => [optionWords('strength', STRENGTHS), optionWords('context', CONTEXT), optionWords('expectation', EXPECTATIONS)]
    expect(lists()).toEqual([STRENGTHS, CONTEXT, EXPECTATIONS])
    const english = lists().flat().flatMap(option => [option.label, ...('description' in option ? [option.description] : [])])
    await showLanguage('el')
    const greek = lists().flat().flatMap(option => [option.label, ...('description' in option ? [option.description] : [])])
    expect(greek).toHaveLength(english.length)
    greek.forEach((word, i) => expect(word).not.toBe(english[i]))
  })

  it('says a face\'s markers in the language showing', async () => {
    const plan = { role: 'starter' as const, slot: 2, job: 'Win it', note: '', context: ['first_start', 'playing_up'], expectation: 'lead' as const }
    expect(markerWords(plan)).toEqual(['lead', 'has a job', 'context: first start and playing up an age group'])
    await showLanguage('el')
    expect(markerWords(plan)).toEqual(['ηγέτης', 'έχει ρόλο', 'πλαίσιο: πρώτη φορά βασικός και παίζει σε μεγαλύτερη ηλικιακή ομάδα'])
  })

  it('has a word for every evaluation answer, and sums a player up in the language showing', async () => {
    const lists = () => [optionWords('didJob', DID_JOB), optionWords('against', AGAINST), optionWords('planWorked', PLAN_WORKED)]
    expect(lists()).toEqual([DID_JOB, AGAINST, PLAN_WORKED])
    expect(summary({ didJob: 'yes', against: 'met', note: '' })).toBe('Did the job · Met')
    const english = lists().flat().map(option => option.label)
    await showLanguage('el')
    lists().flat().forEach((option, i) => expect(option.label).not.toBe(english[i]))
    expect(summary({ didJob: 'yes', against: 'met', note: '' })).toBe('Έκανε τον ρόλο του · Όπως αναμενόταν')
    expect(i18n.t('coachMatches:publishTo', { count: 1 })).toBe('Δημοσίευση σε 1 παίκτη και οικογένεια')
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
