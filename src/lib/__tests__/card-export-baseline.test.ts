import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Exported cards drew every line of text too low, by an amount proportional to
// font size: the 30px name and academy were sliced along their bottom edge by
// overflow:hidden, "74" landed on "MIDFIELDER · U15", "SILVER TIER" sat on the
// bottom of its pill. None of it appears on screen, only in the shared PNG.
//
// Cause: html2canvas measures a font's baseline by putting a 1×1 <img> inline
// after sample text and reading its offsetTop (FontMetrics.parseMetrics).
// Tailwind's preflight makes every img `display: block`, so the probe drops to
// its own line and the "baseline" comes out as a whole line height. The
// measurement runs in the LIVE document, not the clone, so onclone cannot fix it.
//
// These tests pin the fix: while html2canvas runs, its probe image is inline;
// before and after, nothing on the page has changed.

// The probe html2canvas 1.4.1 creates. If an upgrade changes it, the first test
// fails, which is the point: the selector would silently stop matching.
const PROBE_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const seen: { probeDisplay: string; realImgDisplay: string }[] = []
let fail = false

vi.mock('html2canvas', () => ({
  default: vi.fn(async () => {
    const probe = document.createElement('img')
    probe.src = PROBE_SRC
    const real = document.createElement('img')
    real.src = 'https://example.test/crest.png'
    document.body.append(probe, real)
    seen.push({ probeDisplay: getComputedStyle(probe).display, realImgDisplay: getComputedStyle(real).display })
    probe.remove(); real.remove()
    if (fail) throw new Error('synthetic capture failure')
    return { toBlob: (cb: (b: Blob) => void) => cb(new Blob(['png'], { type: 'image/png' })) }
  }),
}))

// What Tailwind's preflight does to every image on the page.
const preflight = document.createElement('style')
preflight.textContent = 'img { display: block; }'

const probeStyleActive = () => {
  const probe = document.createElement('img')
  probe.src = PROBE_SRC
  document.body.append(probe)
  const display = getComputedStyle(probe).display
  probe.remove()
  return display !== 'block'
}

beforeEach(() => { seen.length = 0; fail = false; document.head.append(preflight) })
afterEach(() => { preflight.remove() })

describe('captureElementToPng — html2canvas measures baselines correctly', () => {
  it('uses the probe src this html2canvas version actually creates', () => {
    const text = readFileSync(join(process.cwd(), 'node_modules/html2canvas/dist/html2canvas.js'), 'utf8')
    expect(text).toContain(`SMALL_IMAGE = '${PROBE_SRC}'`)
  })

  it('makes the probe inline during capture, and only the probe', async () => {
    const { captureElementToPng } = await import('@/lib/card-export')
    expect(probeStyleActive()).toBe(false) // control: preflight is really in force
    await captureElementToPng(document.createElement('div'))
    expect(seen).toEqual([{ probeDisplay: 'inline', realImgDisplay: 'block' }])
  })

  it('removes the override afterwards', async () => {
    const { captureElementToPng } = await import('@/lib/card-export')
    await captureElementToPng(document.createElement('div'))
    expect(probeStyleActive()).toBe(false)
  })

  it('removes the override when the capture throws', async () => {
    const { captureElementToPng } = await import('@/lib/card-export')
    fail = true
    expect(await captureElementToPng(document.createElement('div'))).toBeNull()
    expect(seen).toHaveLength(1)
    expect(probeStyleActive()).toBe(false)
  })
})
