import { createContext, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { supabase } from '@/integrations/supabase/client'
import { useFeature } from '@/components/trak/parked'
import { FAMILY_TABS, FamilyFramed } from '@/components/trak/NavBar'
import { SidebarRail } from '@/components/arc/blocks/sidebar-rail/sidebar-rail'
import { Avatar } from '@/components/arc/avatar/avatar'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { useTranslation } from '@/lib/i18n'
import { ChildSwitcher } from '@/components/parent/ParentFamily'

/** Pages under no tab of their own, and the tab they sit under (the one their NavBar marks). */
const UNDER: [RegExp, string][] = [
  [/^\/player\/(match|event)\//, '/player/matches'],
  [/^\/player\/(season|calendar|feedback)/, '/player/home'],
  [/^\/parent\/(match|event|session|assessment)/, '/parent/matches'],
  [/^\/parent\/season/, '/parent/home'],
]

/**
 * TRAK-441 slice 1 (Imad, 12 Nov): on a laptop a player and a parent get the coach's side menu (SidebarRail, as
 * CoachFrame), with Profile where the coach has Settings, and the coach's page widths. Behind the academy's
 * family_look switch until every family slice has landed. A phone gets the page with NavBar's glass tab bar, and with
 * the switch on, the pages' new look (useFamilyLook). An academy with the switch off, and everyone who isn't a player or
 * parent, get the page as it is.
 */
/** TRAK-441 slice 2: whether a page draws the family app in the coach's look (the academy's family_look switch),
 *  and, on a laptop, the top bar's place for a page's actions (Home's bell). */
const FamilyLook = createContext<{ framed: boolean; actions: HTMLElement | null }>({ framed: false, actions: null })
/** On a laptop the frame has read the switch; on a phone a page that has a new look asks for itself (only those pages
 *  ask, so the others make no extra read). The answer is shared: one read per person. */
export function useFamilyLook() {
  const { profile } = useAuth()
  const { framed } = useContext(FamilyLook)
  const family = profile?.role === 'player' || profile?.role === 'parent'
  const phone = useFeature(family && !framed ? 'family_look' : undefined)
  return framed || phone
}

/** A page's action in the laptop's top bar, where the coach has his bell; on a phone it stays where the page puts it. */
export function FrameActions({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { actions } = useContext(FamilyLook)
  return actions ? createPortal(children, actions) : <>{fallback}</>
}

export function FamilyFrame() {
  const { profile } = useAuth()
  const who = profile?.role === 'player' || profile?.role === 'parent' ? profile.role : null
  const wide = useSideMenuScreen()
  // Asked here only on a laptop; on a phone the pages with a new look ask (useFamilyLook).
  const on = useFeature(who && wide ? 'family_look' : undefined)
  if (!who || !on || !wide) return <Outlet />
  return <Framed who={who} name={profile?.full_name ?? ''} />
}

/** The child's academy, its name and logo (family_academy): the player's own, or the child the parent follows. */
function useFamilyAcademy(who: 'player' | 'parent') {
  const { user } = useAuth()
  const { selectedChild } = useParentChildren()
  const child = who === 'player' ? user?.id : selectedChild?.id
  return useQuery({
    queryKey: ['family-academy', user?.id, child],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('family_academy', { p_child: child! }).maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!user && !!child,
    staleTime: 5 * 60_000,
  }).data
}

function Framed({ who, name }: { who: 'player' | 'parent'; name: string }) {
  const { t } = useTranslation()
  const academy = useFamilyAcademy(who)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // The coach's page widths and laptop sizes (src/index.css), as the mockup draws them.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.layout = 'coach'
    return () => { delete root.dataset.layout }
  }, [])
  // Fixed bars on a page centre beside the side menu (--rail-w), as in the coach's frame.
  const setRail = useCallback((width: number) => document.documentElement.style.setProperty('--rail-w', `${width}px`), [])
  useEffect(() => () => { document.documentElement.style.removeProperty('--rail-w') }, [])

  const tabs = FAMILY_TABS[who].map(({ label, path, Icon }) => ({ id: path, label: t(`nav:${label}`), icon: Icon }))
  const active = tabs.find(tab => pathname === tab.id || pathname.startsWith(`${tab.id}/`))?.id
    ?? UNDER.find(([page]) => page.test(pathname))?.[1] ?? ''
  // Slice 2: the academy's name and logo where the coach's frame has his club's; "Trak" until it's known.
  const brand = academy?.name || t('nav:trak')
  return <FamilyFramed.Provider value={true}><FamilyLook.Provider value={{ framed: true, actions }}>
    <SidebarRail label={t('nav:trak')} title={tabs.find(tab => tab.id === active)?.label ?? ''} onWidthChange={setRail}
      brand={{ name: brand, logo: <Avatar name={brand} src={academy?.logo_url ?? undefined} size="sm" /> }}
      items={tabs.slice(0, -1)} footerItem={tabs[tabs.length - 1]}
      profile={{ name, detail: t(`nav:${who}`), avatar: <Avatar name={name} size="sm" /> }}
      active={active} onSelect={id => navigate(id)} afterBrand={who === 'parent' ? <ChildSwitcher /> : undefined}
      actions={<div ref={setActions} className="flex items-center gap-2" />}>
      <Suspense fallback={<div className="min-h-screen bg-ground" />}><Outlet /></Suspense>
    </SidebarRail>
  </FamilyLook.Provider></FamilyFramed.Provider>
}
