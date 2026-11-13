import { beforeEach, describe, expect, it } from 'vitest'
import { markOpened, newsOf, unopened } from '../news'

// TRAK-441 slice 2 ("For you", Imad 12 Nov) and TRAK-436: what the coach sent this child that the family hasn't opened.
// A shared plan, a changed plan and a published review; a review replaces its match's plan; only the last 14 days.
const NOW = Date.parse('2026-11-14T08:00:00Z')
const days = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

describe('what is new from the coach', () => {
  it('a shared plan, a changed one, and a review in place of its plan, newest first', () => {
    expect(newsOf({
      plans: [
        { event_id: 'parkview', shared_at: days(1), changed_at: null },
        { event_id: 'aris', shared_at: days(3), changed_at: days(0.5) },
        { event_id: 'lakeside', shared_at: days(9), changed_at: null },
      ],
      reviews: [{ event_id: 'lakeside', published_at: days(7) }],
    }, NOW)).toEqual([
      { kind: 'plan_changed', eventId: 'aris', at: days(0.5) },
      { kind: 'plan', eventId: 'parkview', at: days(1) },
      { kind: 'review', eventId: 'lakeside', at: days(7) },
    ])
  })

  it("a change only in the player's own copy (his job, the note) is a change for him", () => {
    expect(newsOf({
      plans: [{ event_id: 'parkview', shared_at: days(2), changed_at: null }],
      ownChanges: [{ event_id: 'parkview', changed_at: days(1) }],
      reviews: [],
    }, NOW)).toEqual([{ kind: 'plan_changed', eventId: 'parkview', at: days(1) }])
  })

  it('nothing older than 14 days: a first visit is not thirty old matches', () => {
    expect(newsOf({
      plans: [{ event_id: 'old', shared_at: days(20), changed_at: null }],
      reviews: [{ event_id: 'older', published_at: days(15) }, { event_id: 'recent', published_at: days(13) }],
    }, NOW).map(item => item.eventId)).toEqual(['recent'])
  })
})

describe('opened on this device', () => {
  beforeEach(() => localStorage.clear())

  it('opening the plan or the review clears it; a later change brings the plan back', () => {
    const news = newsOf({
      plans: [{ event_id: 'parkview', shared_at: days(1), changed_at: null }],
      reviews: [{ event_id: 'lakeside', published_at: days(2) }],
    }, NOW)
    expect(unopened('reader', 'child', news)).toHaveLength(2)
    markOpened('reader', 'child', 'plan', 'parkview', NOW)
    expect(unopened('reader', 'child', news).map(item => item.kind)).toEqual(['review'])
    // Another child, or another person on this device, has opened nothing.
    expect(unopened('reader', 'other-child', news)).toHaveLength(2)
    expect(unopened('someone-else', 'child', news)).toHaveLength(2)
    const changed = newsOf({ plans: [{ event_id: 'parkview', shared_at: days(1), changed_at: new Date(NOW + 60_000).toISOString() }], reviews: [] }, NOW + 120_000)
    expect(unopened('reader', 'child', changed)).toEqual([{ kind: 'plan_changed', eventId: 'parkview', at: new Date(NOW + 60_000).toISOString() }])
  })

  it('a blocked or broken store counts as nothing opened', () => {
    localStorage.setItem('trak:family-news-opened:reader', 'not json')
    expect(unopened('reader', 'child', newsOf({ plans: [], reviews: [{ event_id: 'lakeside', published_at: days(2) }] }, NOW))).toHaveLength(1)
  })
})
