import { screen, waitFor, within } from '@testing-library/react'

/**
 * TRAK-157: the schedule's date and time are Arc pickers, driven the way a
 * coach does it: open the field, tap the day or the time.
 */

/** userEvent itself, or a userEvent.setup() instance. */
type User = { click: (element: Element) => Promise<void> }

/** "9:30" → "09:30", as the picker lists it: Trak's times are 24-hour (TRAK-627). */
export function shownTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Opens the time field named `label` ("Start", "Kickoff", "Meet time…") and picks `hhmm`. */
export async function pickTime(user: User, label: string | RegExp, hhmm: string) {
  const name = typeof label === 'string' ? new RegExp(`^${label}\\b`) : label
  await user.click(screen.getByRole('button', { name }))
  const list = await screen.findByRole('listbox')
  await user.click(within(list).getByRole('option', { name: shownTime(hhmm) }))
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

/** What the time field named `label` shows: "18:00", or its placeholder. */
export function timeShown(label: string | RegExp): string {
  const name = typeof label === 'string' ? new RegExp(`^${label}\\b`) : label
  const button = screen.getByRole('button', { name })
  // The button is named by its label and its value: read the value part.
  const valueId = (button.getAttribute('aria-labelledby') ?? '').split(' ')[1]
  return (document.getElementById(valueId)?.textContent ?? '').trim()
}

/** Opens the date field named `label` and picks `day` (YYYY-MM-DD), moving month by month to it. */
export async function pickDate(user: User, label: string, day: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${label}\\b`) }))
  const dialog = await screen.findByRole('dialog', { name: `${label} calendar` })
  for (let step = 0; step < 60; step++) {
    const cell = dialog.querySelector<HTMLElement>(`[data-present] [data-date="${day}"]`)
    if (cell) { await user.click(cell); break }
    // The shown grid's first day (it may lead in from the month before) says which way to go.
    const first = dialog.querySelector<HTMLElement>('[data-present] [data-date]')?.getAttribute('data-date') ?? ''
    await user.click(within(dialog).getByRole('button', { name: first < day ? 'Next month' : 'Previous month' }))
  }
  await waitFor(() => expect(screen.queryByRole('dialog', { name: `${label} calendar` })).toBeNull())
}

/** Opens the date field named `label`, runs `read` on its calendar, then closes it again. */
async function withCalendar<T>(user: User, label: string, read: (dialog: HTMLElement) => Promise<T>): Promise<T> {
  const trigger = screen.getByRole('button', { name: new RegExp(`^${label}\\b`) })
  await user.click(trigger)
  const dialog = await screen.findByRole('dialog', { name: `${label} calendar` })
  const result = await read(dialog)
  await user.click(trigger)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: `${label} calendar` })).toBeNull())
  return result
}

/** The day (YYYY-MM-DD) the date field named `label` holds, as its calendar marks it. */
export function dateHeld(user: User, label: string): Promise<string | null> {
  return withCalendar(user, label, async dialog =>
    dialog.querySelector('[data-present] [aria-selected="true"]')?.getAttribute('data-date') ?? null)
}

/** Whether the date field named `label` lets the coach pick `day` (paging month by month toward it). */
export function dateOffered(user: User, label: string, day: string): Promise<boolean> {
  return withCalendar(user, label, async dialog => {
    for (let step = 0; step < 60; step++) {
      const cell = dialog.querySelector<HTMLButtonElement>(`[data-present] [data-date="${day}"]`)
      if (cell) return !cell.disabled
      const first = dialog.querySelector<HTMLElement>('[data-present] [data-date]')?.getAttribute('data-date') ?? ''
      const nav = within(dialog).getByRole('button', { name: first < day ? 'Next month' : 'Previous month' })
      if (nav.getAttribute('aria-disabled') === 'true') return false
      await user.click(nav)
    }
    return false
  })
}
