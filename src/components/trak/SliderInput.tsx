import { forwardRef } from 'react'
import { BANDS } from '@/lib/types'
import { scoreToBand } from '@/lib/rating-engine'

interface SliderInputProps {
  label: string
  value: number
  onChange: (value: number) => void
}

function bandConfig(value: number) {
  const band = scoreToBand(value)
  return BANDS.find(b => b.word.toLowerCase() === band) ?? BANDS[BANDS.length - 1]
}

export const SliderInput = forwardRef<HTMLDivElement, SliderInputProps>(
  function SliderInput({ label, value, onChange }, ref) {
    const cfg = bandConfig(value)
    // 0..10 scale — 5 sits exactly at the centre of the track.
    const pct = (value / 10) * 100

    // The real input is invisible, so a disabled slider (e.g. inside a locked
    // fieldset) must be greyed out from here, or it looks usable.
    return (
      <div ref={ref} className="space-y-2 has-[:disabled]:opacity-40 has-[:disabled]:grayscale">
      {/* label row: category left, band word right */}
      <div className="flex justify-between items-center">
        <span className="text-[12px] font-medium text-white/[0.88]">
          {label}
        </span>
        <span className="text-[12px] font-medium" style={{ color: cfg.color }}>
          {cfg.word}
        </span>
      </div>

      {/* custom track + thumb */}
      <div className="relative h-[5px] bg-white/[0.07] rounded-[3px]">
        {/* filled portion */}
        <div
          className="absolute inset-y-0 left-0 rounded-[3px]"
          style={{ width: `${pct}%`, background: cfg.color }}
        />

        {/* thumb circle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-[16px] h-[16px] rounded-full bg-white border-[2.5px]"
          style={{
            left: `calc(${pct}% - 8px)`,
            borderColor: cfg.color,
          }}
        />

        {/* invisible range input for interaction */}
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          style={{ height: 20, top: -7 }}
        />
      </div>
      </div>
    )
  },
)
