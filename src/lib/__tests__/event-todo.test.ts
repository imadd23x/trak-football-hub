/** TRAK-622 (Other events → To-do 2/6): which day a to-do added from an event shows on, and which events are In To-do. */
import { describe, expect, it } from 'vitest'
import { dueOn, firstWhen, openEventTodos, whenOffered, wordsMax } from '@/lib/event-todo'

const TODAY = '2026-11-28' // a Saturday

describe('TRAK-622: Add to To-do on an event', () => {
  it('each action starts on its own day: invite today, be there on the day, bring the day before', () => {
    const tuesday = '2026-12-01'
    expect(firstWhen('invite', tuesday, TODAY)).toBe('today')
    expect(firstWhen('there', tuesday, TODAY)).toBe('onday')
    expect(firstWhen('bring', tuesday, TODAY)).toBe('before')
    expect(firstWhen('else', tuesday, TODAY)).toBe('onday')
    expect(dueOn('before', tuesday, TODAY)).toBe('2026-11-30')
    expect(dueOn('onday', tuesday, TODAY)).toBe(tuesday)
    expect(dueOn('today', tuesday, TODAY)).toBe(TODAY)
  })

  it('for an event today, only Today is offered, and every action starts on it', () => {
    expect([whenOffered('today', TODAY, TODAY), whenOffered('before', TODAY, TODAY), whenOffered('onday', TODAY, TODAY)]).toEqual([true, false, false])
    for (const action of ['invite', 'there', 'bring', 'else'] as const) expect(firstWhen(action, TODAY, TODAY)).toBe('today')
  })

  it('for an event tomorrow, The day before is today, so Today stands in for it', () => {
    const tomorrow = '2026-11-29'
    expect(whenOffered('before', tomorrow, TODAY)).toBe(false)
    expect(whenOffered('onday', tomorrow, TODAY)).toBe(true)
    expect(firstWhen('bring', tomorrow, TODAY)).toBe('today')
    expect(dueOn('onday', tomorrow, TODAY)).toBe(tomorrow)
  })

  it('never shows before today, even for a day that has passed', () => {
    expect(dueOn('before', TODAY, TODAY)).toBe(TODAY)
    expect(dueOn('onday', '2026-11-20', TODAY)).toBe(TODAY)
  })

  it('an event is In To-do while its to-do is open; a ticked one frees it', () => {
    const open = openEventTodos([
      { id: 'a', dueOn: TODAY, doneAt: null, eventId: 'drinks' },
      { id: 'b', dueOn: '2026-11-30', doneAt: null, eventId: 'photo' },
      { id: 'c', dueOn: TODAY, doneAt: '2026-11-28T09:00:00Z', eventId: 'kit' },
      { id: 'd', dueOn: TODAY, doneAt: null, eventId: null },
    ])
    expect([...open]).toEqual([['drinks', { id: 'a', dueOn: TODAY }], ['photo', { id: 'b', dueOn: '2026-11-30' }]])
  })

  it("leaves room for the event's name in a to-do's 120 characters", () => {
    expect(wordsMax('Drinks')).toBe(111)
    expect(wordsMax('x'.repeat(200))).toBe(1)
  })
})
