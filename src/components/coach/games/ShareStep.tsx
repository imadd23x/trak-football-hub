import { currentLanguage, dateLocale, i18n, useTranslation } from '@/lib/i18n'
import { useState } from 'react'
import { format } from 'date-fns'
import { dateAsDay, dayAsDate, type EventRow } from '@/lib/coach-events'
import { displayEventTime, localTodayISO } from '@/lib/event-time'
import type { PlanForm } from '@/lib/games/plan'
import { planParts, readers, shareWall } from '@/lib/games/share'
import type { useWhoCanCome } from './useGames'
import { LoadError } from '@/components/trak'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { DatePicker } from '@/components/arc/date-picker/date-picker'
import { SplitButton } from '@/components/arc/split-button/split-button'
import { TimePicker } from '@/components/arc/time-picker/time-picker'
import { PlanReview, type ReviewRow } from '@/components/arc/blocks/plan-review/plan-review'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { MatchClock } from './MatchClock'

/* TRAK-286 (Games 4/8): plan step 3, Share (TRAK-282). In the app only: no email, no push. TRAK-287: locked at kick-off,
   nothing is shared any more; the lock's alert says what wasn't. TRAK-290: Share at… behind the share button's chevron;
   a scheduled plan waits with "Shares Thu 19:30", and what's saved by then goes out (Imad, 29 Oct). TRAK-332 (Imad,
   2 Nov): Review & share, one card (Arc Pro Account health, adapted): the plan at a glance, each part with its own Edit,
   and in the card itself the face-to-face tick and Share plan. Share waits only for the logistics and the tick (Imad,
   28 Oct); the other parts never block. Who sees what and the preview are gone. TRAK-344 (Imad, 3 Nov):
   Game plan review says each thing once: no match or time (the header has them), "N incomplete", one countdown, and
   no detail for Logistics or Tactics & analysis. TRAK-371 (Imad, 5 Nov): Jobs is ready once any starter has a job; a
   coach never has to give everyone one. Match header (Imad, 6 Nov): the header's menu can open Schedule here, so the
   page holds whether it's open (`picking`). Imad, 6 Nov: no repeats: "Shared at Fri 19:00" is the heading, with no
   badge or line under it, and a plan locked unshared says "Not shared" alone. */

const list = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')}${i18n.t('coachSquad:fmAnd')}${names.at(-1)}`
const dates = () => (currentLanguage() === 'en' ? 'en-GB' : currentLanguage())
const sub = 'text-sm font-medium text-ink'

