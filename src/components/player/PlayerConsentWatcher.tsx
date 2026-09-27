import { useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/integrations/supabase/client'
import { reloadPage } from '@/lib/reload-page'

/* TRAK-13 (G6) / TRAK-6 (J6): withdrawal "takes effect immediately, including
   for sessions that are already open" (MVP J2). The database refuses a fresh
   read after withdrawal, but an open player screen only re-reads on the hourly
   token refresh. So for a signed-in player this re-checks consent every 30 s
   and on returning to the tab, and when it goes from active to withdrawn it
   reloads: every screen re-reads, and nothing the parent withdrew stays up.
   A failed or unreadable check changes nothing; the next good one decides. */

const CHECK_EVERY_MS = 30_000

export function PlayerConsentWatcher({ onWithdrawn = reloadPage }: { onWithdrawn?: () => void }) {
  const { user, profile } = useAuth()
  const userId = profile?.role === 'player' ? user?.id : undefined
  // A token refresh re-renders with a new callback; only a new account may
  // restart the watch, or it would forget that consent was active.
  const withdrawn = useRef(onWithdrawn)
  withdrawn.current = onWithdrawn

  useEffect(() => {
    if (!userId) return
    let stopped = false
    // What the last good check said for this account: null until one lands.
    let required: boolean | null = null

    const check = async () => {
      try {
        // `as never`: the generated types predate the consent migration.
        const { data, error } = await supabase.rpc('my_consent_status' as never)
        if (stopped || error || !data || typeof data !== 'object') return
        const now = (data as { required?: unknown }).required
        if (typeof now !== 'boolean') return
        const wasActive = required === false
        required = now
        if (wasActive && now) {
          stopped = true
          withdrawn.current()
        }
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
