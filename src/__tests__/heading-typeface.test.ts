/**
 * TRAK-421: headings use the same typeface as the rest of Trak (--t-font), not the old DM Sans. A heading rule
 * that names its own font splits titles and body text into two typefaces; this fails on one.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('TRAK-421: one typeface for headings and body', () => {
  const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8')
  const rule = css.match(/h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{([^}]*)\}/)?.[1] ?? ''

  it('sets headings in --t-font', () => {
    expect(rule).toMatch(/font-family:\s*var\(--t-font\)/)
  })
  it('names no other font for headings', () => {
    expect(rule).not.toMatch(/DM Sans/i)
  })
})
