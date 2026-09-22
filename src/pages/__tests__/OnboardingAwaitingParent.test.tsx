/**
 * Every player under the consent threshold (18 since #80) finishes signup on
 * this screen. It said "Your account is created. We've asked your parent or
 * guardian at …". At that moment neither is true:
 *   - for a duplicate email, signUp returns an obfuscated user and nothing is
 *     created or sent;
 *   - for a genuinely new account, the parent invite is created and mailed only
 *     in provisioning, on the player's first sign-in after confirming their email
 *     (AuthContext → provision_my_profile → send-parent-invite).
 * A child who never signs in again believed their parent had been asked.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AwaitingParentScreen } from '../OnboardingPage'

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ signUp: vi.fn() }) }))
afterEach(cleanup)

const render_ = () => render(<AwaitingParentScreen email="kid@example.test" parentEmail="guardian@example.test" />)
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? ''

describe('AwaitingParentScreen says only what is true at signup', () => {
  it('does not claim the account exists or that the parent has been asked', () => {
    render_()
    expect(text()).not.toMatch(/account is created/i)
    expect(text()).not.toMatch(/we('|’)ve asked/i)
  })

  it('tells the child the steps that actually trigger the parent request', () => {
    render_()
    expect(text()).toMatch(/confirm.*kid@example\.test/i)
    expect(text()).toMatch(/signed in/i)
    // The parent's address is still shown, as what happens next.
    expect(screen.getByText('guardian@example.test')).toBeInTheDocument()
    expect(text()).toMatch(/signed in.*(ask|email).*(parent|guardian)/i)
  })
})
