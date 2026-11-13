import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect } from 'vitest'

/** TRAK-275: a Schedule card's Cancel or Delete is an icon in its button group, named "Cancel <title>". */
export async function chooseCardAction(title: string, action: 'Cancel' | 'Delete') {
  await userEvent.click(screen.getByRole('button', { name: `${action} ${title}` }))
}

/** Which of Cancel and Delete a card offers. */
export function endActions(title: string): string[] {
  return (['Cancel', 'Delete'] as const).filter(action => screen.queryByRole('button', { name: `${action} ${title}` }))
}

/** TRAK-424: Schedule has no "+" of its own. New event is the frame's "+" (a phone's "Quick add"), then More details. */
export async function openNewEvent() {
  await userEvent.click(await screen.findByRole('button', { name: 'Quick add' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'New event' }))
  await userEvent.click(await screen.findByRole('button', { name: 'More details' }))
  // The quick form closes as the stepped sheet opens; both are named "New event".
  await waitFor(() => expect(document.querySelector('[aria-label="Event steps"]')).not.toBeNull())
  await waitFor(() => expect(screen.getAllByRole('dialog', { name: 'New event' })).toHaveLength(1))
}
