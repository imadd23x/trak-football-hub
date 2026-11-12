import { forwardRef } from 'react'
import type { Role } from '@/lib/types'
import { useTranslation } from '@/lib/i18n'
import {
  IconHome,
  IconLog,
  IconGoals,
  IconRecognition,
  IconProfile,
  IconMatch,
  IconTraining,
  ACTIVE_COLOR,
  DEFAULT_COLOR,
} from '@/components/icons/TrakIcons'

type IconComponent = (props: { size?: number; color?: string }) => JSX.Element

interface NavItem {
  /** Its word in nav.json (TRAK-406). */
  label: 'home' | 'sessions' | 'trainings' | 'card' | 'profile' | 'events'
  path: string
  Icon: IconComponent
}

function getNavItems(role: Role): NavItem[] {
  if (role === 'player') return [
    { label: 'home', path: '/player/home', Icon: IconHome },
    { label: 'sessions', path: '/player/matches', Icon: IconMatch },  // TRAK-112: matches and training
    { label: 'trainings', path: '/player/trainings', Icon: IconTraining },
    { label: 'card', path: '/player/evolution', Icon: IconRecognition },
    { label: 'profile', path: '/player/profile', Icon: IconProfile },
  ]
  return [
    { label: 'home',    path: '/parent/home',    Icon: IconHome },
    { label: 'events',  path: '/parent/matches', Icon: IconMatch },
    { label: 'profile', path: '/parent/profile', Icon: IconProfile },
  ]
}

interface NavBarProps {
  role: Role
  activeTab: string
  onNavigate: (path: string) => void
  /** Coach pages only, and now unused: the coach's frame (TRAK-259) owns their nav. */
  sideMenuOnly?: boolean
}

export const NavBar = forwardRef<HTMLElement, NavBarProps>(
  function NavBar({ role, activeTab, onNavigate }, ref) {
    const { t } = useTranslation()
    // TRAK-259: a coach's nav is the frame's (CoachFrame: the sidebar on a laptop, the glass tab bar on a phone).
    if (role === 'coach') return null
    const items = getNavItems(role)
    return (
      <nav
      ref={ref}
      // TRAK-199: as wide as a page.
      className="trak-nav trak-page fixed bottom-0 w-full mx-auto left-1/2 -translate-x-1/2 flex justify-around items-center px-4 py-2 border-t border-line z-50"
      style={{
        background: 'rgb(var(--t-ground) / 0.96)',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
        willChange: 'auto',
      }}
    >
      {items.map(item => {
        // TRAK-186: a tab stays marked on every page under it (Squad → a player).
        const isActive = activeTab === item.path || activeTab.startsWith(`${item.path}/`)
        const Icon = item.Icon
        return (
          <button
            key={item.path}
            onClick={() => onNavigate(item.path)}
            aria-current={isActive ? 'page' : undefined}
            className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all relative"
            style={{
              background: isActive ? 'rgb(var(--t-brand) / 0.06)' : 'transparent',
              minWidth: 52,
            }}
          >
            <Icon size={20} color={isActive ? ACTIVE_COLOR : DEFAULT_COLOR} />
            <span className="trak-nav-label" style={{ color: isActive ? 'rgb(var(--t-brand))' : 'rgb(var(--t-ink-3))' }}>
              {t(`nav:${item.label}`)}
            </span>
            {isActive && (
              <span
                className="trak-nav-dot absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                style={{ background: 'rgb(var(--t-brand))' }}
              />
            )}
          </button>
        )
      })}
      </nav>
    )
  },
)
