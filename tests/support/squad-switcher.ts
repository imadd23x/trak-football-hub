import { expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/* TRAK-324: the coach's squad switcher (Arc's team switcher: in the sidebar on a laptop; TRAK-376, in the side menu on a
   phone, which the page's avatar opens). Its trigger reads "Squad: U16. 9 players"; All is "All squads". */

const shown = (squad: string) => squad === 'All' ? 'All squads' : squad

/** The switcher's trigger, once the coach's squads are known. On a phone it opens the side menu first. */
export async function squadSwitcher() {
  await waitFor(() => expect(screen.queryAllByRole('button', { name: /^Squad: |^Open menu$/ }).length).toBeGreaterThan(0), { timeout: 5000 })
  if (!screen.queryByRole('button', { name: /^Squad: / })) await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
  return screen.findByRole('button', { name: /^Squad: / }, { timeout: 5000 })
}

/** A phone's side menu closes again, so the page under it can be read. */
async function closeMenu() {
  const close = screen.queryByRole('button', { name: 'Close menu' })
  if (close) await userEvent.click(close)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull(), { timeout: 5000 })
}

/** The squads it offers, in order: "All squads", then each squad. */
export async function squadsOffered() {
  await userEvent.click(await squadSwitcher())
  // Each row holds its tile, its name and its size: the name is the span that reads only "All squads" or a squad.
  const names = within(await screen.findByRole('listbox')).getAllByRole('option')
    .map(option => [...option.querySelectorAll('span')].map(span => span.textContent ?? '').find(text => /^(All squads|U\d+)$/.test(text)) ?? '')
  await userEvent.keyboard('{Escape}')
  await closeMenu()
  return names
}

/** Picks a squad, or 'All', and waits until the switcher shows it. */
export async function pickSquad(squad: string) {
  await userEvent.click(await squadSwitcher())
  const list = await screen.findByRole('listbox')
  await userEvent.click(within(list).getByRole('option', { name: new RegExp(`^${shown(squad)}\\b`) }))
  await waitFor(() => expect(screen.getByRole('button', { name: /^Squad: / })).toHaveAccessibleName(new RegExp(`^Squad: ${shown(squad)}\\.`)), { timeout: 5000 })
  await closeMenu()
}

/** The squad the switcher shows. */
export async function expectSquadPicked(squad: string) {
  await waitFor(async () => expect(await squadSwitcher()).toHaveAccessibleName(new RegExp(`^Squad: ${shown(squad)}\\.`)), { timeout: 5000 })
  await closeMenu()
}
