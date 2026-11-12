import { afterEach, describe, expect, it } from 'vitest'
import { i18n, showLanguage, SOURCE_LANGUAGE } from '@/lib/i18n'
import { LOOP_STEPS, loopNote, loopState } from '@/lib/training/loop'
import { AGAIN, LOOP, loopSteps, trainingBadge } from '@/lib/training/next'
import { sessionSummary } from '@/lib/training/plans'
import { TRAINING_WORD } from '@/lib/training/words'
import { shown } from '@/lib/squad/trait-words'

/* TRAK-408 (Languages 3/8, Training): every fixed label of the Training loop has a word; counts follow the language. */

afterEach(async () => {
  await i18n.changeLanguage(SOURCE_LANGUAGE)
  localStorage.clear()
})

const labels = () => [
  ...LOOP_STEPS, ...LOOP.flatMap(step => [step.label, ...(step.description ? [step.description] : [])]),
  ...loopSteps({ current: 3, planned: false, registered: false }).flatMap(step => ('error' in step && step.error ? [step.error] : [])),
  ...AGAIN.map(a => a.label),
  trainingBadge({ phase: 'after', planned: true }).label, trainingBadge({ phase: 'day', planned: true }).label,
  trainingBadge({ phase: 'before', planned: true }).label, trainingBadge({ phase: 'before', planned: false, draft: true }).label,
  trainingBadge({ phase: 'before', planned: false }).label,
  loopNote(loopState({ planned: false, registered: false, started: false, over: false }), false),
  loopNote(loopState({ planned: true, registered: false, started: false, over: false }), false),
  loopNote(loopState({ planned: true, registered: true, started: true, over: true }), true),
]

describe('TRAK-408: Training in Greek', () => {
  it('has a word for every fixed label, the same in English', async () => {
    const english = [...new Set(labels())]
    for (const label of english) expect(shown(TRAINING_WORD, label)).toBe(label)
    await showLanguage('el')
    for (const label of english) expect(shown(TRAINING_WORD, label)).not.toBe(label)
  })

  it('counts who is here and a plan\'s practices in the language showing', async () => {
    expect(trainingBadge({ phase: 'after', planned: true, here: 14 }).label).toBe('14 here')
    expect(sessionSummary([{ name: 'Rondos', minutes: 15 }])).toBe('1 practice · 15 min · Rondos')
    expect(sessionSummary([{ name: 'Rondos', minutes: 15 }, { name: '8v8', minutes: 30 }])).toBe('2 practices · 45 min · Rondos, 8v8')
    await showLanguage('el')
    expect(trainingBadge({ phase: 'after', planned: true, here: 14 }).label).toBe('14 παρόντες')
    expect(sessionSummary([{ name: 'Rondos', minutes: 15 }])).toBe('1 άσκηση · 15 λ. · Rondos')
  })
})
