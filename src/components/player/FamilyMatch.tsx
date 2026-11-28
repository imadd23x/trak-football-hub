import { useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { UseQueryResult } from '@tanstack/react-query'
import { CalendarDays, Check, Clock, MapPin, UserRound } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTranslation } from '@/lib/i18n'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { academyLine, eventDay, eventHeading, type PlayerEvent } from '@/lib/player-events'
import { venueParts } from '@/lib/venue-link'
import { planBadge, useSharedPlan } from '@/lib/games/shared-plans'
import { useReview, type Review } from '@/lib/games/reviews'
import { useMarkOpened, wasOpened } from '@/lib/games/news'
import { useFrameTrail } from '@/components/trak/FamilyFrame'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { TOP_BAR } from '@/components/arc/blocks/sidebar-rail/sidebar-rail'
import { PageHeader, PageHeaderPanel } from '@/components/arc/blocks/page-header/page-header'
import { ArcProvider } from '@/components/arc/lib/arc-provider'
import { Breadcrumb } from '@/components/arc/breadcrumb/breadcrumb'
import { Badge } from '@/components/arc/badge/badge'
import { LockIcon } from '@/components/icons/LockIcon'
import { EventDetails } from './EventDetails'
import { LineUpCard } from './LineUpCard'

/* TRAK-441 slice 3.3 (Imad, 12 Nov): a match as a player and a parent read it, in the coach's look: his match header
   (the match said once: who, day, kick-off, venue, and a badge) over tabs. A player: Logistics, Game plan, Evaluation.
   A parent: Logistics, Evaluation, and nothing about the job, the note or the line-up (TRAK-319). "New" marks the tab
   this device hasn't opened. Behind the academy's family_look switch. Slice 7: a training, or any event that isn't a
   match, is the same header over its Logistics alone: no tabs, and nothing from the coach's training plan. */

type Tab = 'logistics' | 'plan' | 'evaluation'
type Who = { id: string; name: string }

const card = 'rounded-2xl border border-line bg-surface p-5 laptop:p-6'
const h2 = 'text-lg font-medium text-ink'
const label = 'text-[14px] text-ink-3'
const split = 'grid grid-cols-[minmax(0,1fr)] gap-4 pt-4 laptop:items-start laptop:gap-6'
const col = 'grid grid-cols-[minmax(0,1fr)] gap-4 laptop:gap-6'
const meta = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const
const RouterLink = ({ href, ...props }: { href: string; children?: ReactNode }) => <Link to={href} {...props} />

