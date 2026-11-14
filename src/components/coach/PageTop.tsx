import type { HTMLAttributes, ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useTranslation } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { CoachMenuButton } from '@/components/coach/CoachFrame'

/* TRAK-422 (Kostas, 13 Nov): ONE page title on every coach page, Squad's and Matches' style: 22 px on a phone, 26 px on
   a coach's tablet or laptop (index.css), medium weight. The title's row is at least 40 px high, the avatar's height, so
   the title sits at the same height whether or not the avatar, a tab switch or a button shares its row; and every page's
   header starts 20 px below the top (below the laptop's top bar), so the gap above the title is the same everywhere.
   Inner pages (a match, a training, a player) keep their own header, the match page's (Arc's Page header). */
export const PAGE_TITLE = 'flex min-h-10 min-w-0 items-center text-[22px] font-medium leading-tight tracking-[-0.01em] text-ink'

/** TRAK-422: the second style, an inner page's title (a match, a training, Who's here, Plan session): the match page's
 *  (Arc's Page header .title), 28 px on a phone, 36 px from 560 px wide, medium. */
export const INNER_TITLE = 'text-[28px] font-medium leading-[1.1] tracking-[-0.03em] text-ink min-[560px]:text-[36px]'

export function PageTitle({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h1 className={cn(PAGE_TITLE, className)} {...rest}>{children}</h1>
}

/** The top of a coach page: the trail (a sub-page's way back, on a phone), the avatar that opens the menu (a phone),
 *  the title, what sits beside the title (`children`: a tab switch, buttons), and a line under it (`below`). */
export function PageTop({ title, trail, menu = true, below, titleId, className, children }: {
  title: ReactNode
  trail?: ReactNode
  /** The avatar that opens the side menu on a phone. A sub-page has the trail instead. */
  menu?: boolean
  below?: ReactNode
  /** For a page that labels a region with its title, or moves focus to it. */
  titleId?: string
  className?: string
  children?: ReactNode
}) {
  const { profile } = useAuth()
  const { t } = useTranslation()
  return (
    <header className={cn('grid gap-3 pt-5 pb-4', className)}>
      {trail}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3 self-start">
          {menu && <CoachMenuButton name={profile?.full_name || t('nav:coach')} />}
          <PageTitle id={titleId} tabIndex={titleId ? -1 : undefined} className={titleId ? 'outline-none' : undefined}>{title}</PageTitle>
        </div>
        {children}
      </div>
      {below}
    </header>
  )
}
