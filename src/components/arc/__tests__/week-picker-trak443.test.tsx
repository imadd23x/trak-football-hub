import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WeekPicker, type WeekDay } from '../blocks/availability-picker/week-picker'

/**
 * TRAK-443 (walk-through of 11 Nov): the grey bar under the coach's week keeps the chosen event's title, Details and
 * the next step, without the event's line again. An empty day has no bar: the list already says "Nothing planned".
 */
afterEach(cleanup)

const days: WeekDay[] = [
  { id: '2026-11-10', short: 'Tue', date: '10', full: 'Tuesday 10 November', today: true,
    events: [{ id: 'ev-1', kind: 'training', title: 'U16 training', time: '18:00', state: 'needs-you', note: 'Take the register' }] },
  { id: '2026-11-11', short: 'Wed', date: '11', full: 'Wednesday 11 November', events: [] },
]
const show = () => render(<WeekPicker title="This week" subtitle="9–15 November" days={days}
  renderPrimary={() => <button>Take register</button>} renderDetails={(_, trigger) => trigger} />)

describe("TRAK-443: the bar under the coach's week", () => {
  it("a day with an event: the title, Details and the next step; the event's line shows once, on its row", () => {
    show()
    expect(screen.getByText('U16 training · 18:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take register' })).toBeInTheDocument()
    expect(screen.getAllByText('Take the register')).toHaveLength(1)
  })

  it('an empty day: no bar, and "Nothing planned" once', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: /Wednesday 11 November/ }))
    expect(await screen.findByText('Nothing planned')).toBeInTheDocument()
    expect(screen.getAllByText(/Nothing planned/)).toHaveLength(1)
    expect(screen.queryByText(/to plan an event/)).toBeNull()
    expect(document.querySelector('footer')).toBeNull()
  })
})
