import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { AVATAR_BUCKET, resolveAvatarUrl, type AvatarSigner } from '@/lib/avatar-url'

const defaultSigner: AvatarSigner = (path, expiresIn) =>
  supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, expiresIn)

const logError = (message: string) => console.error('[avatar] could not sign stored avatar:', message)

/**
 * A URL an <img> can actually load for `profiles.avatar_url`, or null.
 *
 * Never the stored value itself. The `avatars` bucket is private, and the
 * public route answers a private bucket exactly as it answers one that does not
 * exist ("Bucket not found", HTTP 400, measured 21 Sep). After #48 the stored
 * value is a bare object key, which as an image source resolves against the
 * SPA rewrite and loads index.html. Both are broken images; this signs the key
 * via resolveAvatarUrl (which also accepts the legacy public-URL shape).
 *
 * Null while signing and on any failure, so callers show their placeholder
 * instead of a broken image.
 */
export function useAvatarUrl(
  stored: string | null | undefined,
  sign: AvatarSigner = defaultSigner,
  onError: (message: string) => void = logError,
): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    // A slow signature for a previous value must not overwrite the current one.
    let current = true
    setUrl(null)
    if (stored) {
      resolveAvatarUrl(stored, sign, onError).then(signed => { if (current) setUrl(signed) })
    }
    return () => { current = false }
    // sign/onError are injection points for tests; a caller passing inline
    // functions must not re-sign on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  return url
}
