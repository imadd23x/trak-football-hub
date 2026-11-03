import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { Users } from 'lucide-react'
import { GlassSegmented } from '@/components/arc/glass-segmented/glass-segmented'
import { NavBar, WIDE_COLUMN } from '@/components/trak'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { SquadLoadError } from '@/components/coach/squad/SquadLoadError'
import { PlayersTab } from '@/components/coach/squad/PlayersTab'
import { AttributesTab } from '@/components/coach/squad/AttributesTab'
import { AvailabilityTab } from '@/components/coach/squad/AvailabilityTab'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* TRAK-250: Squad is a full-width coach workspace with views of the same
   roster. The view lives in the URL (?tab=), so a view can be linked and a
   reload keeps it. Every view reads from one shared roster (useSquadRoster).
   TRAK-263 (Imad, 22 Oct): Players replaces Snapshot and comes first; the views
   sit on Arc's glass segmented control. TRAK-283 (Imad, 27 Oct): Games left
   Squad for everyone; matches have their own Games tab, with no statistics. */
const TABS = [
  { id: 'players', label: 'Players' },
  { id: 'attributes', label: 'Attributes' },
  { id: 'availability', label: 'Availability' },
] as const
type TabId = typeof TABS[number]['id']

export default function CoachSquadPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const active: TabId = TABS.find(t => t.id === params.get('tab'))?.id ?? 'players'
  // TRAK-305: All or one squad, as picked at the top of the frame.
  const roster = useSquadRoster()
  const choose = (id: string) => setParams({ tab: id }, { replace: true })

  return (
    <div className="min-h-screen bg-ground pb-24">
      <div className={WIDE_COLUMN}>
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-6 pb-4">
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">Squad</h1>
          {/* On a phone the views take the full width, under the title; on a coach's tablet or laptop they sit in the header. */}
          <div className="arc order-last w-full tablet:order-none tablet:w-[440px]">
            <GlassSegmented label="Squad view" value={active} onValueChange={choose} fullWidth
              options={TABS.map(t => ({ value: t.id, label: t.label }))} />
          </div>
        </header>

        <section aria-label={TABS.find(t => t.id === active)!.label} className="pb-8">
          {roster.error ? <SquadLoadError onRetry={roster.retry} />
            : roster.isPending ? <LoadingSkeleton label="Loading your squad…" lines={2} avatar rows={4} className="pt-6" />
            : roster.players.length === 0 ? <PreparingSquad />
            : active === 'players' ? <PlayersTab roster={roster} />
            : active === 'attributes' ? <AttributesTab roster={roster} />
            : <AvailabilityTab roster={roster} />}
        </section>
      </div>
      <NavBar role="coach" activeTab={location.pathname} onNavigate={navigate} />
    </div>
  )
}

function PreparingSquad() {
  return (
    <div className="flex flex-col items-center text-center pt-14 px-6">
      <div
        className="w-14 h-14 rounded-[16px] flex items-center justify-center mb-4"
        style={{ background: 'rgb(var(--t-brand) / 0.08)', border: '1px solid rgb(var(--t-brand) / 0.15)' }}
      >
        <Users size={22} className="text-brand" strokeWidth={1.5} />
      </div>
      <p className="text-[15px] text-ink-2 font-medium mb-1">Your squad is being prepared</p>
      <p className="text-[12px] text-ink-3 leading-relaxed mb-5">Your academy will add players to this squad.</p>
    </div>
  )
}
