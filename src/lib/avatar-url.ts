/**
 * Resolving a stored avatar reference into a URL that actually loads.
 *
 * ── The defect this exists for (F-3)
 *
 * The `avatars` bucket was created public in April and set to `public = false`
 * on 26 May. `Settings.tsx` still calls `getPublicUrl()`, which builds a
 * `/storage/v1/object/public/avatars/<id>` URL — a route that only serves a
 * PUBLIC bucket — and persists it to `profiles.avatar_url`. Four profile
 * screens render that string in an `<img>`, so it is a broken image on every
 * one of them, and the upload itself succeeds so the toast says it worked.
 *
 * A private bucket needs a SIGNED url, minted per read and short-lived.
 *
 * ── Why this is a separate module rather than a fix in place
 *
 * The write lives in `Settings.tsx`, which has an open PR against it (#48), and
 * the four reads live in files owned by three different people. Changing all
 * five at once is the collision shape that has cost this repo three times in
 * two days. So the logic lands here first, fully tested, and each call site can
 * adopt it independently.
 *
 * ── Backward compatible on purpose
 *
 * `resolve()` accepts BOTH a bare storage path and a legacy public URL, so no
 * data migration is required and no call site has to be changed in step with
 * any other. The one row in production today holds a legacy URL; it resolves
 * correctly through the same path as a future bare key.
 */

/** Where avatars live. One bucket, one object per user, keyed by user id. */
export const AVATAR_BUCKET = 'avatars'

/**
 * How long a minted URL stays valid.
 *
 * Short on purpose. A signed URL is a bearer token for a child's photograph:
 * anyone holding the string can fetch it until it expires, with no session.
 * These are minted at render time, so the only thing a longer window buys is a
 * longer leak. An hour covers a page that sits open.
 */
export const AVATAR_URL_TTL_SECONDS = 60 * 60

/**
 * Pull the storage object key out of whatever is stored in `profiles.avatar_url`.
 *
 * Returns null when there is nothing usable, so callers fall through to their
 * initials placeholder rather than rendering a broken image.
 *
 * Handles, in order:
 *   - a bare object key, which is what should be stored going forward
 *   - a legacy `…/object/public/avatars/<key>` URL written by getPublicUrl()
 *   - a legacy `…/object/sign/avatars/<key>` URL, in case one was ever stored
 * and strips the `?t=` cache-buster that Settings appends.
 */
export function avatarObjectPath(stored: string | null | undefined): string | null {
  if (typeof stored !== 'string') return null
  const trimmed = stored.trim()
  if (!trimmed) return null

  // A stored value is only a URL if it parses as one. Anything else is treated
  // as a key, which is the forward-looking shape.
  let withoutQuery = trimmed
  let isUrl = false
  try {
    const url = new URL(trimmed)
    isUrl = url.protocol === 'http:' || url.protocol === 'https:'
    withoutQuery = isUrl ? url.pathname : trimmed
  } catch {
    // Not a URL. Fall through and treat it as a key, minus any cache-buster.
    const q = trimmed.indexOf('?')
    withoutQuery = q === -1 ? trimmed : trimmed.slice(0, q)
  }

  if (isUrl) {
    // `/storage/v1/object/public/avatars/<key>` or `…/object/sign/avatars/<key>`
    const marker = new RegExp(`/object/(?:public|sign|authenticated)/${AVATAR_BUCKET}/`)
    const match = withoutQuery.split(marker)
    if (match.length < 2) return null
    const key = decodeURIComponent(match[1]).replace(/^\/+/, '')
    return key || null
  }

  // A bare key. Tolerate a `avatars/` prefix, since it is an easy thing to
  // store by mistake and silently signing the wrong object is worse than
  // accepting both.
  const key = withoutQuery.replace(/^\/+/, '').replace(new RegExp(`^${AVATAR_BUCKET}/`), '')
  return key || null
}

/** The shape of a Supabase storage signer, narrowed to what is used here. */
export type AvatarSigner = (
  path: string,
  expiresIn: number,
) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>

/**
 * Turn a stored avatar reference into a URL that loads, or null.
 *
 * Null is returned for every failure — no such object, a signing error, a
 * response with no url — because the alternative is handing an `<img>` a string
 * that cannot load. A missing avatar renders as initials, which is a correct
 * and unremarkable state; a broken image is a visible defect on a child's
 * profile.
 *
 * The error is never swallowed silently: it is returned to the caller through
 * the `onError` hook so a screen can log or surface it, rather than the read
 * failing and looking identical to "this user has no photo".
 */
export async function resolveAvatarUrl(
  stored: string | null | undefined,
  sign: AvatarSigner,
  onError?: (message: string) => void,
): Promise<string | null> {
  const path = avatarObjectPath(stored)
  if (!path) return null

  let result: Awaited<ReturnType<AvatarSigner>>
  try {
    result = await sign(path, AVATAR_URL_TTL_SECONDS)
  } catch (err) {
    onError?.(err instanceof Error ? err.message : String(err))
    return null
  }

  // Absence of an error is not evidence of a url. createSignedUrl can resolve
  // with data null and error null for an object that is not there, and a caller
  // trusting `!error` would then render `undefined` as an image source.
  if (result?.error) {
    onError?.(result.error.message)
    return null
  }
  const signed = result?.data?.signedUrl
  if (typeof signed !== 'string' || !signed.trim()) {
    onError?.('signing returned no url')
    return null
  }
  return signed
}
