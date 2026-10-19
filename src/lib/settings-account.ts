import { supabase } from '@/integrations/supabase/client'
import { createOnboardingSession } from './onboarding-session'

/** Recheck the shared session before a later step; never retarget a mutation. */
export async function assertSettingsAccount(expectedUserId: string, isCurrent: () => boolean) {
  if (!isCurrent()) throw new Error('Your account changed. Please try again.')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!isCurrent() || data.session?.user.id !== expectedUserId) {
    throw new Error('Your account changed. Please try again.')
  }
  return data.session
}

export async function getSettingsAccount(expectedUserId: string, isCurrent: () => boolean) {
  const session = await assertSettingsAccount(expectedUserId, isCurrent)
  const account = await createOnboardingSession(session)
  await assertSettingsAccount(expectedUserId, isCurrent)
  return account
}
