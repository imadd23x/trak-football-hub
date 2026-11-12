import { afterEach, describe, expect, it } from 'vitest'
import { i18n, showLanguage, SOURCE_LANGUAGE } from '@/lib/i18n'
import { LOOP_STEPS, loopNote, loopState } from '@/lib/training/loop'
import { AGAIN, LOOP, loopSteps, trainingBadge } from '@/lib/training/next'
import { sessionSummary } from '@/lib/training/plans'
import { TRAINING_WORD, partName, partNote } from '@/lib/training/words'
import { fitLine, planProblem } from '@/lib/training/parts'
import { PART_TYPES } from '@/lib/training/shelf'
import { setupFor } from '@/lib/training/turnout'
import { playersShort } from '@/lib/training/shelf'
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

  it('says how a drill sets up for the players who came, in the language showing', async () => {
    const rondo = { kind: 'groups' as const, g: 6, lo: 4, hi: 7, unit: 'grid', labels: { 5: '4 v 1', 6: '4 v 2' } }
    expect(setupFor(rondo, 18)).toEqual({ ok: true, text: '3 grids of 6 (4 v 2)' })
    expect(setupFor({ kind: 'pairs' }, 15)).toEqual({ ok: true, text: '6 pairs and 1 group of 3' })
    expect(playersShort({ kind: 'pairs' })).toBe('In pairs')
    await showLanguage('el')
    expect(setupFor(rondo, 18)).toEqual({ ok: true, text: '3 πλαίσια των 6 (4 v 2)' })
    expect(setupFor({ kind: 'pairs' }, 15)).toEqual({ ok: true, text: '6 ζευγάρια και 1 γκρουπ των 3' })
    expect(setupFor({ kind: 'teams', min: 8 }, 15)).toEqual({ ok: true, text: '7 v 7 + 1 τζόκερ' })
    expect(playersShort({ kind: 'pairs' })).toBe('Σε ζευγάρια')
  })

  it('names Trak\'s parts in the language showing, and keeps a coach\'s own part name as written', async () => {
    for (const part of PART_TYPES) expect(partName(part.name)).toBe(part.name)
    expect(partName('Pressing game')).toBe('Pressing game')
    expect(fitLine(95, 90)).toBe('5 min over. That’s fine, it’s only a guide.')
    expect(planProblem([])).toBe('Add a part first.')
    await showLanguage('el')
    for (const part of PART_TYPES) {
      expect(partName(part.name)).not.toBe(part.name)
      expect(partNote(part.key)).not.toBe(part.note)
    }
    expect(partName('Pressing game')).toBe('Pressing game')
    expect(partName('Rondo')).toBe('Ρόντο')
    expect(fitLine(80, 90)).toBe('10 λ. περισσεύουν.')
  })
})
