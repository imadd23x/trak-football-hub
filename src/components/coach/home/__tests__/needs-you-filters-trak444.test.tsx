import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NeedsYou, FIRST_CARDS, type NeedsKind, type OwedEvent } from '@/components/coach/home/NeedsYou'
import type { NeedsYouItem } from '@/lib/coach-needs-you'

/**
 * TRAK-444: Needs you shows a short list first when a lot is owed, with filters by type and by date and a Show all.
 * The heading's count stays what is owed, whatever the filter shows.
 */
afterEach(cleanup)

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 12)
const event = (n: number, kind: NeedsKind, over: Partial<OwedEvent> = {}): OwedEvent =>
  ({ id: `e${n}`, title: `Event ${n}`, when: '', squad: null, reason: 'Log it', action: <span />, kind, at: NOW - n * DAY, ...over })
const player = (name: string, at: number): NeedsYouItem =>
  ({ playerId: name, name, detail: '', kind: 'assess', reason: 'Never assessed', urgent: false, at })

const show = (events: OwedEvent[], items: NeedsYouItem[] = []) =>
  render(<NeedsYou items={items} events={events} failed={false} onRetry={() => {}} onOpen={() => {}} />)
const titles = () => within(screen.getByRole('list')).getAllByRole('listitem').map(li => li.textContent ?? '')

describe('TRAK-444: Needs you with a lot owed', () => {
  it('shows every card and no filters while there are only a few', () => {
    show([event(1, 'match'), event(2, 'training')], [player('Pat', NOW)])
    expect(titles()).toHaveLength(3)
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('shows the first few, counts all of them, and Show all opens the rest', async () => {
    const owed = Array.from({ length: 12 }, (_, i) => event(i + 1, i % 2 ? 'match' : 'training'))
    show(owed)
    expect(titles()).toHaveLength(FIRST_CARDS)
    expect(screen.getByRole('heading', { name: /Needs you 12/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show all 12' }))
    expect(titles()).toHaveLength(12)
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(titles()).toHaveLength(FIRST_CARDS)
  })

  it('puts the urgent cards first, then the newest', () => {
    const owed = [event(1, 'match'), event(9, 'match', { urgent: true }), event(2, 'match'), event(3, 'match'), event(4, 'match'), event(5, 'match'), event(20, 'match', { urgent: true })]
    show(owed)
    expect(titles().map(text => text.match(/Event \d+/)![0])).toEqual(['Event 9', 'Event 20', 'Event 1', 'Event 2', 'Event 3'])
  })

  it('filters by type without changing the count in the heading', async () => {
    const owed = [...Array.from({ length: 4 }, (_, i) => event(i + 1, 'match')), ...Array.from({ length: 4 }, (_, i) => event(i + 10, 'training'))]
    show(owed, [player('Pat', NOW - 40 * DAY), player('Sam', NOW - 50 * DAY)])
    await userEvent.click(screen.getByRole('button', { name: 'Training' }))
    expect(titles()).toHaveLength(4)
    expect(titles().every(text => /Event 1\d/.test(text))).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Assessments' }))
    expect(titles()).toHaveLength(2)
    expect(screen.getByRole('heading', { name: /Needs you 10/ })).toBeInTheDocument()
  })

  it('orders by date, newest or oldest first', async () => {
    const owed = Array.from({ length: 8 }, (_, i) => event(i + 1, 'match', { urgent: i === 7 }))
    show(owed)
    await userEvent.click(screen.getByRole('button', { name: 'Oldest first' }))
    expect(titles().map(text => text.match(/Event \d+/)![0])).toEqual(['Event 8', 'Event 7', 'Event 6', 'Event 5', 'Event 4'])
    await userEvent.click(screen.getByRole('button', { name: 'Newest first' }))
    expect(titles().map(text => text.match(/Event \d+/)![0])).toEqual(['Event 1', 'Event 2', 'Event 3', 'Event 4', 'Event 5'])
  })

  it('says so when a filter has nothing', async () => {
    show(Array.from({ length: 7 }, (_, i) => event(i + 1, 'match')))
    await userEvent.click(screen.getByRole('button', { name: 'Training' }))
    expect(screen.getByText('Nothing in this filter.')).toBeInTheDocument()
  })

  it('leaves the cards that fit no type to All', async () => {
    show([...Array.from({ length: 6 }, (_, i) => event(i + 1, 'match')), event(50, 'other', { title: 'Place your players', at: undefined })])
    expect(screen.queryByText('Place your players')).not.toBeNull() // newest of an undated kind counts as now
    await userEvent.click(screen.getByRole('button', { name: 'Matches' }))
    expect(screen.queryByText('Place your players')).toBeNull()
  })
})
