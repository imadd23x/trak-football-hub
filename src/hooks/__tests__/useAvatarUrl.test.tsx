import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The live shape this exists for: a private bucket plus a stored PUBLIC-route
// URL. Every assertion below starts from that string, because that is what all
// four rows in production actually hold.
const LIVE_LEGACY_URL =
  'https://xbykbqolvqyqmipikuae.supabase.co/storage/v1/object/public/avatars/user-1?t=1758000000000'
const SIGNED = 'https://xbykbqolvqyqmipikuae.supabase.co/storage/v1/object/sign/avatars/user-1?token=abc'

const storage = vi.hoisted(() => ({ createSignedUrl: vi.fn() }))
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: storage.createSignedUrl }) } },
}))

const { useAvatarUrl } = await import('../useAvatarUrl')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('useAvatarUrl', () => {
  it('signs the object behind a legacy public URL', async () => {
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null })
    const { result } = renderHook(() => useAvatarUrl(LIVE_LEGACY_URL))

    await waitFor(() => expect(result.current).toBe(SIGNED))
    // The cache-buster and the public route must be stripped: signing
    // `user-1?t=…` as a key would sign an object that does not exist.
    expect(storage.createSignedUrl).toHaveBeenCalledWith('user-1', expect.any(Number))
  })

  // This is the whole defect. Before this hook the component rendered the
  // stored string directly, so the assertion that matters is that the resolved
  // value is NOT it.
  it('never returns the stored public URL itself', async () => {
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null })
    const { result } = renderHook(() => useAvatarUrl(LIVE_LEGACY_URL))

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).not.toContain('/object/public/')
  })

  it('falls back to the placeholder when signing fails', async () => {
    storage.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Object not found' } })
    const { result } = renderHook(() => useAvatarUrl(LIVE_LEGACY_URL))

    await waitFor(() => expect(storage.createSignedUrl).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })

  it('does not sign anything when there is no stored avatar', () => {
    const { result } = renderHook(() => useAvatarUrl(null))
    expect(result.current).toBeNull()
    expect(storage.createSignedUrl).not.toHaveBeenCalled()
  })

  // Kills the mutation that drops `setUrl(null)` at the top of the effect.
  // Without it the previous account's photograph stays painted while the next
  // one signs.
  it('clears the previous photo immediately when the account changes', async () => {
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null })
    const { result, rerender } = renderHook(({ stored }) => useAvatarUrl(stored), {
      initialProps: { stored: LIVE_LEGACY_URL as string | null },
    })
    await waitFor(() => expect(result.current).toBe(SIGNED))

    // Never resolves: the next account's URL is still in flight.
    storage.createSignedUrl.mockReturnValue(new Promise(() => {}))
    rerender({ stored: LIVE_LEGACY_URL.replace('user-1', 'user-2') })

    expect(result.current).toBeNull()
  })

  // Kills the mutation that drops the `active` cancellation flag. A slow first
  // signing settling after a fast second one would otherwise paint the OLD
  // account's photograph over the current one.
  it('ignores a stale signing that settles after the account changed', async () => {
    let settleFirst!: (v: { data: { signedUrl: string } | null; error: null }) => void
    storage.createSignedUrl.mockReturnValueOnce(new Promise(resolve => { settleFirst = resolve }))

    const { result, rerender } = renderHook(({ stored }) => useAvatarUrl(stored), {
      initialProps: { stored: LIVE_LEGACY_URL as string | null },
    })

    const second = 'https://x.supabase.co/storage/v1/object/sign/avatars/user-2?token=def'
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: second }, error: null })
    rerender({ stored: LIVE_LEGACY_URL.replace('user-1', 'user-2') })
    await waitFor(() => expect(result.current).toBe(second))

    // The first account's signing now comes back. It must be discarded.
    settleFirst({ data: { signedUrl: 'https://x.supabase.co/STALE-FIRST-ACCOUNT' }, error: null })
    await new Promise(r => setTimeout(r, 0))
    expect(result.current).toBe(second)
  })
})
