import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { dateAsDay, dayAsDate, type EventRow } from '@/lib/coach-events'
import { displayEventTime, localTodayISO } from '@/lib/event-time'
import { STRENGTHS, type PlanForm } from '@/lib/games/plan'
import { playerPlan } from '@/lib/games/lineup'
import { lineUpCounts, readers, shareWall } from '@/lib/games/share'
import { gameWhen, type useWhoCanCome } from './useGames'
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

/* TRAK-286 (Games 4/8): plan step 3, Share (TRAK-282). In the app only: no email, no push. TRAK-287: locked at kick-off,
   nothing is shared any more; the lock's alert says what wasn't. TRAK-290: Share at… behind the share button's chevron;
   a scheduled plan waits with "Shares Thu 19:30", and what's saved by then goes out (Imad, 29 Oct). TRAK-332 (Imad,
   2 Nov): Review & share, one card (Arc Pro Account health, adapted): the plan at a glance, each part with its own Edit,
   and in the card itself the face-to-face tick and Share plan. Share waits only for the logistics and the tick (Imad,
   28 Oct); the other parts say Check and never block. Who sees what and the preview are gone. */

const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`
const list = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
const sub = 'text-sm font-medium text-ink'

export function ShareStep({ game, form, who, sharedAt, changes, onShare, onSchedule, sharing, problem, locked = false, onStep, onEditLogistics, planStartedAt }: {
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
  /** When the plan was first saved: where the countdown's bar starts. */
  planStartedAt: string | null
}) {
  // The face-to-face tick, and Share at…'s pickers. A new share time (scheduled, moved or gone out now) closes them.
  const [talked, setTalked] = useState(false)
  const [picking, setPicking] = useState(false)
  useEffect(() => setPicking(false), [sharedAt])

  if (who.error) return <LoadError what="who can come" onRetry={who.retry} />
  if (who.isPending) return <LoadingSkeleton label="Loading who can come…" rows={2} className="pt-6" />

  const reading = readers(form, who.players)
  const { placed, withJob } = lineUpCounts(form, who.players)
  const bench = who.players.filter(player => !player.absent && playerPlan(form.players, player.id).role !== 'not_selected'
    && playerPlan(form.players, player.id).role !== 'starter').length
  const instructions = form.goals.filter(goal => goal.title.trim() || goal.looksLike.trim()).length
  const strength = STRENGTHS.find(option => option.value === form.strength)?.label
  const names = new Map(who.players.map(player => [player.id, player.name]))
  const changed = changes.map(id => names.get(id)).filter((name): name is string => !!name)
  const waiting = sharedAt != null && !locked && Date.now() < Date.parse(sharedAt)

  const rows: ReviewRow[] = [
    { id: 'logistics', label: 'Logistics', status: game.published ? 'good' : 'risk', onEdit: onEditLogistics,
      detail: game.published ? 'Shared with families' : 'A draft: publish it before you share' },
    { id: 'tactics', label: 'Tactics & analysis', status: strength ? 'good' : 'watch', onEdit: () => onStep(0),
      detail: `${strength ?? 'How strong they are isn’t set'} · ${form.scouting.trim() ? 'scouting written' : 'no scouting'}` },
    { id: 'instructions', label: 'Instructions', status: instructions ? 'good' : 'watch', onEdit: () => onStep(0),
      detail: instructions ? `${instructions} ${instructions === 1 ? 'instruction' : 'instructions'}` : 'None yet' },
    { id: 'line-up', label: 'Line-up', status: placed === form.format ? 'good' : 'watch', onEdit: () => onStep(1),
      detail: `${placed} of ${form.format} placed · ${bench} on the bench` },
    { id: 'jobs', label: 'Jobs', status: placed > 0 && withJob === placed ? 'good' : 'watch', onEdit: () => onStep(1),
      detail: placed === 0 ? 'Nobody is on the pitch yet' : `${withJob} of ${placed} starters have one` },
  ]
  const toCheck = rows.filter(row => row.status !== 'good').length
  const band = !game.published ? { status: 'risk' as const, label: 'Logistics first' }
    : toCheck === 0 ? { status: 'good' as const, label: 'Ready to share' } : { status: 'watch' as const, label: `${toCheck} to check` }
  const { day, time } = gameWhen(game)
  const meta = [day, time ? `Kick-off ${time}` : '', game.home_away === 'home' ? 'Home' : game.home_away === 'away' ? 'Away' : ''].filter(Boolean).join(' · ')
  const holdsBack = !game.published ? 'Publish the match in Logistics first' : !talked ? 'Tick “I’ve talked selection through” to share' : null

  return (
    <div className="arc">
      <PlanReview title={game.opponent ? `vs ${game.opponent}` : game.title} meta={meta} rows={rows} band={band} readOnly={locked}
        countdown={{ label: `Kick-off ${format(new Date(game.starts_at), 'EEE d MMM')}`, start: planStartedAt ?? new Date().toISOString(), end: game.starts_at }}>
        {sharedAt == null && locked ? (
          <section aria-labelledby="plan-not-shared" className="grid gap-1">
            <h4 id="plan-not-shared" className={sub}>Not shared</h4>
            <p className="text-sm text-ink-2">It wasn’t shared before kick-off, so only you saw it.</p>
          </section>
        ) : sharedAt == null ? <>
          <Checkbox label="I’ve talked selection through with the players, face to face" checked={talked}
            description="Before this goes out. Players should hear it from you first." onCheckedChange={value => setTalked(value === true)} />
          <p className="text-sm text-ink-3">{players(reading.length)} and their families, in the app only</p>
          {picking && <ShareAt game={game} initial={{ day: localTodayISO(), time: '' }} cta={when => when ? `Schedule for ${when}` : 'Schedule'}
            busy={sharing} ready={!holdsBack} onSchedule={at => onSchedule(at, talked)} onCancel={() => setPicking(false)} />}
          <div className="flex flex-wrap items-center gap-3">
            {holdsBack && <span className="text-sm text-ink-3">{holdsBack}</span>}
            <span className="ml-auto"><SplitButton label={sharing ? 'Sharing…' : 'Share plan'} onClick={() => onShare(talked)}
              disabled={!!holdsBack || sharing} actions={[{ label: 'Share at…', onSelect: () => setPicking(true), disabled: !!holdsBack }]} /></span>
          </div>
          {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
        </> : waiting ? (
          <section aria-labelledby="plan-scheduled" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 id="plan-scheduled" className={sub}>Scheduled</h4>
              <Badge tone="info">Shares {format(new Date(sharedAt), 'EEE HH:mm')}</Badge>
            </div>
            <p className="text-sm text-ink-2">{players(reading.length)} and their families read it from {format(new Date(sharedAt), 'EEE d MMM, HH:mm')}, in the app only. What you save before then goes out with it.</p>
            {picking
              ? <ShareAt game={game} initial={shareWall(game, sharedAt)} cta={when => when ? `Move to ${when}` : 'Move'} busy={sharing} ready
                  onSchedule={at => onSchedule(at, false)} onCancel={() => setPicking(false)} />
              : <div className="flex flex-wrap gap-2">
                  <Button size="sm" loading={sharing} onClick={() => onShare(false)}>Share now</Button>
                  <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>Change time</Button>
                </div>}
            {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
          </section>
        ) : (
          <section aria-labelledby="plan-shared" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 id="plan-shared" className={sub}>Shared</h4>
              <Badge tone="success">Shared {format(new Date(sharedAt), 'EEE HH:mm')}</Badge>
            </div>
            <p className="text-sm text-ink-2">{players(reading.length)} and their families read it in the app.{locked ? '' : ' Edits stay with you until you share them.'}</p>
            <Alert tone="info" open={!locked && changes.length > 0} title="Changes not shared">
              {changed.length ? `${list(changed)}. ` : ''}Only they and their families get the update.
              <span className="mt-3 block"><Button size="sm" loading={sharing} onClick={() => onShare(false)}>Share changes with {changes.length}</Button></span>
            </Alert>
            {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
          </section>
        )}
      </PlanReview>
    </div>
  )
}

/** TRAK-290: Share at… The day and time are the academy's clock, as every form's are; the database turns them into
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
  const when = day && time ? `${format(dayAsDate(day)!, 'EEE')} ${time}` : null
  return (
    <div className="grid gap-3">
      <DatePicker label="Day" className="arc-trak-field" value={dayAsDate(day)} clearable={false} placeholder="Pick a day"
        onChange={date => { if (date) setDay(dateAsDay(date)) }} minDate={dayAsDate(localTodayISO())}
        maxDate={dayAsDate(displayEventTime(game).date)} format={{ weekday: 'short', day: 'numeric', month: 'short' }} locale="en-GB" />
      <TimePicker label="Time" className="arc-trak-field" value={time} onChange={setTime} minuteStep={5} format="12h"
        placeholder="Pick a time" emptyAt="19:00" />
      <p className="text-sm text-ink-3">Any time before kick-off. Until then, only you see it.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!ready || !day || !time} loading={busy} onClick={() => onSchedule(`${day}T${time}`)}>{cta(when)}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
