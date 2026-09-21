import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { AVATAR_BUCKET, resolveAvatarUrl } from '@/lib/avatar-url'

/**
 * Render-time resolution of `profiles.avatar_url` into a URL that loads.
 *
 * `avatar-url.ts` holds the logic and says why (F-3: the bucket is private, the
 * stored string is a public-route URL, so every `<img src={profile.avatar_url}>`
 * is a broken image). What it deliberately does NOT hold is the React part —
 * signing is async, and four screens across three owners each need the same
 * effect. This is that effect, once, so adopting the fix is a two-line change
 * per screen rather than a copied `useEffect` per screen.
 *
 * Returns null until a URL is minted AND for every failure, which is the same
 * thing callers already handle: `null` renders the initials placeholder. A
 * broken image on a child's profile is a visible defect; a placeholder is not.
 *
 * ── Why the cancellation flag is not optional here
 *
 * A signed URL is minted asynchronously. Without the flag, switching accounts
 * (or any re-render that changes `stored`) can let an earlier signing settle
 * after a later one and paint the PREVIOUS account's photograph over the
 * current one. That is the same class of defect #48 fixes in Settings, and it
 * is worth more here: this string is a bearer token for a child's photograph.
 */
export function useAvatarUrl(stored: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    // Clear first. Keeping the previous URL while the next one signs would show
    // the old account's photo during the gap, which is the defect this guards.
    setUrl(null)

    if (!stored) return
    void resolveAvatarUrl(
      stored,
      (path, expiresIn) => supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, expiresIn),
      message => console.error('Avatar URL could not be signed:', message),
    ).then(signed => {
      if (active) setUrl(signed)
    })

    return () => { active = false }
  }, [stored])

  return url
}
