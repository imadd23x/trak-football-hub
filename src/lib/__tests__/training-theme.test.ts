import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TRAINING_THEMES, catalogueLink, trainingThemeFrom } from '@/lib/training-theme'
import { blankForm, formToRow, rowToForm, type EventRow } from '@/lib/coach-events'

/**
 * [scope] Training theme on New event: a coach setting up a training picks one
 * of the Coaching Session Catalogue's seven libraries as its theme, and can
 * open the catalogue on that library to choose sessions.
 */

const html = readFileSync(resolve(__dirname, '../../../public/trainings/coaching-session-catalogue.html'), 'utf8')
const json = (name: string) => JSON.parse(html.match(new RegExp(`const ${name} = (.*);\\r?$`, 'm'))![1])
const DATA: { library: string }[] = json('DATA')
const TOPIC_ORDER: Record<string, string[]> = json('TOPIC_ORDER')

describe('the seven themes are the catalogue libraries', () => {
  it('in the catalogue order, with its session and topic counts', () => {
    expect(TRAINING_THEMES.map(t => t.library)).toEqual(Object.keys(TOPIC_ORDER))
    for (const t of TRAINING_THEMES) {
      expect({ [t.label]: t.sessions }).toEqual({ [t.label]: DATA.filter(d => d.library === t.library).length })
      expect({ [t.label]: t.topics }).toEqual({ [t.label]: TOPIC_ORDER[t.library].length })
    }
  })

  it('uses the short names coaches see on the catalogue tabs', () => {
    expect(TRAINING_THEMES.map(t => t.label)).toEqual([
      'Technical', 'Attacking', 'Defending', 'Transition', 'Goalkeeping', 'Physical & movement', 'Psychological & social',
    ])
  })

  it('links to the Library opened on a theme, or on its first page (TRAK-264)', () => {
    expect(catalogueLink('defending')).toBe('/coach/trainings/defending')
    expect(catalogueLink(null)).toBe('/coach/trainings')
    expect(catalogueLink('')).toBe('/coach/trainings')
  })

  it('reads back only a known theme', () => {
    expect(trainingThemeFrom('goalkeeping')).toBe('goalkeeping')
    expect(trainingThemeFrom('Goalkeeping')).toBe('')
    expect(trainingThemeFrom(null)).toBe('')
  })
})

describe('the event form stores the theme on trainings only', () => {
  const form = { ...blankForm('2030-01-07'), time: '17:00' }

  it('writes the chosen theme on a training', () => {
    expect(formToRow({ ...form, theme: 'transition' })).toMatchObject({ training_theme: 'transition' })
    expect(formToRow(form)).toMatchObject({ training_theme: null })
  })

  it('drops it when the event is a match or other', () => {
    expect(formToRow({ ...form, kind: 'match', opponent: 'Synthetic FC', theme: 'transition' })).toMatchObject({ training_theme: null })
    expect(formToRow({ ...form, kind: 'other', title: 'Photo', theme: 'transition' })).toMatchObject({ training_theme: null })
  })

  it('reads it back for an edit', () => {
    const row: EventRow = {
      id: 'e1', title: 'Training', event_type: 'training', starts_at: '2030-01-07T13:00:00Z', published: false,
      training_theme: 'attacking',
    }
    expect(rowToForm(row).theme).toBe('attacking')
    expect(rowToForm({ ...row, training_theme: null }).theme).toBe('')
  })
})

// TRAK-419 (11 Nov review): where Training is on, a theme's link opens Training › Drills, as near the theme as Drills can.
describe('drillsLink', () => {
  it('opens each theme on its drills where Drills can show them, and plain Drills otherwise', async () => {
    const { drillsLink } = await import('../training-theme')
    expect(drillsLink('technical')).toBe('/coach/training/drills/all?show=Technical')
    expect(drillsLink('goalkeeping')).toBe('/coach/training/drills/all?show=Goalkeeping')
    expect(drillsLink('attacking')).toBe('/coach/training/drills/all?q=attack')
    expect(drillsLink('defending')).toBe('/coach/training/drills/all?q=defend')
    expect(drillsLink('transition')).toBe('/coach/training/drills/all?q=transition')
    for (const none of ['physical', 'psychological', '', null, undefined, 'session', 'programmes', 'nope']) {
      expect(drillsLink(none)).toBe('/coach/training/drills')
    }
  })
})
