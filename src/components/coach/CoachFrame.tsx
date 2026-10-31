import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useCoachSquad } from '@/lib/coach-squad'
import { SquadSwitcher } from '@/components/coach/SquadSwitcher'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { BARLESS, COACH_SCREEN_PATH, placeOf, type CoachScreen } from '@/lib/coach-places'

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
   squad here, once, and every coach page shows only that: in the top bar on a
   laptop (top right), in a row at the top of the page on a phone. */

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
  if (profile?.role !== 'coach' || !user) return <Outlet />
  return <Framed userId={user.id} name={profile.full_name || 'Coach'} />
}

function Framed({ userId, name }: { userId: string; name: string }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const wide = useSideMenuScreen()
  const coachSquad = useCoachSquad(userId)
  const identity = useCoachIdentity(userId).data
  const games = useFeature('games')
  const training = useFeature('training')
  const [sheetOpen, setSheetOpen] = useState(false)
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
    { id: 'home', label: 'Home', icon: House },
    { id: 'calendar', label: 'Schedule', icon: CalendarDays }, // TRAK-255: the coach's is called Schedule
    { id: 'squad', label: 'Squad', icon: Users },
    // TRAK-306 (Kostas, 28 Oct): Imad's pitch (TRAK-265) for Games; a cone for Training, and for Library in its place.
    ...(games ? [{ id: 'games', label: 'Matches', icon: PitchIcon }] : []),
    training ? { id: 'training', label: 'Training', icon: TrafficCone } : { id: 'library', label: 'Library', icon: TrafficCone },
  ]
  const select = (id: string) => { if (id in TO) navigate(TO[id as Screen]) }
  const club = identity?.club || 'Your academy'
  const barred = BARLESS.test(pathname)
  // TRAK-324: the squad switcher sits in the sidebar (a phone: at the top of the page), not in the top bar.
  const switcher = <SquadSwitcher coachId={userId} />

  return <CoachFrameContext.Provider value={frame}>
    <SidebarRail label={club} title={title} narrow={!wide} sheetOpen={sheetOpen} onSheetOpenChange={setSheetOpen} onWidthChange={setRail}
      brand={{ name: club, logo: <Avatar name={club} src={identity?.logo ?? undefined} size="sm" /> }}
      items={items} footerItem={{ id: 'settings', label: 'Settings', icon: Settings }}
      profile={{ name, detail: identity?.role ?? undefined, avatar: <Avatar name={name} size="sm" /> }}
      active={screen ?? ''} onSelect={select}
      afterBrand={!barred && switcher}
      actions={<><CoachAlertsBell coachId={userId} /><CoachCreate placement="top" onSaved={saved} /></>}>
      {/* TRAK-307: the menu pages' margins, so the pills end where the page does. */}
      {!wide && !barred && coachSquad.view && <div className="flex justify-end bg-ground px-5 pt-3 tablet:px-8">{switcher}</div>}
      <Outlet />
    </SidebarRail>
    {!wide && !barred && <div className="arc fixed inset-x-0 z-50 px-3 pointer-events-none" style={{ bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
      <GlassTabBar label="Coach" value={screen ?? ''} onValueChange={value => navigate(TO[value as Screen])}
        style={{ ['--glass-active' as string]: 'rgb(var(--t-brand))' }}
        items={[
          { value: 'home', label: 'Home', icon: <House /> },
          { value: 'squad', label: 'Squad', icon: <Users /> },
          ...(games ? [{ value: 'games', label: 'Matches', icon: <PitchIcon /> }] : []),
          training ? { value: 'training', label: 'Training', icon: <TrafficCone /> } : { value: 'library', label: 'Library', icon: <TrafficCone /> },
        ]}
        actionNode={<CoachCreate placement="bar" onSaved={saved} />} />
    </div>}
  </CoachFrameContext.Provider>
}

/** The coach's avatar at the top left of a phone page: it opens the side menu. A laptop has the sidebar instead. */
export function CoachMenuButton({ name }: { name: string }) {
  const wide = useSideMenuScreen()
  const frame = useCoachFrame()
  if (wide || !frame) return null
  return <button type="button" onClick={frame.openMenu} aria-label="Open menu" aria-haspopup="dialog"
    className="arc flex-none rounded-full transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
    <Avatar name={name} size="md" />
  </button>
}
