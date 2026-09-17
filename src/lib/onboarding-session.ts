import { createClient, type Session } from '@supabase/supabase-js';
import { supabase, SUPABASE_ANON_KEY, SUPABASE_FUNCTIONS_URL } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

const supabaseUrl = SUPABASE_FUNCTIONS_URL.replace(/\/functions\/v1$/, '');

/** Keep an onboarding operation bound to the account that started it. */
export async function createOnboardingSession(session: Session) {
  const accessToken = session.access_token;
  // Fetch metadata from Auth, rather than trusting cached browser metadata.
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error) throw error;
  if (!data.user || data.user.id !== session.user.id) {
    throw new Error('Your account changed. Please sign in again to finish setup.');
  }

  // The SDK's accessToken option never reads or refreshes the shared browser
  // session. An in-flight request therefore cannot acquire another user's JWT.
  const client = createClient<Database>(supabaseUrl, SUPABASE_ANON_KEY, {
    accessToken: async () => accessToken,
  });

  return {
    user: data.user,
    client,
    async clearPendingProfile() {
      // auth.updateUser uses the mutable shared session. Use the captured JWT
      // for this one Auth request as well; only this metadata key is merged.
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: { trak_onboarding: null } }),
      });
      if (!response.ok) throw new Error('Could not clear completed onboarding metadata.');
    },
  };
}

export type OnboardingSession = Awaited<ReturnType<typeof createOnboardingSession>>;