export function FamilyMatch({ event, changes, child, as, back, cantMakeIt, children }: {
  event: PlayerEvent
  /** TRAK-134: what moved since this device last saw it. */
  changes: string[]
  /** The child, with the first name a parent reads. */
  child: Who
  as: 'player' | 'parent'
  /** Where the trail's first crumb goes: the page this one was opened from. */
  back: { href: string; go: () => void }
  cantMakeIt?: ReactNode
  /** TRAK-601: under the logistics, a training's plan. */
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const wide = useSideMenuScreen()
  const { hash } = useLocation()
  const asPlayer = as === 'player'
  const isMatch = event.kind === 'match'
  const plan = useSharedPlan(event, child.id, asPlayer)
  const review = useReview(event, child.id, asPlayer)
  const title = event.opponent ? `vs ${event.opponent}` : eventHeading(event)
  const inTopBar = useFrameTrail(title)
  const [picked, setPicked] = useState<Tab | null>(null)
  // The tab with news, as it was when the page opened: showing it marks it opened, and "New" stays for this visit.
  const news = useRef<Tab | null>()

  // Only a match reads a plan or a review (the hooks wait for nothing otherwise).
  if (isMatch && (plan.isPending || review.isPending)) return <LoadingSkeleton className="pt-12" label={t('coachMatches:loadingMatch')} lines={4} />

  if (news.current === undefined && user) {
    // ponytail: never opened on this device, whatever its age; a "since" per reader if old matches read New too long.
    const unseen = (what: 'plan' | 'review') => !wasOpened(user.id, child.id, what, event.id, new Date(0).toISOString())
    news.current = review.data ? (unseen('review') ? 'evaluation' : null) : asPlayer && plan.data && unseen('plan') ? 'plan' : null
  }
  const cancelled = event.status === 'cancelled'
  // Not attending never reaches a family: the database's copy reads Not selected (20261107100000).
  const role = plan.data && (plan.data.plan.role === 'not_attending' ? 'not_selected' : plan.data.plan.role)
  const [ours, theirs] = review.data ? [review.data.ourScore, review.data.theirScore] : [0, 0]
  const status = cancelled ? <Badge tone="danger" dot>{t('coachHome:noteCancelled')}</Badge>
    : review.data ? <Badge tone={ours > theirs ? 'success' : 'neutral'} dot>{t(ours > theirs ? 'common:matchWon' : ours < theirs ? 'common:matchLost' : 'common:matchDrew', { ours, theirs })}</Badge>
    : role ? <Badge tone={role === 'starter' ? 'success' : 'neutral'} dot>{asPlayer ? t(`common:you_${role}`) : t(`common:child_${role}`, { name: child.name })}</Badge>
    : undefined

  const place = event.venue ? venueParts(event.venue).text : null
  const side = event.homeAway === 'home' ? t('coachSchedule:home') : event.homeAway === 'away' ? t('coachSchedule:away') : null
  const academy = academyLine(event)
  const extra = (tab: Tab) => news.current === tab ? <Badge tone="success" size="sm">{t('common:new')}</Badge>
    : tab === 'plan' && plan.data && planBadge(plan.data.plan.updated, event) === 'updated' ? <Badge tone="info" size="sm">{t('common:updated')}</Badge>
    : undefined
  // An alert opens the page at the plan (#game-plan); otherwise at the latest thing the coach sent.
  const first: Tab = hash === '#game-plan' && asPlayer && plan.data ? 'plan' : review.data ? 'evaluation' : asPlayer && plan.data ? 'plan' : 'logistics'
  const logistics = <div className="grid gap-4 pt-4"><EventDetails event={event} changes={changes} bare />{cantMakeIt}{children}</div>

  return <ArcProvider link={RouterLink}>
    {/* On a laptop the trail is the top bar's and a family page has no actions, so the header's own top row folds away. */}
    <PageHeader className="[--ph-bleed:1.25rem] tablet:[--ph-bleed:2rem] laptop:![--ph-bar:0px]" top={wide ? `${TOP_BAR}px` : '0px'}
      title={title} status={status}
      crumbs={inTopBar ? undefined : <Breadcrumb items={[{ label: t(back.href.endsWith('/home') ? 'nav:home' : back.href.endsWith('/trainings') ? 'nav:trainings' : asPlayer ? 'nav:matches' : 'nav:events'), href: back.href,
        onClick: click => { click.preventDefault(); back.go() } }, { label: title }]} />}
      details={<>
        <span><CalendarDays {...meta} /><strong>{eventDay(event)}</strong></span>
        {event.time && <span><Clock {...meta} />{t(isMatch ? 'coachSquad:kickOffAt' : 'coachSquad:startsAt', { time: event.time })}{academy && ` · ${academy}`}</span>}
        {(place || side) && <span><MapPin {...meta} />{place && <strong>{place}</strong>}{place && side && ' · '}{side}</span>}
        {!asPlayer && <span><UserRound {...meta} />{child.name}</span>}
      </>}
      tabsLabel={title} value={picked ?? first} onValueChange={next => setPicked(next as Tab)}
      tabs={cancelled || !isMatch ? [] : [
        { value: 'logistics', label: t('coachMatches:actLogistics') },
        ...(asPlayer ? [{ value: 'plan', label: t('coachHome:gamePlan'), extra: extra('plan') }] : []),
        { value: 'evaluation', label: t('nav:evaluation'), extra: extra('evaluation') },
      ]}>
      {cancelled || !isMatch ? logistics : <>
        <PageHeaderPanel value="logistics">{logistics}</PageHeaderPanel>
        {asPlayer && <PageHeaderPanel value="plan"><Plan query={plan} eventId={event.id} childId={child.id} /></PageHeaderPanel>}
        <PageHeaderPanel value="evaluation"><Evaluation query={review} eventId={event.id} child={child} asPlayer={asPlayer} /></PageHeaderPanel>
      </>}
    </PageHeader>
  </ArcProvider>
}

function OnlyYou() {
  const { t } = useTranslation()
  return <span className="inline-flex flex-none items-center gap-1.5 text-[13px] text-ink-3"><LockIcon size={15} />{t('common:onlyYou')}</span>
}

/** A tab with nothing in it yet, or one that didn't load. */
function Quiet({ query, loadFailed, empty }: { query: UseQueryResult<unknown>; loadFailed: string; empty: string }) {
  const { t } = useTranslation()
  return <p className="pt-4 text-[15px] text-ink-2">{query.isError ? <>{loadFailed}{' '}
    <button type="button" onClick={() => void query.refetch()} className="rounded font-medium text-brand underline-offset-4 hover:underline">{t('coachTraining:tryAgain')}</button>
  </> : empty}</p>
}

function FromCoach({ name, note }: { name: string | null; note: string }) {
  const { t } = useTranslation()
  return <section className={card}>
    <div className="flex items-center justify-between gap-3"><h2 className={h2}>{name ? t('common:fromCoach', { name }) : t('common:fromYourCoach')}</h2><OnlyYou /></div>
    <p className="mt-2 whitespace-pre-line text-[15px] text-ink-2">{note}</p>
  </section>
}

/** The player's own: his job (or, left out, that he is), the coach's note, the team's instructions and the line-up. */
function Plan({ query, eventId, childId }: { query: ReturnType<typeof useSharedPlan>; eventId: string; childId: string }) {
  const { t } = useTranslation()
  useMarkOpened(childId, 'plan', eventId, !!query.data)
  if (!query.data) return <Quiet query={query} loadFailed={t('common:couldntLoadPlan')} empty={t('common:planNotShared')} />
  const { plan, coachName, lineUp } = query.data
  const goals = plan.player?.goals ?? []
  const job = plan.player?.job
  return <div className={`${split} ${lineUp ? 'laptop:grid-cols-2' : ''}`}>
    <div className={col}>
      {plan.role === 'not_selected' ? <section className={card}><h2 className={h2}>{t('common:notInSquadThisWeek')}</h2></section>
        : job && <section className="rounded-2xl border border-brand/25 bg-brand/[.06] p-5 laptop:p-6">
          <div className="flex items-center justify-between gap-3"><h2 className={h2}>{t('common:yourJob')}</h2><OnlyYou /></div>
          <p className="mt-2 whitespace-pre-line text-[20px] font-medium leading-snug tracking-[-0.01em] text-ink">{job}</p>
        </section>}
      {plan.player?.note && <FromCoach name={coachName} note={plan.player.note} />}
      {goals.length > 0 && <section className={card}>
        <h2 className={h2}>{t('common:teamInstructions')}</h2>
        <ol className="mt-3 grid gap-4">{goals.map((goal, i) => <li key={i} className="flex gap-3">
          <span aria-hidden="true" className="grid size-7 flex-none place-items-center rounded-full bg-ink text-[13px] font-medium text-surface">{i + 1}</span>
          <span className="grid"><span className="text-[15px] font-medium text-ink">{goal.title || goal.looksLike}</span>
            {goal.title && goal.looksLike && <span className="text-[14px] text-ink-2">{goal.looksLike}</span>}</span>
        </li>)}</ol>
      </section>}
    </div>
    {lineUp && <LineUpCard lineUp={lineUp} />}
  </div>
}

/** After the match, in words: what was asked and how it went. The player also reads his job, whether he did it and the
 *  coach's note; a parent never does. */
function Evaluation({ query, eventId, child, asPlayer }: { query: UseQueryResult<Review | null>; eventId: string; child: Who; asPlayer: boolean }) {
  const { t } = useTranslation()
  useMarkOpened(child.id, 'review', eventId, !!query.data)
  if (!query.data) return <Quiet query={query} loadFailed={t('common:couldntLoadReview')} empty={t('coachMatches:afterMatch')} />
  const review = query.data
  const context = review.context.map(tag => t(`coachMatches:context_${tag}` as 'coachMatches:context_first_start', { defaultValue: tag }).toLocaleLowerCase())
  const asked = `${t(`common:asked_${review.expectation}`)}${context.length ? ` (${context.join(', ')})` : ''}`
  const against = <Badge tone={review.against === 'above' ? 'success' : 'neutral'} dot>{t(`coachMatches:against_${review.against}`)}</Badge>
  if (!asPlayer) return <div className={split}><section className={card}>
    <h2 className={h2}>{t('common:howItWentFor', { name: child.name })}</h2>
    <p className={`mt-3 ${label}`}>{t('common:whatWeAsked')}</p>
    <div className="mt-0.5 flex items-start justify-between gap-3"><p className="text-[15px] text-ink">{asked}</p>{against}</div>
  </section></div>
  return <div className={`${split} ${review.note ? 'laptop:grid-cols-2' : ''}`}>
    <div className={col}>
      {review.job && <section className={card}>
        <p className={label}>{t('common:yourJob')}</p>
        <p className="mt-0.5 whitespace-pre-line text-[17px] font-medium text-ink">{review.job}</p>
        {review.didJob && <p className="mt-3 flex items-center gap-2.5 text-[16px] text-ink">
          {review.didJob === 'yes' && <span className="grid size-6 flex-none place-items-center rounded-full bg-success text-on-brand"><Check size={14} strokeWidth={2.4} aria-hidden="true" /></span>}
          {t(`common:didJob_${review.didJob}`)}
        </p>}
      </section>}
      <section className={card}>
        <p className={label}>{t('common:againstExpected')}</p>
        <div className="mt-0.5 flex items-start justify-between gap-3"><p className="text-[17px] font-medium text-ink">{asked}</p>{against}</div>
      </section>
    </div>
    {review.note && <FromCoach name={review.coachName} note={review.note} />}
  </div>
}
