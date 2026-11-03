import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionById } from '@/lib/library/library'
import {
  bestFit, blankPractice, fromDrill, fromLibrary, fromSaved, minutesLine, move, plannedMinutes,
  overTime, roomFor, searchSessions, sessionSummary, sourceLabel, toSave, type SavedPractice,
} from '../plans'

/* TRAK-295 (Training 2/5): a plan's rules, apart from the screens. */

const saved = (position: number, name: string, over: Partial<SavedPractice> = {}): SavedPractice => ({
  position, name, minutes: 15, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'own', drill_id: null, library_session: null, ...over,
})

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('a plan’s practices', () => {
  it('a new practice is written here and ticked for My drills', () => {
    expect(blankPractice()).toMatchObject({ name: '', minutes: 15, source: 'own', saveToDrills: true })
  })

  it('the saved practices come back in order, never to be saved to My drills again', () => {
    const practices = fromSaved([saved(2, 'Finishing 3v2'), saved(1, 'Rondos 4v1', { source: 'drill', drill_id: 'd-1' })])
    expect(practices.map(p => p.name)).toEqual(['Rondos 4v1', 'Finishing 3v2'])
    expect(practices.every(p => !p.saveToDrills)).toBe(true)
    expect(practices[0]).toMatchObject({ source: 'drill', drill_id: 'd-1' })
    expect(practices[0]).not.toHaveProperty('position')
  })

  it('saving sends them trimmed, and asks for a drill only for a practice written here and ticked', () => {
    const own = { ...blankPractice(), name: '  Pressing on the trigger ', tell: ' Press when their 6 turns. ' }
    const kept = { ...blankPractice(), name: 'Rondos', source: 'drill' as const, drill_id: 'd-1' }
    const notKept = { ...blankPractice(), name: 'Game 8v8', saveToDrills: false }
    expect(toSave([own, kept, notKept])).toEqual([
      expect.objectContaining({ name: 'Pressing on the trigger', tell: 'Press when their 6 turns.', source: 'own', save_to_drills: true }),
      expect.objectContaining({ name: 'Rondos', source: 'drill', drill_id: 'd-1', save_to_drills: false }),
      expect.objectContaining({ name: 'Game 8v8', source: 'own', save_to_drills: false }),
    ])
    expect(toSave([own])).toEqual([expect.not.objectContaining({ saveToDrills: expect.anything() })])
  })

  it('each says where it came from', () => {
    expect(sourceLabel({ source: 'own', saveToDrills: false })).toBe('Written here')
    expect(sourceLabel({ source: 'own', saveToDrills: true })).toBe('Your drill')
    expect(sourceLabel({ source: 'drill', saveToDrills: false })).toBe('Your drill')
    expect(sourceLabel({ source: 'library', saveToDrills: false })).toBe('Library')
    expect(sourceLabel({ source: 'library', saveToDrills: false, library_session: 'pressing-and-covering-session-pressing-duels' }))
      .toBe('Library · Defending')
  })

  it('moves one up or down, and never past either end', () => {
    expect(move(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    const list = ['a', 'b']
    expect(move(list, 0, -1)).toBe(list)
    expect(move(list, 1, 1)).toBe(list)
  })
})

describe('the minutes', () => {
  it('adds up the practices', () => {
    expect(plannedMinutes([{ minutes: 15 }, { minutes: 25 }])).toBe(40)
    expect(plannedMinutes([])).toBe(0)
  })

  it('says how many of the training’s minutes are planned, and what’s left or over', () => {
    expect(minutesLine(40, 90)).toEqual({ planned: '40 of 90 min planned', left: '50 min left' })
    expect(minutesLine(90, 90)).toEqual({ planned: '90 of 90 min planned', left: 'Fills the session' })
    expect(minutesLine(100, 90)).toEqual({ planned: '100 of 90 min planned', left: '10 min over' })
  })

  it('with no length for the training, just what’s planned', () => {
    expect(minutesLine(40, null)).toEqual({ planned: '40 min planned', left: null })
  })

  it('a plan longer than the training says so plainly, and never blocks it (Kostas, 28 Oct)', () => {
    expect(overTime(75, 60)).toBe('You set this training for 60 min. The plan runs 15 min over. You can keep it, or change the training\'s time in Schedule.')
    expect(overTime(60, 60)).toBeNull()
    expect(overTime(75, null)).toBeNull()
  })
})

describe('TRAK-296: a practice from a drill or the Library', () => {
  const drill = {
    id: 'd-1', name: 'Rondos 4v1', minutes: 15, how: 'Four round one.', tell: 'Two touches.', area: '10 × 10 m', numbers: '',
    direction: '', targets: '', conditions: '', updated_at: '2026-10-27T10:00:00Z',
  }

  it('a drill becomes a copy that remembers it, never saved to My drills again', () => {
    expect(fromDrill(drill)).toEqual({
      name: 'Rondos 4v1', minutes: 15, how: 'Four round one.', tell: 'Two touches.', area: '10 × 10 m', numbers: '', direction: '',
      targets: '', conditions: '', source: 'drill', drill_id: 'd-1', library_session: null, saveToDrills: false,
    })
  })

  it('a Library session takes its short name, the slot’s minutes (or 20), what it’s about, its pitch and its players', () => {
    const session = sessionById('pressing-and-covering-session-pressing-duels')!
    expect(fromLibrary(session, 25)).toMatchObject({
      name: 'Pressing duels', minutes: 25, how: session.summary, area: '50×40-yard pitch', numbers: '13 players', tell: '',
      source: 'library', drill_id: null, library_session: session.id, saveToDrills: false,
    })
    expect(fromLibrary(session, null).minutes).toBe(20)
  })

  it('a new practice has room for what’s left, to the nearest 5, kept to 10–30', () => {
    expect(roomFor(70, 90)).toBe(20)
    expect(roomFor(0, 90)).toBe(30)
    expect(roomFor(83, 90)).toBe(10)
    expect(roomFor(90, 90)).toBeNull()
    expect(roomFor(40, null)).toBeNull()
  })

  it('the best fit is the drills closest to the slot’s minutes, the newest first on a tie, at most 3', () => {
    const drills = [10, 30, 15, 25, 20].map(minutes => ({ name: `${minutes}`, minutes }))
    expect(bestFit(drills, 20).map(d => d.minutes)).toEqual([20, 15, 25])
    expect(bestFit(drills, 30).map(d => d.minutes)).toEqual([30, 25, 20])
    expect(bestFit([], 20)).toEqual([])
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
