import { useNavigate, useLocation } from 'react-router-dom'
import { MobileShell, NavBar } from '@/components/trak'
import { QuickAdd } from '@/components/coach/QuickAdd'
import { useFeature } from '@/components/trak/parked'
import { History } from 'lucide-react'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { IconMatch, IconSessions } from '@/components/icons/TrakIcons'

export default function CoachSessionsChooser() {
  const navigate = useNavigate()
  const location = useLocation()
  // TRAK-288: where Games is on, a match is evaluated on its game page, so the quick match log goes.
  const games = useFeature('games')

  return (
    <MobileShell>
      {/* TRAK-420: on a phone the trail, the title and History were squeezed onto one line. Now the trail has its own
          line (a phone only: a laptop shows it in the top bar), and the title sits under it with History at its right,
          the way Past trainings lays out its header. */}
      <header className="grid gap-3 pt-5 pb-4 border-b border-line">
        {/* TRAK-334: the trail, in place of Back. */}
        <CoachTrail current="Log" />
        <div className="flex items-center justify-between gap-3">
          <h1
            className="min-w-0 text-[22px] font-medium tracking-[-0.01em] text-ink"
            style={{ fontFamily: 'var(--t-font)' }}
          >
            What are you logging?
          </h1>
          {/* TRAK-193: a button you can see (Kostas missed the old grey caps), 44 px tall. */}
          <button
            onClick={() => navigate('/coach/sessions/list')}
            className="shrink-0 min-h-11 flex items-center gap-1.5 px-3 rounded-[10px] bg-raised border border-line text-[13px] font-medium text-ink active:scale-[0.97] transition-transform"
            style={{ fontFamily: 'var(--t-font)' }}
          >
            <History size={14} aria-hidden="true" className="text-ink-2" />
            History
          </button>
        </div>
      </header>

      {/* Centered choices */}
      {/* TRAK-252: side by side on a coach's tablet or laptop. */}
      <div className="flex-1 flex flex-col justify-center py-6 gap-4 tablet:grid tablet:grid-cols-2">
        {/* Quick Match Log */}
        {!games && <button
          onClick={() => navigate('/coach/sessions/quick')}
          className="w-full bg-surface border border-brand/[0.18] rounded-[24px] p-7 text-left active:scale-[0.98] transition-transform"
        >
          <div className="mb-3"><IconMatch size={32} color="rgb(var(--t-brand))" /></div>
          <span
            className="text-[9px] font-medium tracking-[0.14em] uppercase text-brand block mb-3"
            style={{ fontFamily: 'var(--t-font-mono)' }}
          >
            QUICK · 1 MIN
          </span>
          <span
            className="text-[42px] font-light text-ink leading-none tracking-tight block mb-3"
            style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.03em' }}
          >
            Quick<br/>match log.
          </span>
          <span className="text-xs text-ink-3 leading-relaxed block">
            Opponent, score and who played. Capture the result at full-time.
          </span>
        </button>}

        {/* Full Session */}
        <button
          onClick={() => navigate('/coach/sessions/add')}
          className="w-full bg-surface border border-line rounded-[24px] p-7 text-left active:scale-[0.98] transition-transform"
        >
          <div className="mb-3"><IconSessions size={32} color="rgb(var(--t-ink-2))" /></div>
          <span
            className="text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3 block mb-3"
            style={{ fontFamily: 'var(--t-font-mono)' }}
          >
            FULL SESSION
          </span>
          <span
            className="text-[42px] font-light text-ink leading-none tracking-tight block mb-3"
            style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.03em' }}
          >
            Full<br/>session.
          </span>
          <span className="text-xs text-ink-3 leading-relaxed block">
            Match or training with per-player minutes, goals, assists, cards and match notes.
          </span>
        </button>
      </div>

      {/* No Sessions tab: this page is opened from Home, so Home stays marked. */}
      {/* TRAK-254: "+ Create" in the side menu on a laptop; no "+" here on a phone. */}
      <QuickAdd sideMenuOnly />
      <NavBar role="coach" activeTab="/coach/home" onNavigate={navigate} />
    </MobileShell>
  )
}