export function ShareStep({ game, form, who, sharedAt, changes, onShare, onSchedule, sharing, problem, locked = false, onStep, onEditLogistics, picking, onPicking }: {
  game: EventRow; form: PlanForm; who: ReturnType<typeof useWhoCanCome>; locked?: boolean
  /** When the plan was first shared, or goes out if that's still to come (TRAK-290); null while it's a draft. */
  sharedAt: string | null
  /** The squad rows whose copies a share would change now (game_plan_changes). */
  changes: string[]
  onShare: (talked: boolean) => void
  /** TRAK-290: share at `at`, the academy's day and time ("2026-10-29T19:30"). */
  onSchedule: (at: string, talked: boolean) => void
  /** A share or a schedule is on its way. */
  sharing: boolean
  problem: string | null
  /** Opens a step of the plan, for a part's Edit. */
  onStep: (step: number) => void
  /** Pulls up the event's edit sheet (TRAK-331), for the Logistics part. */
  onEditLogistics: () => void
  /** Whether Schedule's day and time pickers are open. The page closes them at a new share time (scheduled, moved or
   *  gone out now). */
  picking: boolean; onPicking: (open: boolean) => void
}) {
  // The face-to-face tick.
  const [talked, setTalked] = useState(false)
  const { t } = useTranslation()

  if (who.error) return <LoadError what={t('coachMatches:whoCanComeWhat')} onRetry={who.retry} />
  if (who.isPending) return <LoadingSkeleton label={t('coachMatches:loadingWhoCanCome')} rows={2} className="pt-6" />

  const reading = readers(form, who.players)
  const { placed, withJob, bench, instructions, ready, incomplete } = planParts(form, who.players, game.published)
  const names = new Map(who.players.map(player => [player.id, player.name]))
  const changed = changes.map(id => names.get(id)).filter((name): name is string => !!name)
  const waiting = sharedAt != null && !locked && Date.now() < Date.parse(sharedAt)

  const rows: ReviewRow[] = [
    { id: 'logistics', label: t('coachMatches:actLogistics'), status: ready.logistics ? 'good' : 'risk', onEdit: onEditLogistics },
    { id: 'tactics', label: t('coachMatches:stepTactics'), status: ready.tactics ? 'good' : 'watch', onEdit: () => onStep(0) },
    { id: 'instructions', label: t('coachMatches:instructions'), status: ready.instructions ? 'good' : 'watch', onEdit: () => onStep(0),
      detail: instructions ? t('coachMatches:instructionCount', { count: instructions }) : t('coachSquad:noneYet') },
    { id: 'line-up', label: t('coachMatches:lineUp'), status: ready.lineUp ? 'good' : 'watch', onEdit: () => onStep(1),
      detail: t('coachMatches:placedOf', { placed, format: form.format, bench }) },
    { id: 'jobs', label: t('coachMatches:jobs'), status: ready.jobs ? 'good' : 'watch', onEdit: () => onStep(1),
      detail: placed === 0 ? t('coachMatches:nobodyOnPitch') : t('coachMatches:withJobOf', { withJob, placed }) },
  ]
  const band = incomplete === 0 ? { status: 'good' as const, label: t('coachMatches:readyToShare') }
    : { status: game.published ? 'watch' as const : 'risk' as const, label: t('coachMatches:incompleteCount', { count: incomplete }) }
  const holdsBack = !game.published || !talked

  return (
    <div className="arc">
      {/* TRAK-373 (Imad, 5 Nov): after kick-off, the match clock, then "Locked", in the countdown's place. */}
      <PlanReview title={t('coachMatches:reviewTitle')} footerId="plan-share" rows={rows} band={band} readOnly={locked} aside={locked ? <MatchClock game={game} /> : undefined}
        countdown={{ label: t('coachMatches:kickOffIn'), end: game.starts_at, completeLabel: t('coachMatches:locked') }}>
        {sharedAt == null && locked ? (
          <section aria-labelledby="plan-not-shared">
            <h4 id="plan-not-shared" className={sub}>{t('coachMatches:notShared')}</h4>
          </section>
        ) : sharedAt == null ? <>
          {/* TRAK-345 (Imad, 3 Nov): the tick says this and nothing else; Schedule (it was "Share at…") opens under the button.
              TRAK-369 (Imad, 4 Nov): no line for who gets it, nor one for the tick; only the logistics say why Share waits. */}
          <Checkbox label={t('coachMatches:talkedThrough')} checked={talked} onCheckedChange={value => setTalked(value === true)} />
          <div className="flex flex-wrap items-center gap-3">
            {!game.published && <span className="text-sm text-ink-3">{t('coachMatches:publishFirst')}</span>}
            <span className="ml-auto"><SplitButton label={sharing ? t('coachMatches:sharing') : t('coachMatches:actSharePlan')} onClick={() => onShare(talked)}
              disabled={holdsBack || sharing} actions={[{ label: t('coachMatches:schedule'), onSelect: () => onPicking(true), disabled: holdsBack }]} /></span>
          </div>
          {picking && <ShareAt game={game} initial={{ day: localTodayISO(), time: '' }} cta={when => when ? t('coachMatches:scheduleFor', { when }) : t('coachMatches:schedule')}
            busy={sharing} ready={!holdsBack} onSchedule={at => onSchedule(at, talked)} onCancel={() => onPicking(false)} />}
          {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
        </> : waiting ? (
          <section aria-labelledby="plan-scheduled" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 id="plan-scheduled" className={sub}>{t('coachMatches:scheduled')}</h4>
              <Badge tone="info">{t('coachMatches:sharesAt', { when: format(new Date(sharedAt), 'EEE HH:mm', { locale: dateLocale() }) })}</Badge>
            </div>
            <p className="text-sm text-ink-2">{t('coachMatches:scheduledBody', { count: reading.length, when: format(new Date(sharedAt), 'EEE d MMM, HH:mm', { locale: dateLocale() }) })}</p>
            {picking
              ? <ShareAt game={game} initial={shareWall(game, sharedAt)} cta={when => when ? t('coachMatches:moveTo', { when }) : t('coachMatches:move')} busy={sharing} ready
                  onSchedule={at => onSchedule(at, false)} onCancel={() => onPicking(false)} />
              : <div className="flex flex-wrap gap-2">
                  <Button size="sm" loading={sharing} onClick={() => onShare(false)}>{t('coachMatches:shareNow')}</Button>
                  <Button size="sm" variant="secondary" onClick={() => onPicking(true)}>{t('coachMatches:changeTime')}</Button>
                </div>}
            {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
          </section>
        ) : (
          <section aria-labelledby="plan-shared" className="grid gap-3">
            <h4 id="plan-shared" className={sub}>{t('coachMatches:sharedAtTime', { when: format(new Date(sharedAt), 'EEE HH:mm', { locale: dateLocale() }) })}</h4>
            <Alert tone="info" open={!locked && changes.length > 0} title={t('coachMatches:stateChanges')}>
              {changed.length ? t('coachMatches:changedNames', { names: list(changed) }) : ''}{t('coachMatches:onlyTheyGet')}
              <span className="mt-3 block"><Button size="sm" loading={sharing} onClick={() => onShare(false)}>{t('coachMatches:shareChangesWith', { count: changes.length })}</Button></span>
            </Alert>
            {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
          </section>
        )}
      </PlanReview>
    </div>
  )
}

/** TRAK-290: Schedule ("Share at…" until TRAK-345). The day and time are the academy's clock, as every form's are; the database turns them into
 *  the moment it goes out, and refuses one that has passed or isn't before kick-off. */
export function ShareAt({ game, initial, cta, busy, ready, onSchedule, onCancel }: {
  game: EventRow; initial: { day: string; time: string }; busy: boolean
  /** The button's words, given the day and time picked ("Thu 19:30"), or null until both are. */
  cta: (when: string | null) => string
  /** Whatever else must be true first (the face-to-face tick, the logistics). */
  ready: boolean
  onSchedule: (at: string) => void; onCancel: () => void
}) {
  const [day, setDay] = useState(initial.day)
  const [time, setTime] = useState(initial.time)
  const { t } = useTranslation()
  const when = day && time ? `${format(dayAsDate(day)!, 'EEE', { locale: dateLocale() })} ${time}` : null
  return (
    <div className="grid gap-3">
      {/* TRAK-345: the day and the time side by side, on a phone too. */}
      <div className="grid grid-cols-2 gap-3">
        <DatePicker label={t('coachMatches:day')} className="arc-trak-field min-w-0" value={dayAsDate(day)} clearable={false} placeholder={t('coachMatches:pickDay')}
          onChange={date => { if (date) setDay(dateAsDay(date)) }} minDate={dayAsDate(localTodayISO())}
          maxDate={dayAsDate(displayEventTime(game).date)} format={{ weekday: 'short', day: 'numeric', month: 'short' }} locale={dates()} />
        <TimePicker label={t('coachMatches:time')} className="arc-trak-field min-w-0" value={time} onChange={setTime} minuteStep={5} format="12h"
          placeholder={t('coachSchedule:pickTime')} emptyAt="19:00" />
      </div>
      <p className="text-sm text-ink-3">{t('coachMatches:anyTimeBefore')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!ready || !day || !time} loading={busy} onClick={() => onSchedule(`${day}T${time}`)}>{cta(when)}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t('coachSchedule:cancel')}</Button>
      </div>
    </div>
  )
}
