import { forwardRef, memo } from 'react'
import { BANDS, type BandType } from '@/lib/types'

export const BandPill = memo(
  forwardRef<HTMLSpanElement, { band: BandType }>(function BandPill({ band }, ref) {
    const config = BANDS.find(b => b.word.toLowerCase() === band) ?? BANDS[BANDS.length - 1]
    return (
      <span
        ref={ref}
        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full"
        style={{
          // TRAK-458 (Kostas, 13 Nov): the band's bright colour, its darker edge, the word in black (5:1 or more).
          color: 'rgb(var(--t-on-bright))',
          background: config.color,
          border: `1px solid ${config.border}`,
          fontFamily: 'var(--t-font)',
          fontWeight: 500,
          letterSpacing: '-0.03em',
        }}
      >
        {config.word}
      </span>
    )
  }),
)
