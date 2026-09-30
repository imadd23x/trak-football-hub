import { forwardRef } from 'react'
import type { Role } from '@/lib/types'
import {
  IconHome,
  IconLog,
  IconGoals,
  IconRecognition,
  IconProfile,
  IconSquad,
  IconSessions,
  IconMatch,
  ACTIVE_COLOR,
  DEFAULT_COLOR,
} from '@/components/icons/TrakIcons'

type IconComponent = (props: { size?: number; color?: string }) => JSX.Element

interface NavItem {
  label: string
  path: string
  Icon: IconComponent
}

function getNavItems(role: Role): NavItem[] {
  if (role === 'player') return [
    { label: 'Home', path: '/player/home', Icon: IconHome },
    { label: 'Matches', path: '/player/matches', Icon: IconMatch },
    { label: 'Card', path: '/player/evolution', Icon: IconRecognition },
    { label: 'Profile', path: '/player/profile', Icon: IconProfile },
  ]
  if (role === 'coach') return [
    { label: 'Home', path: '/coach/home', Icon: IconHome },
    { label: 'Squad', path: '/coach/squad', Icon: IconSquad },
    { label: 'Sessions', path: '/coach/sessions', Icon: IconSessions },
    { label: 'Profile', path: '/coach/profile', Icon: IconProfile },
  ]
  return [
    { label: 'Home',    path: '/parent/home',    Icon: IconHome },
    { label: 'Matches', path: '/parent/matches', Icon: IconMatch },
    { label: 'Profile', path: '/parent/profile', Icon: IconProfile },
  ]
}

interface NavBarProps {
  role: Role
  activeTab: string
  onNavigate: (path: string) => void
}

export const NavBar = forwardRef<HTMLElement, NavBarProps>(
  function NavBar({ role, activeTab, onNavigate }, ref) {
    const items = getNavItems(role)
    return (
      <nav
      ref={ref}
      className="fixed bottom-0 w-full max-w-[430px] mx-auto left-1/2 -translate-x-1/2 flex justify-around items-center px-4 py-2 border-t border-white/[0.07] z-50"
      style={{
        background: 'rgba(10, 10, 11, 0.96)',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
        willChange: 'auto',
      }}
    >
      {items.map(item => {
        const isActive = activeTab === item.path
        const Icon = item.Icon
        return (
          <button
            key={item.path}
            onClick={() => onNavigate(item.path)}
            className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all relative"
            style={{
              background: isActive ? 'rgba(200,242,90,0.06)' : 'transparent',
              minWidth: 52,
            }}
          >
            <Icon size={20} color={isActive ? ACTIVE_COLOR : DEFAULT_COLOR} />
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontWeight: 500,
                fontSize: '9px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase' as const,
                color: isActive ? '#C8F25A' : 'rgba(255,255,255,0.35)',
              }}
            >
              {item.label}
            </span>
            {isActive && (
              <span
                className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                style={{ background: '#C8F25A' }}
              />
            )}
          </button>
        )
      })}
      </nav>
    )
  },
)
