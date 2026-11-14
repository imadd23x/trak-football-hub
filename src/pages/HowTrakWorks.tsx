import { Navigate, useNavigate, useLocation } from 'react-router-dom'
import { COACH_HOW_PATH } from '@/lib/coach-places'
import { ArrowLeft } from 'lucide-react'
import { MobileShell, NavBar, MetadataLabel } from '@/components/trak'
import { useAuth } from '@/contexts/AuthContext'
import { BANDS, BAND_TEXT } from '@/lib/types'

const BAND_DESCRIPTIONS: Record<string, string> = {
  exceptional: 'Outstanding — everything clicked',
  standout: 'Excellent — clearly above the norm',
  good: 'Solid positive — contributing well',
  steady: 'Reliable — did the job',
  mixed: 'Moments and struggles — inconsistent',
  developing: 'Below target — room to grow',
  difficult: 'Tough match — part of the journey',
}

const RANGES: Record<string, string> = {
  exceptional: '9.0 – 10.0',
  standout:    '8.0 – 8.9',
  good:        '7.0 – 7.9',
  steady:      '6.0 – 6.9',
  mixed:       '4.0 – 5.9',
  developing:  '2.0 – 3.9',
  difficult:   '0.0 – 1.9',
}

export default function HowTrakWorks() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile } = useAuth()
  const role = profile?.role === 'coach' ? 'coach' : profile?.role === 'parent' ? 'parent' : 'player'
  // TRAK-418: a coach has a page of their own; an old link or bookmark lands there.
  if (role === 'coach') return <Navigate to={COACH_HOW_PATH} replace />

  return (
    <MobileShell>
      {/* Top bar */}
      <div className="pt-3 pb-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center justify-center"
          style={{
            width: 32, height: 32, borderRadius: 999,
            background: 'rgb(var(--t-surface))', border: '1px solid rgb(var(--t-line))',
            color: 'rgb(var(--t-ink))',
          }}
          aria-label="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-[16px] font-medium text-ink" style={{ fontFamily: 'var(--t-font)' }}>
          How Trak works
        </span>
      </div>

      <div className="pt-2 pb-6 space-y-3">
        {/* Intro */}
        <div className="rounded-[18px] p-4 border border-line bg-surface">
          <MetadataLabel text="THE IDEA" />
          <p className="text-[13px] text-ink-2 mt-2.5 leading-relaxed" style={{ fontFamily: 'var(--t-font)' }}>
            TRAK turns every match into a story, not a number. Instead of a raw score,
            your performance lands in a <span className="text-ink font-medium">Performance Band</span>,
            a word that captures how the game went and how you grew.
          </p>
        </div>

        {/* TRAK-229: the bands on a light card like the rest, each in its light tint. */}
        <div className="rounded-[18px] p-4 border border-line bg-surface">
          <MetadataLabel text="PERFORMANCE BANDS" />
          <div className="mt-3 space-y-2.5">
            {BANDS.map(b => {
              const key = b.word.toLowerCase()
              return (
                <div key={key} className="flex items-start gap-3">
                  <span
                    className="inline-flex items-center justify-center h-6 px-2.5 rounded-lg text-[11px] font-semibold flex-shrink-0"
                    style={{ background: b.bg, color: b.text, border: `1px solid ${b.border}`, minWidth: 92 }}
                  >
                    {b.word}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-ink" style={{ fontFamily: 'var(--t-font)' }}>
                      {BAND_DESCRIPTIONS[key]}
                    </p>
                    <p className="text-[9px] text-ink-3 mt-0.5 tracking-[0.08em]"
                      style={{ fontFamily: 'var(--t-font-mono)' }}>
                      RATING {RANGES[key]}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Rating Engine */}
        <div className="rounded-[18px] p-4 border border-line bg-surface">
          <MetadataLabel text="THE RATING ENGINE" />
          <div className="mt-2.5 space-y-2.5 text-[12px] text-ink-2 leading-relaxed"
            style={{ fontFamily: 'var(--t-font)' }}>
            <p>
              Every match starts at a baseline of <span className="text-ink font-medium">6.5</span>,
              a steady, average performance.
            </p>
            <p>
              From there, the engine adjusts up or down based on what actually happened on the pitch:
              goals and assists, minutes played, the result, your position-specific contribution, and how
              honestly you self-rated.
            </p>
            <p>
              Coaches can add their own assessment across work rate, tactical, attitude, technical, physical,
              and coachability, which builds a fuller picture over time.
            </p>
          </div>
        </div>

        {/* Why bands not numbers: it names three bands in their readable shades (TRAK-229). */}
        <div className="rounded-[18px] p-4 border border-line bg-surface">
          <MetadataLabel text="WHY WORDS, NOT NUMBERS" />
          <p className="text-[12px] text-ink-2 mt-2.5 leading-relaxed"
            style={{ fontFamily: 'var(--t-font)' }}>
            A 7.2 and a 7.4 feel the same on the pitch, but a number invites comparison and pressure.
            Bands keep the focus on growth: how often you reach <span style={{ color: BAND_TEXT.Good }}>Good</span>,
            how you bounce back from a <span style={{ color: BAND_TEXT.Mixed }}>Mixed</span> match, and when you
            break into <span style={{ color: BAND_TEXT.Exceptional }}>Exceptional</span>.
          </p>
        </div>
      </div>

      <NavBar role={role} activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
