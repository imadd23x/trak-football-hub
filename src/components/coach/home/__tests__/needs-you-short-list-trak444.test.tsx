import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NeedsYou, FIRST_CARDS, type OwedEvent } from '@/components/coach/home/NeedsYou'
import type { NeedsYouItem } from '@/lib/coach-needs-you'

/**
 * TRAK-444: Needs you shows a short list first when a lot is owed, with a Show all. The urgent cards come first, then the
 * newest, and the heading's count stays what is owed. There are no filters (Tarek, 13 Nov: not what he imagined, and not needed).
 */
afterEach(cleanup)

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 12)
const event = (n: number, over: Partial<OwedEvent> = {}): OwedEvent =>
  ({ id: `e${n}`, title: `Event ${n}`, when: '', squad: null, reason: 'Log it', action: <span />, at: NOW - n * DAY, ...over })
const player = (name: string, at: number): NeedsYouItem =>
  ({ playerId: name, name, detail: '', kind: 'assess', reason: 'Never assessed', urgent: false, at })

const show = (events: OwedEvent[], items: NeedsYouItem[] = []) =>
  render(<NeedsYou items={items} events={events} failed={false} onRetry={() => {}} onOpen={() => {}} />)
const titles = () => within(screen.getByRole('list')).getAllByRole('listitem').map(li => li.textContent ?? '')

describe('TRAK-444: Needs you with a lot owed', () => {
  it('shows every card while there are only a few', () => {
    show([event(1), event(2)], [player('Pat', NOW)])
    expect(titles()).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('shows the first few, counts all of them, and Show all opens the rest', async () => {
    show(Array.from({ length: 12 }, (_, i) => event(i + 1)))
    expect(titles()).toHaveLength(FIRST_CARDS)
    expect(screen.getByRole('heading', { name: /Needs you 12/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show all 12' }))
    expect(titles()).toHaveLength(12)
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(titles()).toHaveLength(FIRST_CARDS)
  })

  it('puts the urgent cards first, then the newest', () => {
    show([event(1), event(9, { urgent: true }), event(2), event(3), event(4), event(5), event(20, { urgent: true })])
    expect(titles().map(text => text.match(/Event \d+/)![0])).toEqual(['Event 9', 'Event 20', 'Event 1', 'Event 2', 'Event 3'])
  })

  it('has no filters: no type chips and no date order', () => {
    show(Array.from({ length: 8 }, (_, i) => event(i + 1)), [player('Pat', NOW - 40 * DAY)])
    for (const name of ['All', 'Matches', 'Assessments', 'Training', 'Most urgent', 'Newest first', 'Oldest first']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Order' })).toBeNull()
  })
})
