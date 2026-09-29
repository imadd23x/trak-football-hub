import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { fetchAwaitingConsent } from '@/lib/parent-consent'
import { reloadPage } from '@/lib/reload-page'

/* TRAK-88 (G6): the guardian side of PlayerConsentWatcher. Withdrawal "takes
   effect immediately, including for sessions that are already open" (MVP J2).
   The database hides a withdrawn child's coach records from their linked
   parents (#174), but a second guardian's open app keeps what it shows. So for
   a signed-in parent this re-checks, every 30 s and on returning to the tab,
   which linked children need consent (the same test the database uses), and
   reloads once when a child it knew as consented starts to need it. A failed
   or malformed check changes nothing; the next good one decides. */

const CHECK_EVERY_MS = 30_000

export function ParentConsentWatcher({ onWithdrawn = reloadPage }: { onWithdrawn?: () => void }) {
  const { parentId, children, loading } = useParentChildren()
  const { pathname } = useLocation()
  const client = useQueryClient()
  // Start once the children list has loaded: a check before it would know no
  // child as consented, and would miss a withdrawal that comes next. The
  // consent page shows no child records and runs its own reads of this list.
  const watching = loading || pathname === '/parent/consent' ? null : parentId
  // A refreshed children list or callback must not restart the watch, or it
  // would forget which children were consented.
  const withdrawn = useRef(onWithdrawn)
  withdrawn.current = onWithdrawn
  const shown = useRef(children)
  shown.current = children

  useEffect(() => {
    if (!watching) return
    let stopped = false
    // Children the last good check saw as consented.
    let consented = new Set<string>()

    const check = async () => {
      try {
        // Home reads the same list: sharing its cache entry makes a check and
        // Home's own read one request.
        const pending = await client.fetchQuery({
          queryKey: ['parent', watching, 'awaiting-consent'],
          queryFn: ({ signal }) => fetchAwaitingConsent(signal),
          staleTime: 0,
          networkMode: 'always',
        })
        if (stopped) return
        const awaiting = new Set(pending.map(child => child.player_user_id))
        if ([...consented].some(id => awaiting.has(id))) {
          stopped = true
          withdrawn.current()
          return
        }
        const linked = shown.current.map(child => child.id.toLowerCase())
        consented = new Set([...consented, ...linked].filter(id => !awaiting.has(id)))
      } catch { /* offline or malformed: the next check decides */ }
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
  }, [watching, client])

  return null
}
