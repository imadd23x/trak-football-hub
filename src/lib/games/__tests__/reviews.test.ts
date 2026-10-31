import { describe, expect, it } from 'vitest'
import { reviewOf, whatWeAsked, words } from '../reviews'

// TRAK-289: what a player and their family read after the coach publishes (TRAK-282's words); the coach sees labels.
// TRAK-319: the job, "did the job" and the note come from the child's own copy; a guardian reads none of them.
const row = {
  event_id: 'g1', session_id: 's1', our_score: 2, their_score: 1,
  expectation: 'stretch', context: ['out_of_position', 'first_start'], against_expectation: 'above', coach_name: ' Otto Rehhagel ',
}
const own = { job: 'Stay tight to their winger.', did_job: 'partly', note: 'Brave all game.' }

describe('the review', () => {
  it('reads a published copy: the job, did the job and the note only from the child\'s own copy', () => {
    expect(reviewOf(row, own)).toEqual({
      eventId: 'g1', sessionId: 's1', ourScore: 2, theirScore: 1, job: 'Stay tight to their winger.', didJob: 'partly',
      expectation: 'stretch', context: ['out_of_position', 'first_start'], against: 'above',
      coachName: 'Otto Rehhagel', note: 'Brave all game.',
    })
    expect(reviewOf({ ...row, coach_name: '' }, null)).toMatchObject({ coachName: null, job: '', didJob: null, note: null })
    expect(reviewOf(row, { ...own, note: '' })).toMatchObject({ note: null })
  })

  it('says it in TRAK-282\'s words; a guardian reads no "did the job"', () => {
    expect(words(reviewOf(row, own))).toEqual({
      didJob: 'You did part of your job',
      asked: 'A big ask today. A solid job is a good game. (out of position, first start)',
      against: 'Went beyond what we asked',
    })
    expect(words(reviewOf(row, null)).didJob).toBeNull()
    expect(whatWeAsked('usual', [])).toBe('Your normal game.')
    expect(whatWeAsked('lead', [])).toBe('We needed you to take charge.')
    expect(words({ ...reviewOf(row, own), didJob: 'not_yet', against: 'below' })).toMatchObject({
      didJob: 'Not this time', against: 'Not quite this time',
    })
    expect(words({ ...reviewOf(row, own), didJob: 'yes', against: 'met' })).toMatchObject({
      didJob: 'You did your job', against: 'Did what we asked',
    })
  })
})
