import { expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/* TRAK-324: the coach's squad switcher (Arc's team switcher: in the sidebar on a laptop, at the top of a phone page).
   Its trigger reads "Squad: U16. 9 players"; All is "All squads". */

const shown = (squad: string) => squad === 'All' ? 'All squads' : squad

/** The switcher's trigger, once the coach's squads are known. */
export const squadSwitcher = () => screen.findByRole('button', { name: /^Squad: / }, { timeout: 5000 })

/** The squads it offers, in order: "All squads", then each squad. */
export async function squadsOffered() {
  await userEvent.click(await squadSwitcher())
  // Each row holds its tile, its name and its size: the name is the span that reads only "All squads" or a squad.
  const names = within(await screen.findByRole('listbox')).getAllByRole('option')
    .map(option => [...option.querySelectorAll('span')].map(span => span.textContent ?? '').find(text => /^(All squads|U\d+)$/.test(text)) ?? '')
  await userEvent.keyboard('{Escape}')
  return names
}

/** Picks a squad, or 'All', and waits until the switcher shows it. */
export async function pickSquad(squad: string) {
  await userEvent.click(await squadSwitcher())
  const list = await screen.findByRole('listbox')
  await userEvent.click(within(list).getByRole('option', { name: new RegExp(`^${shown(squad)}\\b`) }))
  await waitFor(() => expect(screen.getByRole('button', { name: /^Squad: / })).toHaveAccessibleName(new RegExp(`^Squad: ${shown(squad)}\\.`)), { timeout: 5000 })
}

/** The squad the switcher shows. */
export async function expectSquadPicked(squad: string) {
  await waitFor(async () => expect(await squadSwitcher()).toHaveAccessibleName(new RegExp(`^Squad: ${shown(squad)}\\.`)), { timeout: 5000 })
}
