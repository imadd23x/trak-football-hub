import { describe, expect, it } from 'vitest'
import { progressSummary } from '../evaluation-progress'

describe('TRAK-401: the Progress line on an evaluation assessment', () => {
  it('counts each word, Met first, then On track, Some progress, Not yet', () => {
    expect(progressSummary([{ status: 'on_track' }, { status: 'some_progress' }])).toBe('Progress: 1 on track, 1 some progress')
    expect(progressSummary([{ status: 'not_yet' }, { status: 'met' }, { status: 'not_yet' }])).toBe('Progress: 1 met, 2 not yet')
  })
  it('says nothing when no objective was rated', () => {
    expect(progressSummary([])).toBeNull()
  })
})
