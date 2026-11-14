import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, House, Settings, TrafficCone, Users } from 'lucide-react'
import { PitchIcon } from '@/components/icons/PitchIcon'
import { useFeature } from '@/components/trak/parked'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { Avatar } from '@/components/arc/avatar/avatar'
import { SidebarRail, type RailEntry } from '@/components/arc/blocks/sidebar-rail/sidebar-rail'
import { GlassTabBar } from '@/components/arc/glass-tabbar/glass-tabbar'
import { CoachAlertsBell } from '@/components/coach/CoachAlertsBell'
import { CoachCreate } from '@/components/coach/QuickAdd'
import { CoachFrameContext, useCoachFrame, type CoachFrame as Frame } from '@/components/coach/coach-frame-context'
import { SquadSwitcher } from '@/components/coach/SquadSwitcher'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { BARLESS, COACH_SCREEN_PATH, placeOf, tabOf, type CoachScreen } from '@/lib/coach-places'
import { CoachTrailProvider, TrailLink, type Trail } from '@/components/coach/CoachTrail'
import { useTranslation } from '@/lib/i18n'
import { useOwnAvatarUrl } from '@/hooks/use-own-avatar-url'
import { FamilyFrame } from '@/components/trak/FamilyFrame'

/* TRAK-259 (Imad, 22 Oct): the coach's frame, around every coach page.
   Laptop: Arc's sidebar rail (the club, Home, Calendar, Squads, Library, then
   Settings and the coach), with the bell and "+ Create" at the top right.
   Phone and tablet: Arc's glass tab bar (Home, Squad, Library) with the "+"
   at its right; the coach's avatar on a page opens the same sidebar as a
   sheet. Feedback and Profile left the nav; their pages still open.
   TRAK-283: Games sits after Squad, on a laptop and a phone, only where the
   academy's games switch is on. TRAK-294: where the training switch is on,
   Training takes Library's place; the Library's pages open from Training.
   TRAK-305 (Kostas, 28 Oct): a coach with two squads or more picks All or one
   squad here, once, and every coach page shows only that: in the sidebar on a
   laptop, and in the sheet on a phone (TRAK-376, Imad 5 Nov: no row on the page). TRAK-347 (Imad, 3 Nov): a laptop's top bar is the
   trail, "Matches / vs Mirdif Rangers", and no longer starts with the club. TRAK-377 (Imad, 5 Nov): the page waits for
   its code inside the frame, so the frame never does; when the app's own wait held the frame too, a phone's sidebar
   tapped shut while a page loaded slid back in and stayed, the page under it blocked until a refresh. */

type Screen = CoachScreen
const TO = COACH_SCREEN_PATH

/** The club's name, logo and the coach's role, as Settings reads them. Imad, 24 Oct: the club's logo shows in the
 *  sidebar; a person's photo stays off for the pilot (G7), so the coach is initials. */
function useCoachIdentity(userId: string | undefined) {
  return useQuery({
    queryKey: ['coach', userId, 'identity'],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('coach_details').select('coach_role, team, organization_id').eq('user_id', userId!).maybeSingle()
      if (error) throw error
      const org = data?.organization_id
        ? (await supabase.from('organizations').select('name, logo_url').eq('id', data.organization_id).maybeSingle()).data
        : null
      const academy = org as { name?: string; logo_url?: string | null } | null
      return { role: data?.coach_role ?? null, team: data?.team ?? null, club: academy?.name ?? null, logo: academy?.logo_url ?? null }
    },
  })
}

export function CoachFrame() {
  const { user, profile } = useAuth()
  const { t } = useTranslation()
  // TRAK-441: Settings and How Trak works are shared; a player or parent gets them in the family frame.
  if (profile?.role !== 'coach' || !user) return <FamilyFrame />
  return <Framed userId={user.id} name={profile.full_name || t('nav:coach')} />
}

