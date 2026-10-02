import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/integrations/supabase/client'

/* TRAK-104 (J3): when a guardian resets a child's password, the server ends
   every session of that child login (end_child_login_sessions). An app already
   open on another device still holds an access token that works for up to an
   hour, so for a signed-in player this asks whether its session still exists
   every 30 s and on returning to the tab, and signs out locally the moment the
   answer is "no". The route guard then shows sign-in. A failed check, or
   "unknown" (a token without a session id), changes nothing: the next good
   check decides. Supabase documents this check for a session that has ended. */

const CHECK_EVERY_MS = 30_000

export function PlayerSessionWatcher() {
  const { user, profile } = useAuth()
  const userId = profile?.role === 'player' ? user?.id : undefined

  useEffect(() => {
    if (!userId) return
    let stopped = false

    const check = async () => {
      try {
        // `as never`: the generated types predate this migration.
        const { data, error } = await supabase.rpc('my_session_is_live' as never)
        if (stopped || error || data !== false) return
        // Auth answers 403 session_not_found for the ended session, which the
        // SDK accepts before clearing the stored login. If the call itself
        // fails (offline), the login stays, so keep watching: the next check
        // signs out again.
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
        if (!signOutError) stopped = true
      } catch { /* offline or aborted: the next check decides */ }
    }

    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    void check()
    const timer = setInterval(() => { void check() }, CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId])

  return null
}
