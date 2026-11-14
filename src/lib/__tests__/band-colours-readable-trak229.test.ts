/**
 * TRAK-458 (Kostas, 13 Nov, "full spectrum"; before: TRAK-229's greens and clays): every band has its own bright hue,
 * and every band colour works on Trak's light screens. Black words on a band's fill (a pill) at least 4.5:1; its edge
 * (`border`) at least 3:1 on the screen and on a white card, so a light fill still reads as a shape; a band word in
 * colour (`text`) at least 4.5:1 there and on its own tint; Trak's ink on every tint well above 4.5:1. Any two
 * neighbouring bands are clearly different colours (CIE76 ΔE 30 or more; the old set's closest pair was 11).
 */
import { describe, expect, it } from 'vitest'
import { BANDS, BAND_TEXT } from '@/lib/types'

const SCREEN = '#FDFBF7', CARD = '#FFFFFF', INK = '#1A2421', BLACK = '#000000'
const linear = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = (hex: string) => { const [r, g, b] = linear(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const lab = (hex: string) => {
  const [r, g, b] = linear(hex)
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const deltaE = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]))

describe('TRAK-458: band colours on light screens', () => {
  it.each(BANDS.map(b => [b.word, b] as const))('%s reads on light screens', (_word, band) => {
    expect(contrast(BLACK, band.color)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(band.border, SCREEN)).toBeGreaterThanOrEqual(3)
    expect(contrast(band.border, CARD)).toBeGreaterThanOrEqual(3)
    expect(contrast(band.text, SCREEN)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(band.text, band.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(INK, band.bg)).toBeGreaterThanOrEqual(7)
  })

  it('tells any two neighbouring bands apart at a glance', () => {
    for (let i = 0; i < BANDS.length - 1; i++) {
      expect(deltaE(BANDS[i].color, BANDS[i + 1].color), `${BANDS[i].word} and ${BANDS[i + 1].word}`).toBeGreaterThanOrEqual(30)
    }
  })

  it('names the readable shade for each band word', () => {
    expect(Object.keys(BAND_TEXT)).toEqual(BANDS.map(b => b.word))
    for (const band of BANDS) expect(BAND_TEXT[band.word as keyof typeof BAND_TEXT]).toBe(band.text)
  })
})
