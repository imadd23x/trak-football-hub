import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { AVATAR_BUCKET, AVATAR_URL_TTL_SECONDS, resolveAvatarUrl } from '@/lib/avatar-url'

/** The query every own-photo reader shares, so one page signs once; invalidate it after the photo changes. */
export const OWN_AVATAR_KEY = 'own-avatar'

/**
 * TRAK-460: a coach's own photo as a URL an <img> can load, or null (initials). Only a coach ever has one: the database
 * refuses every other role a photo, so for them this asks for nothing. The signed URL lasts an hour (AVATAR_URL_TTL_SECONDS),
 * so it is cached for less than that. A failed signing is null, never a broken image.
 */
export function useOwnAvatarUrl(): string | null {
  const { user, profile } = useAuth()
  const stored = profile?.role === 'coach' ? profile.avatar_url : null
  const query = useQuery({
    queryKey: [OWN_AVATAR_KEY, user?.id, stored],
    enabled: !!user && !!stored,
    staleTime: (AVATAR_URL_TTL_SECONDS - 600) * 1000,
    queryFn: () => resolveAvatarUrl(stored, (path, expiresIn) => supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, expiresIn),
      message => console.error('[avatar] could not sign the coach photo:', message)),
  })
  return stored ? query.data ?? null : null
}
