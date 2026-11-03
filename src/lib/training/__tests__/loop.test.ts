import { describe, expect, it } from 'vitest'
import { clockPlus, loopNote, loopState, practiceStarts } from '../loop'

/* TRAK-298 (Training 5/5): the loop's steps come from what exists; Close is automatic (Kostas, 28 Oct). TRAK-339
   (Training redo 1/5): four steps, Logistics → Plan → Who's here → Notes; Logistics comes from the schedule, and saving
   or skipping Notes closes a training that's over too. */

describe('the training loop', () => {
  it('starts at Plan: Logistics is done, from the schedule', () => {
    expect(loopState({ planned: false, registered: false, started: false, over: false }))
      .toEqual({ done: [true, false, false, false], at: 1, closed: false })
  })

  it('once planned, Who’s here is next: "next" before the training, "now" once it has started', () => {
    const before = loopState({ planned: true, registered: false, started: false, over: false })
    expect(before.at).toBe(2)
    expect(loopNote(before, false)).toBe('next')
    expect(loopNote(before, true)).toBe('now')
  })

  it('with the register taken, Notes are next, and optional', () => {
    const on = loopState({ planned: true, registered: true, started: true, over: false })
    expect(on).toEqual({ done: [true, true, true, false], at: 3, closed: false })
    expect(loopNote(on, true)).toBe('optional')
  })

  it('closes on its own once it has ended with its register taken, Notes or not', () => {
    expect(loopState({ planned: true, registered: true, started: true, over: true }))
      .toEqual({ done: [true, true, true, false], at: 3, closed: true })
    expect(loopState({ planned: true, registered: true, noted: true, started: true, over: true }))
      .toEqual({ done: [true, true, true, true], at: 4, closed: true })
  })

  it('an ended training without a register isn’t closed: Who’s here is still to do, now', () => {
    const missed = loopState({ planned: true, registered: false, started: true, over: true })
    expect(missed).toEqual({ done: [true, true, false, false], at: 2, closed: false })
    expect(loopNote(missed, true)).toBe('now')
  })

  it('Notes saved or skipped close it without a register; Plan stays not done', () => {
    expect(loopState({ planned: false, registered: false, noted: true, started: true, over: true }))
      .toEqual({ done: [true, false, false, true], at: 1, closed: true })
  })

  it('a register without a plan closes it all the same', () => {
    expect(loopState({ planned: false, registered: true, started: true, over: true }).closed).toBe(true)
  })
})

describe('View’s clock', () => {
  it('adds minutes on a 24-hour clock', () => {
    expect(clockPlus('18:00', 15)).toBe('18:15')
    expect(clockPlus('18:50', 25)).toBe('19:15')
    expect(clockPlus('23:50', 20)).toBe('00:10')
  })

  it('says when each practice starts, or nothing for a training with no time', () => {
    expect(practiceStarts('18:00', [{ minutes: 15 }, { minutes: 25 }, { minutes: 30 }])).toEqual(['18:00', '18:15', '18:40'])
    expect(practiceStarts(null, [{ minutes: 15 }])).toEqual([null])
  })
})
