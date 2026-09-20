import { BandPill } from './BandPill'
import type { BandType } from '@/lib/types'
import { parseDisplayDate } from '@/lib/calendar'

interface MatchCardProps {
  opponent: string
  date: string
  scoreUs: number | null
  scoreThem: number | null
  band: BandType
  competition?: string
  onClick?: () => void
}

export function MatchCard({ opponent, date, scoreUs, scoreThem, band, competition, onClick }: MatchCardProps) {
  // A date-only value is a calendar day, not UTC midnight — see parseDisplayDate.
  const parsed = parseDisplayDate(date)
  const formattedDate = parsed
    ? parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : ''
  const result = scoreUs != null && scoreThem != null
    ? (scoreUs > scoreThem ? 'W' : scoreUs < scoreThem ? 'L' : 'D')
    : null
  const resultColor = result === 'W' ? '#4ade80' : result === 'L' ? '#f87171' : '#fbbf24'

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between rounded-[12px] px-4 py-3 text-left active:scale-[0.99] transition-transform"
      style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="flex-1 min-w-0 mr-3">
        <p className="text-[13px] font-medium text-white/88 truncate">{opponent}</p>
        <p className="text-[9px] text-white/[0.28] mt-[3px] tracking-[0.05em]"
          style={{ fontFamily: "'DM Mono', monospace" }}>
          {formattedDate}{competition ? ` · ${competition}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {result && (
          <span className="text-[10px] font-semibold" style={{ color: resultColor, fontFamily: "'DM Mono', monospace" }}>
            {result} {scoreUs}–{scoreThem}
          </span>
        )}
        <BandPill band={band} />
      </div>
    </button>
  )
}
