import { useLayoutEffect, useRef } from 'react'
import { useNavigate, useLocation, useMatch, useSearchParams } from 'react-router-dom'
import { Users } from 'lucide-react'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
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
import { useTranslation } from '@/lib/i18n'

/* TRAK-250: Squad is a full-width coach workspace with views of the same
   roster. The view lives in the URL (?tab=), so a view can be linked and a
   reload keeps it. Every view reads from one shared roster (useSquadRoster).
   TRAK-263 (Imad, 22 Oct): Players replaces Snapshot and comes first; the views
   sit on Arc's glass segmented control. TRAK-283 (Imad, 27 Oct): Games left
   Squad for everyone; matches have their own Games tab, with no statistics.
   TRAK-351 (Tarek, 3 Nov): a player opens as their own full page at /coach/squad/player/:id, with no list beside it
   and a Back button. The page stays mounted behind it, so Back (or the browser's) finds the list as it was left.
   TRAK-357 (spec TRAK-348): where the season plan is on, Formations takes Attributes' place. TRAK-359: and Availability
   goes, as Matches marks who isn't attending. Elsewhere Squad stays as it is. */
type TabId = 'players' | 'formations' | 'attributes' | 'availability'
/* TRAK-407: each label is a word key, read in the language showing. */
const TABS = [
  { id: 'players', label: 'coachSquad:tabPlayers' },
  { id: 'attributes', label: 'coachSquad:tabAttributes' },
  { id: 'availability', label: 'coachSquad:tabAvailability' },
] as const satisfies readonly { id: TabId; label: string }[]
const SEASON_PLAN_TABS = [
  { id: 'players', label: 'coachSquad:tabPlayers' },
  { id: 'formations', label: 'coachSquad:tabFormations' },
] as const satisfies readonly { id: TabId; label: string }[]

export default function CoachSquadPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile } = useAuth()
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const seasonPlan = useFeatureState('season_plan')
  const tabs = seasonPlan.on ? SEASON_PLAN_TABS : TABS
  const active: TabId = tabs.find(tab => tab.id === params.get('tab'))?.id ?? 'players'
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
          <CoachMenuButton name={profile?.full_name || t('nav:coach')} />
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">{t('nav:squad')}</h1>
          {/* On a phone the views take the full width, under the title; on a coach's tablet or laptop they sit in the header. */}
          <div className="arc order-last w-full tablet:order-none tablet:w-[440px]">
            <GlassSegmented label={t('coachSquad:squadView')} value={active} onValueChange={choose} fullWidth
              options={tabs.map(tab => ({ value: tab.id, label: t(tab.label) }))} />
          </div>
        </header>}

        <section aria-label={t(tabs.find(tab => tab.id === active)!.label)} className="pb-8">
          {/* TRAK-368: a player's page stays up when only the assessments failed, and says so there. */}
          {(openId != null && active === 'players' ? roster.rosterError : roster.error) ? <SquadLoadError onRetry={roster.retry} />
            : roster.isPending ? <LoadingSkeleton label={t('coachSchedule:loadingSquad')} lines={2} avatar rows={4} className="pt-6" />
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
  const { t } = useTranslation()
  return (
    // TRAK-432: the same Arc empty state as Matches and Training.
    <div className="arc pt-10 px-6">
      <EmptyState icon={<Users size={24} strokeWidth={1.5} />} title={t('coachSquad:preparingTitle')} description={t('coachSquad:preparingBody')} />
    </div>
  )
}
