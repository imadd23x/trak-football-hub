import { CalendarDays, House, TrafficCone, UserRound, type LucideIcon } from 'lucide-react'
import { createContext, useContext } from 'react'
import { useLocation } from 'react-router-dom'
import type { Role } from '@/lib/types'
import { useTranslation } from '@/lib/i18n'
import { GlassTabBar } from '@/components/arc/glass-tabbar/glass-tabbar'
import { PitchIcon } from '@/components/icons/PitchIcon'

interface NavItem {
  /** Its word in nav.json (TRAK-406). */
  label: 'home' | 'matches' | 'trainings' | 'profile' | 'events'
  path: string
  Icon: LucideIcon | typeof PitchIcon
}

/** TRAK-440 (Imad, 11-12 Nov): the coach's tabs and icons. The player's Card leaves the bar (it becomes part of
 *  Profile); "Sessions" is Matches. */
export const FAMILY_TABS: Record<'player' | 'parent', NavItem[]> = {
  player: [
    { label: 'home', path: '/player/home', Icon: House },
    { label: 'matches', path: '/player/matches', Icon: PitchIcon },
    { label: 'trainings', path: '/player/trainings', Icon: TrafficCone },
    { label: 'profile', path: '/player/profile', Icon: UserRound },
  ],
  parent: [
    { label: 'home', path: '/parent/home', Icon: House },
    { label: 'events', path: '/parent/matches', Icon: CalendarDays },
    { label: 'profile', path: '/parent/profile', Icon: UserRound },
  ],
}

interface NavBarProps {
  role: Role
  activeTab: string
  onNavigate: (path: string) => void
  /** Coach pages only, and now unused: the coach's frame (TRAK-259) owns their nav. */
  sideMenuOnly?: boolean
}

/** TRAK-441: inside the family frame (a laptop, the academy's family_look on) the side menu is the nav. */
export const FamilyFramed = createContext(false)

/** A player's and a parent's bar: the coach's glass tab bar (CoachFrame's, TRAK-440). A coach's nav is the frame's. */
export function NavBar({ role, activeTab, onNavigate }: NavBarProps) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const framed = useContext(FamilyFramed)
  if (role === 'coach' || framed) return null
  // As before: everyone but a player (a parent, a club account) gets the parent's tabs.
  const who = role === 'player' ? 'player' : 'parent'
  const items = FAMILY_TABS[who]
  // TRAK-186: a tab stays marked on every page under it (Events → an event).
  const active = items.find(item => activeTab === item.path || activeTab.startsWith(`${item.path}/`))?.path ?? ''
  return (
    <div className="arc fixed inset-x-0 z-50 px-3 pointer-events-none" style={{ bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
      <div className="mx-auto max-w-[406px]">
        {/* On a page under a tab (an event under Events), its marked tab goes back to the tab's page. */}
        <GlassTabBar label={t(`nav:${who}`)} value={active} onValueChange={onNavigate}
          onReselect={path => { if (pathname !== path) onNavigate(path) }}
          style={{ ['--glass-active' as string]: 'rgb(var(--t-brand))' }}
          items={items.map(({ label, path, Icon }) => ({ value: path, label: t(`nav:${label}`), icon: <Icon /> }))} />
      </div>
    </div>
  )
}