function Framed({ userId, name }: { userId: string; name: string }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // TRAK-406: the menus are in the language showing, and change with it.
  const { t } = useTranslation()
  const wide = useSideMenuScreen()
  const identity = useCoachIdentity(userId).data
  const photo = useOwnAvatarUrl() // TRAK-460
  const games = useFeature('games')
  const training = useFeature('training')
  const [sheetOpen, setSheetOpen] = useState(false)
  // TRAK-347: the trail a page hands up on a laptop; until it does (its name still loading), its nav row's name.
  const [trail, setTrail] = useState<Trail | null>(null)
  const listeners = useRef(new Set<() => void>())
  const { screen: place, title } = placeOf(pathname)
  const screen = training && place === 'library' ? 'training' : place

  const frame = useMemo<Frame>(() => ({
    openMenu: () => setSheetOpen(true),
    subscribeSaved: listener => { listeners.current.add(listener); return () => { listeners.current.delete(listener) } },
  }), [])
  const saved = useCallback(() => listeners.current.forEach(listener => listener()), [])

  // Fixed bars on a laptop page (Assess's Back and Next) centre on the page beside the sidebar: --rail-w is its width.
  const setRail = useCallback((width: number) => document.documentElement.style.setProperty('--rail-w', `${width}px`), [])
  useEffect(() => { if (!wide) document.documentElement.style.removeProperty('--rail-w') }, [wide])
  useEffect(() => () => { document.documentElement.style.removeProperty('--rail-w') }, [])

  const items: RailEntry[] = [
    { id: 'home', label: t('nav:home'), icon: House },
    { id: 'calendar', label: t('nav:events'), icon: CalendarDays }, // TRAK-255, TRAK-449: the coach's is called Events, as the parent's is
    { id: 'squad', label: t('nav:squad'), icon: Users },
    // TRAK-306 (Kostas, 28 Oct): Imad's pitch (TRAK-265) for Games; a cone for Training, and for Library in its place.
    ...(games ? [{ id: 'games', label: t('nav:matches'), icon: PitchIcon }] : []),
    training ? { id: 'training', label: t('nav:training'), icon: TrafficCone } : { id: 'library', label: t('nav:library'), icon: TrafficCone },
  ]
  const select = (id: string) => { if (id in TO) navigate(TO[id as Screen]) }
  // TRAK-334: a nav row starts a fresh trail; every other page's trail is where the coach came from.
  const tabs = [...items.map(item => TO[item.id as Screen]), TO.settings]
  const club = identity?.club || t('nav:yourAcademy')
  const barred = BARLESS.test(pathname)
  // TRAK-324: the squad switcher sits in the sidebar, not in the top bar. TRAK-376: on a phone, in the sidebar's sheet.
  // TRAK-430: on every page, the barless ones too, or the rows under it jump (8 px with one squad, 64 px with two).
  const switcher = <SquadSwitcher coachId={userId} />

  return <CoachFrameContext.Provider value={frame}><CoachTrailProvider tabs={tabs} topBar={wide ? setTrail : null}>
    <SidebarRail label={club} title={trail?.current ?? (place ? tabOf(pathname).label : title)} narrow={!wide}
      trail={trail?.crumbs.map(crumb => <TrailLink key={crumb.href} crumb={crumb} />)} sheetOpen={sheetOpen} onSheetOpenChange={setSheetOpen} onWidthChange={setRail}
      brand={{ name: club, logo: <Avatar name={club} src={identity?.logo ?? undefined} size="sm" /> }}
      items={items} footerItem={{ id: 'settings', label: t('nav:settings'), icon: Settings }}
      profile={{ name, detail: identity?.role ?? undefined, avatar: <Avatar name={name} src={photo ?? undefined} size="sm" /> }}
      active={screen ?? ''} onSelect={select}
      afterBrand={switcher}
      actions={<><CoachAlertsBell coachId={userId} /><CoachCreate placement="top" onSaved={saved} /></>}>
      <Suspense fallback={<div className="min-h-screen bg-ground" />}><Outlet /></Suspense>
    </SidebarRail>
    {!wide && !barred && <div className="arc fixed inset-x-0 z-50 px-3 pointer-events-none" style={{ bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
      <GlassTabBar label={t('nav:coach')} value={screen ?? ''} onValueChange={value => navigate(TO[value as Screen])}
        style={{ ['--glass-active' as string]: 'rgb(var(--t-brand))' }}
        items={[
          { value: 'home', label: t('nav:home'), icon: <House /> },
          { value: 'squad', label: t('nav:squad'), icon: <Users /> },
          ...(games ? [{ value: 'games', label: t('nav:matches'), icon: <PitchIcon /> }] : []),
          training ? { value: 'training', label: t('nav:training'), icon: <TrafficCone /> } : { value: 'library', label: t('nav:library'), icon: <TrafficCone /> },
        ]}
        actionNode={<CoachCreate placement="bar" onSaved={saved} />} />
    </div>}
  </CoachTrailProvider></CoachFrameContext.Provider>
}

/** The coach's avatar at the top left of a phone page: it opens the side menu. A laptop has the sidebar instead. */
export function CoachMenuButton({ name }: { name: string }) {
  const wide = useSideMenuScreen()
  const frame = useCoachFrame()
  const { t } = useTranslation()
  const photo = useOwnAvatarUrl() // TRAK-460
  if (wide || !frame) return null
  return <button type="button" onClick={frame.openMenu} aria-label={t('nav:openMenu')} aria-haspopup="dialog"
    className="arc flex-none rounded-full transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
    <Avatar name={name} src={photo ?? undefined} size="md" />
  </button>
}
