import { useLayoutEffect, useRef } from 'react'
import { useNavigate, useLocation, useMatch, useSearchParams } from 'react-router-dom'
import { Users } from 'lucide-react'
import { GlassSegmented } from '@/components/arc/glass-segmented/glass-segmented'
import { NavBar, WIDE_COLUMN } from '@/components/trak'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { SquadLoadError } from '@/components/coach/squad/SquadLoadError'
import { PlayersTab } from '@/components/coach/squad/PlayersTab'
import { AttributesTab } from '@/components/coach/squad/AttributesTab'
import { AvailabilityTab } from '@/components/coach/squad/AvailabilityTab'
import { FormationsTab } from '@/components/coach/squad/formations/FormationsTab'
import { useFeatureState } from '@/components/trak/parked'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { useAuth } from '@/contexts/AuthContext'
import { CoachMenuButton } from '@/components/coach/CoachFrame'

/* TRAK-250: Squad is a full-width coach workspace with views of the same
   roster. The view lives in the URL (?tab=), so a view can be linked and a
   reload keeps it. Every view reads from one shared roster (useSquadRoster).
   TRAK-263 (Imad, 22 Oct): Players replaces Snapshot and comes first; the views
   sit on Arc's glass segmented control. TRAK-283 (Imad, 27 Oct): Games left
   Squad for everyone; matches have their own Games tab, with no statistics.
   TRAK-351 (Tarek, 3 Nov): a player opens as their own full page at /coach/squad/player/:id, with no list beside it
   and a Back button. The page stays mounted behind it, so Back (or the browser's) finds the list as it was left.
   TRAK-357 (spec TRAK-348): where the season plan is on, Formations takes Attributes' place. Availability goes with
   TRAK-359. Elsewhere Squad stays as it is. */
type TabId = 'players' | 'formations' | 'attributes' | 'availability'
const TABS: { id: TabId; label: string }[] = [
  { id: 'players', label: 'Players' },
  { id: 'attributes', label: 'Attributes' },
  { id: 'availability', label: 'Availability' },
]
const SEASON_PLAN_TABS: { id: TabId; label: string }[] = [
  { id: 'players', label: 'Players' },
  { id: 'formations', label: 'Formations' },
  { id: 'availability', label: 'Availability' },
]

export default function CoachSquadPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const seasonPlan = useFeatureState('season_plan')
  const tabs = seasonPlan.on ? SEASON_PLAN_TABS : TABS
  const active: TabId = tabs.find(t => t.id === params.get('tab'))?.id ?? 'players'
  // TRAK-305: All or one squad, as picked at the top of the frame.
  const roster = useSquadRoster()
  const choose = (id: string) => setParams({ tab: id }, { replace: true })
  const openId = useMatch('/coach/squad/player/:id')?.params.id ?? null
  // Where the list was scrolled when a player opened. Their page starts at its top; Back puts the list back there.
  const listScroll = useRef(0)
  const wasOpen = useRef(openId)
  useLayoutEffect(() => {
    if (openId) window.scrollTo({ top: 0 })
    else if (wasOpen.current) window.scrollTo({ top: listScroll.current })
    wasOpen.current = openId
  }, [openId])
  const openPlayer = (id: string) => {
    listScroll.current = window.scrollY
    navigate(`/coach/squad/player/${id}`)
  }
  // Back to wherever the coach came from (the list, Home, Feedback); a page opened from its address goes to the squad.
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate('/coach/squad', { replace: true }))

  return (
    <div className="min-h-screen bg-ground pb-24">
      <div className={WIDE_COLUMN}>
        {/* TRAK-351: a player's page has the screen to itself. Not `hidden`: the header's flex would show it anyway. */}
        {openId == null && <header className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-6 pb-4">
          {/* TRAK-376 (Imad, 5 Nov): on a phone the avatar opens the side menu, where the squad picker is. */}
          <CoachMenuButton name={profile?.full_name || 'Coach'} />
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">Squad</h1>
          {/* On a phone the views take the full width, under the title; on a coach's tablet or laptop they sit in the header. */}
          <div className="arc order-last w-full tablet:order-none tablet:w-[440px]">
            <GlassSegmented label="Squad view" value={active} onValueChange={choose} fullWidth
              options={tabs.map(t => ({ value: t.id, label: t.label }))} />
          </div>
        </header>}

        <section aria-label={tabs.find(t => t.id === active)!.label} className="pb-8">
          {/* TRAK-368: a player's page stays up when only the assessments failed, and says so there. */}
          {(openId != null && active === 'players' ? roster.rosterError : roster.error) ? <SquadLoadError onRetry={roster.retry} />
            : roster.isPending ? <LoadingSkeleton label="Loading your squad…" lines={2} avatar rows={4} className="pt-6" />
            : roster.players.length === 0 ? <PreparingSquad />
            : active === 'players' ? <PlayersTab roster={roster} openId={openId} onOpen={openPlayer} onBack={back} />
            : active === 'formations' ? <FormationsTab roster={roster} />
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
