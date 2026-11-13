import { describe, expect, it } from 'vitest'
import { fromSaved, overTime, plannedMinutes, searchSessions, sessionSummary, sourceLabel, type SavedPractice } from '../plans'

/* TRAK-295 (Training 2/5): a plan's rules, apart from the screens. TRAK-340 (Training redo 2/5): planning itself moved to
   parts (parts.test.ts); what's left reads a saved plan. */

const saved = (position: number, name: string, over: Partial<SavedPractice> = {}): SavedPractice => ({
  position, name, minutes: 15, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'own', drill_id: null, library_session: null, part: '', part_type: null, trak_drill: null, players_kind: null, group_size: null, trak_level: null, ...over,
})

describe('a saved plan’s practices', () => {
  it('come back in order', () => {
    const practices = fromSaved([saved(2, 'Finishing 3v2'), saved(1, 'Rondos 4v1', { source: 'drill', drill_id: 'd-1' })])
    expect(practices.map(p => p.name)).toEqual(['Rondos 4v1', 'Finishing 3v2'])
    expect(practices[0]).toMatchObject({ source: 'drill', drill_id: 'd-1' })
    expect(practices[0]).not.toHaveProperty('position')
  })

  it('each says where it came from', () => {
    expect(sourceLabel({ source: 'own' })).toBe('Written here')
    expect(sourceLabel({ source: 'drill' })).toBe('Your drill')
    expect(sourceLabel({ source: 'trak' })).toBe('Trak drill')
    expect(sourceLabel({ source: 'library' })).toBe('Library')
    expect(sourceLabel({ source: 'library', library_session: 'pressing-and-covering-session-pressing-duels' }))
      .toBe('Library · Defending')
  })
})

describe('the minutes', () => {
  it('adds up the practices', () => {
    expect(plannedMinutes([{ minutes: 15 }, { minutes: 25 }])).toBe(40)
    expect(plannedMinutes([])).toBe(0)
  })

  it('a plan longer than the training says so plainly, and never blocks it (Kostas, 28 Oct)', () => {
    expect(overTime(75, 60)).toBe('You set this training for 60 min. The plan runs 15 min over. You can keep it, or change the training\'s time in Events.')
    expect(overTime(60, 60)).toBeNull()
    expect(overTime(75, null)).toBeNull()
  })
})

describe('TRAK-297: past sessions', () => {
  const sessions = [
    { title: 'Pressing zones', practices: [{ name: 'Rondos 4v1', minutes: 15 }, { name: 'Pressing on the trigger', minutes: 25 }] },
    { title: 'Finishing', practices: [{ name: 'Finishing 3v2', minutes: 20 }] },
  ]

  it('search finds a session by its name or a practice’s, every word typed', () => {
    expect(searchSessions(sessions, '').map(s => s.title)).toEqual(['Pressing zones', 'Finishing'])
    expect(searchSessions(sessions, 'rondos').map(s => s.title)).toEqual(['Pressing zones'])
    expect(searchSessions(sessions, 'FINISH 3v2').map(s => s.title)).toEqual(['Finishing'])
    expect(searchSessions(sessions, 'pressing finishing')).toEqual([])
  })

  it('sums a session up: practices, minutes and their names', () => {
    expect(sessionSummary(sessions[0].practices)).toBe('2 practices · 40 min · Rondos 4v1, Pressing on the trigger')
    expect(sessionSummary(sessions[1].practices)).toBe('1 practice · 20 min · Finishing 3v2')
  })
})
