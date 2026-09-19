import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shareOrSaveImage } from '@/lib/card-export'

// F-4. The Evolution Card called navigator.share({ title, text }) — no `files`
// key — so the share sheet got a sentence and Messages pasted the card as
// writing. These cover the decision that actually went wrong: `navigator.share`
// exists on desktop Chrome but rejects files, so the branch has to be taken on
// canShare({ files }), not on share being present.

const blob = () => new Blob(['x'], { type: 'image/png' })

describe('shareOrSaveImage', () => {
  let clicked: string[]
  let originalNavigator: PropertyDescriptor | undefined

  beforeEach(() => {
    clicked = []
    originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    // jsdom implements neither, so they are assigned rather than spied on.
    ;(URL as unknown as Record<string, unknown>).createObjectURL = () => 'blob:fake'
    ;(URL as unknown as Record<string, unknown>).revokeObjectURL = () => {}
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'a') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      return { href: '', download: '', click: () => clicked.push('a') } as unknown as HTMLElement
    }) as typeof document.createElement)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  })

  const withNavigator = (nav: Partial<Navigator>) =>
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true })

  it('shares a FILE, never a string', async () => {
    let shared: ShareData | undefined
    withNavigator({
      canShare: () => true,
      share: async (data: ShareData) => { shared = data },
    } as Partial<Navigator>)

    expect(await shareOrSaveImage(blob(), { filename: 'card.png', title: 'T' })).toBe('shared')
    expect(shared?.files).toHaveLength(1)
    expect(shared?.files?.[0].name).toBe('card.png')
    // The whole defect: text instead of an image.
    expect(shared?.text).toBeUndefined()
  })

  it('saves instead when share exists but cannot take files — desktop Chrome', async () => {
    const share = vi.fn()
    withNavigator({ canShare: () => false, share } as Partial<Navigator>)

    expect(await shareOrSaveImage(blob(), { filename: 'card.png' })).toBe('saved')
    expect(share).not.toHaveBeenCalled()
    expect(clicked).toEqual(['a'])
  })

  it('saves when the platform cannot share at all', async () => {
    withNavigator({} as Partial<Navigator>)
    expect(await shareOrSaveImage(blob(), { filename: 'card.png' })).toBe('saved')
    expect(clicked).toEqual(['a'])
  })

  it('reports a closed share sheet as cancelled, not as a failure', async () => {
    withNavigator({
      canShare: () => true,
      share: async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }) },
    } as Partial<Navigator>)

    // A player dismissing the sheet must not see "could not share".
    expect(await shareOrSaveImage(blob(), { filename: 'card.png' })).toBe('cancelled')
    expect(clicked).toEqual([])
  })

  it('falls back to saving when sharing fails for a real reason', async () => {
    withNavigator({
      canShare: () => true,
      share: async () => { throw new Error('NotAllowedError') },
    } as Partial<Navigator>)

    expect(await shareOrSaveImage(blob(), { filename: 'card.png' })).toBe('saved')
    expect(clicked).toEqual(['a'])
  })

  it('reports failure when there is nothing to share', async () => {
    withNavigator({ canShare: () => true, share: async () => {} } as Partial<Navigator>)
    // captureElementToPng returns null when html2canvas throws. Treating that
    // as success is how an empty share sheet would look like a working one.
    expect(await shareOrSaveImage(null, { filename: 'card.png' })).toBe('failed')
  })
})
