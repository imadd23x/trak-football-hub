import { describe, it, expect, vi } from 'vitest'
import {
  avatarObjectPath,
  resolveAvatarUrl,
  AVATAR_URL_TTL_SECONDS,
  type AvatarSigner,
} from '../avatar-url'

/**
 * F-3. The `avatars` bucket is private; `getPublicUrl()` builds a URL only a
 * public bucket serves, and that dead string is persisted to
 * `profiles.avatar_url` and rendered by four profile screens.
 *
 * These execute the resolution logic directly rather than asserting on source,
 * which is the criticism Imad made of my K8 tests and which was fair. The
 * signer is injected, so the real failure modes — a signing error, a response
 * with no url, a throw — are exercised rather than described.
 */

const LIVE_LEGACY_URL =
  'https://xbykbqolvqyqmipikuae.supabase.co/storage/v1/object/public/avatars/' +
  '4658ae91-352c-41ac-8f15-ee8c0ea6d98c?t=1789737577701'
const LIVE_KEY = '4658ae91-352c-41ac-8f15-ee8c0ea6d98c'

describe('avatarObjectPath', () => {
  it('extracts the key from the URL actually stored in production', () => {
    // Not a synthetic example: this is the shape of the single non-null
    // avatar_url in the live database, cache-buster and all.
    expect(avatarObjectPath(LIVE_LEGACY_URL)).toBe(LIVE_KEY)
  })

  it('accepts a bare object key unchanged', () => {
    expect(avatarObjectPath(LIVE_KEY)).toBe(LIVE_KEY)
  })

  it('strips a cache-buster from a bare key', () => {
    expect(avatarObjectPath(`${LIVE_KEY}?t=123`)).toBe(LIVE_KEY)
  })

  it('tolerates a bucket-prefixed key rather than signing the wrong object', () => {
    expect(avatarObjectPath(`avatars/${LIVE_KEY}`)).toBe(LIVE_KEY)
    expect(avatarObjectPath(`/avatars/${LIVE_KEY}`)).toBe(LIVE_KEY)
  })

  it('reads a signed URL back to the same key', () => {
    const signed =
      'https://x.supabase.co/storage/v1/object/sign/avatars/' + LIVE_KEY + '?token=abc'
    expect(avatarObjectPath(signed)).toBe(LIVE_KEY)
  })

  it('returns null for nothing, so callers fall through to initials', () => {
    expect(avatarObjectPath(null)).toBeNull()
    expect(avatarObjectPath(undefined)).toBeNull()
    expect(avatarObjectPath('')).toBeNull()
    expect(avatarObjectPath('   ')).toBeNull()
  })

  it('returns null for a URL that is not an avatars object', () => {
    // A URL pointing at another bucket must not be signed as if it were an
    // avatar — that would mint a working link to someone else's object.
    expect(
      avatarObjectPath('https://x.supabase.co/storage/v1/object/public/reports/secret.pdf'),
    ).toBeNull()
    expect(avatarObjectPath('https://example.com/not-storage-at-all.png')).toBeNull()
  })

  it('decodes a percent-encoded key', () => {
    expect(
      avatarObjectPath('https://x.supabase.co/storage/v1/object/public/avatars/a%20b'),
    ).toBe('a b')
  })
})

describe('resolveAvatarUrl', () => {
  const ok: AvatarSigner = async (path, expiresIn) => ({
    data: { signedUrl: `https://signed.example/${path}?exp=${expiresIn}` },
    error: null,
  })

  it('signs the extracted key, not the stored string', async () => {
    const sign = vi.fn(ok)
    const url = await resolveAvatarUrl(LIVE_LEGACY_URL, sign)
    expect(sign).toHaveBeenCalledWith(LIVE_KEY, AVATAR_URL_TTL_SECONDS)
    expect(url).toContain(LIVE_KEY)
  })

  it('does not call the signer when there is nothing to sign', async () => {
    const sign = vi.fn(ok)
    expect(await resolveAvatarUrl(null, sign)).toBeNull()
    expect(sign).not.toHaveBeenCalled()
  })

  it('returns null and reports when signing errors', async () => {
    const onError = vi.fn()
    const failing: AvatarSigner = async () => ({ data: null, error: { message: 'Object not found' } })
    expect(await resolveAvatarUrl(LIVE_KEY, failing, onError)).toBeNull()
    expect(onError).toHaveBeenCalledWith('Object not found')
  })

  it('returns null when the signer resolves with no error AND no url', async () => {
    // The day's recurring class, in the one place it would be easiest to make
    // again: `!error` is not evidence of a url. Trusting it renders
    // `undefined` as an image source.
    const onError = vi.fn()
    const empty: AvatarSigner = async () => ({ data: null, error: null })
    expect(await resolveAvatarUrl(LIVE_KEY, empty, onError)).toBeNull()
    expect(onError).toHaveBeenCalledWith('signing returned no url')
  })

  it('returns null when the url is present but blank', async () => {
    const blank: AvatarSigner = async () => ({ data: { signedUrl: '   ' }, error: null })
    expect(await resolveAvatarUrl(LIVE_KEY, blank)).toBeNull()
  })

  it('survives a signer that throws', async () => {
    const onError = vi.fn()
    const boom: AvatarSigner = async () => { throw new Error('network down') }
    expect(await resolveAvatarUrl(LIVE_KEY, boom, onError)).toBeNull()
    expect(onError).toHaveBeenCalledWith('network down')
  })

  it('keeps the TTL short, because a signed url is a bearer token', async () => {
    // A signed URL to a child's photograph works for anyone holding the string,
    // with no session, until it expires. Minted per render, so a longer window
    // buys nothing but a longer leak.
    expect(AVATAR_URL_TTL_SECONDS).toBeLessThanOrEqual(60 * 60)
    expect(AVATAR_URL_TTL_SECONDS).toBeGreaterThan(0)
  })
})
