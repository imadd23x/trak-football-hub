import html2canvas from 'html2canvas'

/**
 * Turning a card on screen into an image someone can send.
 *
 * F-4. Two implementations existed and only one produced an image.
 * `PlayerPassport` captured with html2canvas and shared `{ files: [file] }`.
 * `PlayerEvolutionCard` called `navigator.share({ title, text })` with no
 * `files` key at all, so the OS share sheet had nothing but a string to hand to
 * Messages and the player got their stats as plain text.
 *
 * The capture is genuinely fiddly — fonts have to be loaded, a fit-to-viewport
 * transform has to come off first, scroll position has to be compensated — so
 * it lives here once rather than being copied into the second screen. Copying
 * it is what produced four band ladders.
 */

export interface CaptureOptions {
  /** Canvas background. Transparent PNGs look broken in most share sheets. */
  background?: string
  /** Device-pixel multiplier. 3 is what the passport ships. */
  scale?: number
  /** Force this CSS width, so the export is identical on every device. */
  width?: number
  /**
   * An ancestor carrying a fit-to-viewport `transform`. html2canvas renders the
   * transformed geometry, so the transform comes off for the capture and goes
   * back afterwards — including when the capture throws.
   */
  unscale?: HTMLElement | null
}

/** Renders `el` to a PNG blob, or null if it could not be captured. */
export async function captureElementToPng(
  el: HTMLElement | null,
  opts: CaptureOptions = {},
): Promise<Blob | null> {
  if (!el) return null
  const { background = '#0D0D0F', scale = 3, width, unscale } = opts
  const previousTransform = unscale?.style.transform ?? ''
  try {
    if (unscale) unscale.style.transform = 'none'
    // Without this the card can rasterise in a fallback face.
    if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready
    const canvas = await html2canvas(el, {
      backgroundColor: background,
      scale,
      useCORS: true,
      logging: false,
      scrollX: 0,
      scrollY: typeof window === 'undefined' ? 0 : -window.scrollY,
      ...(width ? { width, windowWidth: width } : {}),
    })
    return await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/png'))
  } catch {
    return null
  } finally {
    if (unscale) unscale.style.transform = previousTransform
  }
}

/**
 * What happened, rather than a boolean. `cancelled` is the user closing the
 * share sheet, which is not a failure and must not raise an error toast — the
 * old code caught AbortError by name in three separate places to avoid exactly
 * that, and the Evolution Card's copy of the logic got it right only by luck.
 */
export type ShareOutcome = 'shared' | 'saved' | 'cancelled' | 'failed'

/**
 * Share the image if the platform can share files, otherwise save it.
 *
 * `navigator.share` exists on desktop Chrome but rejects files, so the decision
 * is made with `canShare({ files })` rather than by the presence of `share`.
 * That distinction is the actual F-4 bug in miniature.
 */
export async function shareOrSaveImage(
  blob: Blob | null,
  { filename, title }: { filename: string; title?: string },
): Promise<ShareOutcome> {
  if (!blob) return 'failed'
  const file = new File([blob], filename, { type: 'image/png' })

  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], ...(title ? { title } : {}) })
      return 'shared'
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') return 'cancelled'
      // Fall through and save it: a share that failed for any other reason
      // should still leave the player holding their card.
    }
  }

  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return 'saved'
  } catch {
    return 'failed'
  }
}
