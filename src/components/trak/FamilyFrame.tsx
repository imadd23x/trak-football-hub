import { Suspense, useCallback, useEffect, useLayoutEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
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
 * family_look switch until every family slice has landed. A phone, an academy with the switch off, and everyone who
 * isn't a player or parent get the page as it is (a phone's nav is NavBar's glass tab bar).
 */
export function FamilyFrame() {
  const { profile } = useAuth()
  const who = profile?.role === 'player' || profile?.role === 'parent' ? profile.role : null
  const wide = useSideMenuScreen()
  // Asked only where it can change something: a phone never reads the switch.
  const on = useFeature(who && wide ? 'family_look' : undefined)
  if (!who || !on || !wide) return <Outlet />
  return <Framed who={who} name={profile?.full_name ?? ''} />
}

function Framed({ who, name }: { who: 'player' | 'parent'; name: string }) {
  const { t } = useTranslation()
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
  const brand = t('nav:trak')
  return <FamilyFramed.Provider value={true}>
    <SidebarRail label={brand} title={tabs.find(tab => tab.id === active)?.label ?? ''} onWidthChange={setRail}
      brand={{ name: brand, logo: <Avatar name={brand} size="sm" /> }}
      items={tabs.slice(0, -1)} footerItem={tabs[tabs.length - 1]}
      profile={{ name, detail: t(`nav:${who}`), avatar: <Avatar name={name} size="sm" /> }}
      active={active} onSelect={id => navigate(id)} afterBrand={who === 'parent' ? <ChildSwitcher /> : undefined}>
      <Suspense fallback={<div className="min-h-screen bg-ground" />}><Outlet /></Suspense>
    </SidebarRail>
  </FamilyFramed.Provider>
}
