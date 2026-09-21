import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAvatarUrl } from '../use-avatar-url'
import type { AvatarSigner } from '@/lib/avatar-url'

const KEY = '22222222-2222-4222-8222-222222222222'
const signed = (path: string) => `https://test.supabase.co/storage/v1/object/sign/avatars/${path}?token=t`
const okSigner = () => vi.fn<AvatarSigner>(async path => ({ data: { signedUrl: signed(path) }, error: null }))

describe('useAvatarUrl — never hands an <img> the stored value', () => {
  it('signs a bare object key', async () => {
    const sign = okSigner()
    const { result } = renderHook(() => useAvatarUrl(KEY, sign))
    await waitFor(() => expect(result.current).toBe(signed(KEY)))
    expect(sign).toHaveBeenCalledWith(KEY, expect.any(Number))
  })

  // Every avatar in production today is this shape, and the public route
  // answers "Bucket not found" for a private bucket, so rendering it raw is broken.
  it('signs the key inside a legacy public URL rather than rendering the URL', async () => {
    const sign = okSigner()
    const legacy = `https://x.supabase.co/storage/v1/object/public/avatars/${KEY}?t=123`
    const { result } = renderHook(() => useAvatarUrl(legacy, sign))
    await waitFor(() => expect(result.current).toBe(signed(KEY)))
    expect(result.current).not.toContain('/object/public/')
  })

  it('returns null without signing when nothing is stored', async () => {
    const sign = okSigner()
    const { result } = renderHook(() => useAvatarUrl(null, sign))
    await new Promise(r => setTimeout(r, 0))
    expect(result.current).toBeNull()
    expect(sign).not.toHaveBeenCalled()
  })

  it('returns null, not the stored value, when signing fails', async () => {
    const sign = vi.fn<AvatarSigner>(async () => ({ data: null, error: { message: 'Object not found' } }))
    const onError = vi.fn()
    const { result } = renderHook(() => useAvatarUrl(KEY, sign, onError))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Object not found'))
    expect(result.current).toBeNull()
  })

  // A slow signature for the OLD value must not overwrite the new one.
  it('ignores a signature that resolves after the stored value changed', async () => {
    let releaseOld!: () => void
    const sign = vi.fn<AvatarSigner>(path => path === 'old'
      ? new Promise(resolve => { releaseOld = () => resolve({ data: { signedUrl: signed('old') }, error: null }) })
      : Promise.resolve({ data: { signedUrl: signed(path) }, error: null }))
    const { result, rerender } = renderHook(({ stored }) => useAvatarUrl(stored, sign), { initialProps: { stored: 'old' } })
    rerender({ stored: KEY })
    await waitFor(() => expect(result.current).toBe(signed(KEY)))
    releaseOld()
    await new Promise(r => setTimeout(r, 0))
    expect(result.current).toBe(signed(KEY))
  })

  it('clears a previous avatar when the stored value is removed', async () => {
    const sign = okSigner()
    const { result, rerender } = renderHook(({ stored }) => useAvatarUrl(stored, sign), { initialProps: { stored: KEY as string | null } })
    await waitFor(() => expect(result.current).toBe(signed(KEY)))
    rerender({ stored: null })
    await waitFor(() => expect(result.current).toBeNull())
  })
})
