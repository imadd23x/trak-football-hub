/**
 * TRAK-346: Arc's stepper, adapted. By default only completed steps can be chosen, as Arc ships it (every other stepper
 * in the app, the Evaluation's too); with `jumpAhead`, any step but the current one can, ahead as well as back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Stepper } from '../stepper'

const STEPS = [{ id: 'a', label: 'Tactics & analysis' }, { id: 'b', label: 'Line-up and jobs' }, { id: 'c', label: 'Review & share' }]
afterEach(cleanup)

describe('Arc stepper: jumping ahead (TRAK-346)', () => {
  it('by default, a step ahead is not a choice', async () => {
    const onStepSelect = vi.fn()
    render(<Stepper steps={STEPS} current={1} onStepSelect={onStepSelect} label="Game plan" />)
    expect(screen.getByRole('button', { name: /^Review & share/ })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(screen.getByRole('button', { name: /^Review & share/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Tactics & analysis/ }))
    expect(onStepSelect.mock.calls).toEqual([[0]])
  })

  it('with jumpAhead, every step but the current one is a choice, and the arrow keys reach the steps ahead', async () => {
    const user = userEvent.setup()
    const onStepSelect = vi.fn()
    render(<Stepper steps={STEPS} current={1} onStepSelect={onStepSelect} label="Game plan" jumpAhead />)
    expect(screen.getByRole('button', { name: /^Line-up and jobs/ })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('button', { name: /^Review & share/ }))
    await user.click(screen.getByRole('button', { name: /^Tactics & analysis/ }))
    expect(onStepSelect.mock.calls).toEqual([[2], [0]])

    screen.getByRole('button', { name: /^Tactics & analysis/ }).focus()
    await user.keyboard('{End}')
    expect(screen.getByRole('button', { name: /^Review & share/ })).toHaveFocus()
  })
})
