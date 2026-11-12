import { expect, type Page } from '@playwright/test'

/** TRAK-424: Schedule has no "+" of its own. New event is the frame's "+" ("Quick add" on a phone or tablet, "Create" on a
 *  laptop), then More details, which opens the stepped sheet. */
export async function openNewEvent(page: Page) {
  await page.getByRole('button', { name: /^(Quick add|Create)$/ }).click()
  await page.getByRole('menuitem', { name: 'New event' }).click()
  await page.getByRole('button', { name: 'More details' }).click()
  // The quick form animates out as the sheet opens; both are named "New event", so wait until the quick form's button is gone.
  await expect(page.getByRole('button', { name: 'More details' })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'New event' })).toHaveCount(1)
  await expect(page.locator('[aria-label="Event steps"]')).toBeVisible()
}
