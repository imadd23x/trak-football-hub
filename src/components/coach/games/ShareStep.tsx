import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Lock } from 'lucide-react'
import { dateAsDay, dayAsDate, type EventRow } from '@/lib/coach-events'
import { displayEventTime, localTodayISO } from '@/lib/event-time'
import type { PlanForm } from '@/lib/games/plan'
import { playerPlan } from '@/lib/games/lineup'
import { lineUpCounts, previewOf, readers, shareWall } from '@/lib/games/share'
import { GamePlanSection } from '@/components/player/GamePlanSection'
import type { useWhoCanCome } from './useGames'
import { LoadError } from '@/components/trak'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { DatePicker } from '@/components/arc/date-picker/date-picker'
import { TimePicker } from '@/components/arc/time-picker/time-picker'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Select } from '@/components/arc/select/select'
import { ShareReadiness } from '@/components/arc/blocks/release-readiness/share-readiness'

/* TRAK-286 (Games 4/8): plan step 3, Share (TRAK-282). Before the first share: the readiness checks and Share now,
   held back only by the logistics and the face-to-face tick (Imad, 28 Oct). After it: when it was shared and, for
   edits since, who they change and "Share the changes with N". Who sees what, and a preview drawn by the player's
   and the parent's own Game plan section. In the app only: no email, no push. TRAK-287: locked at kick-off, nothing
   is shared any more; the lock's alert says what wasn't. TRAK-290: Share at… behind Share now's chevron (Arc's
   split-button: Share now is the usual pick, a time is its variant). A scheduled plan waits with "Shares Thu 19:30";
   the coach can move the time or share it now, and what's saved by then goes out (Imad, 29 Oct). */

const card = 'grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5'
const first = (name: string) => name.split(/\s+/)[0] || name
const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`
const list = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

export function ShareStep({ game, form, who, sharedAt, changes, coachName, onShare, onSchedule, sharing, problem, locked = false }: {
  game: EventRow; form: PlanForm; who: ReturnType<typeof useWhoCanCome>; locked?: boolean
  /** When the plan was first shared, or goes out if that's still to come (TRAK-290); null while it's a draft. */
  sharedAt: string | null
  /** The squad rows whose copies a share would change now (game_plan_changes). */
  changes: string[]
  coachName: string | null
  onShare: (talked: boolean) => void
  /** TRAK-290: share at `at`, the academy's day and time ("2026-10-29T19:30"). */
  onSchedule: (at: string, talked: boolean) => void
  /** A share or a schedule is on its way. */
  sharing: boolean
  problem: string | null
}) {
  const [talked, setTalked] = useState(false)
  const [picking, setPicking] = useState(false)
  // A new share time (scheduled, moved or gone out now) closes the picker.
  useEffect(() => setPicking(false), [sharedAt])
  const [as, setAs] = useState<'player' | 'parent'>('player')
  const [pick, setPick] = useState<string | null>(null)

  if (who.error) return <LoadError what="who can come" onRetry={who.retry} />
  if (who.isPending) return <p role="status" className="pt-6 text-center text-[13px] text-ink-3">Loading who can come…</p>

  const reading = readers(form, who.players)
  const { placed, withJob } = lineUpCounts(form, who.players)
  const names = new Map(who.players.map(player => [player.id, player.name]))
  const changed = changes.map(id => names.get(id)).filter((name): name is string => !!name)
  const shown = reading.find(player => player.id === pick)
    ?? reading.find(player => playerPlan(form.players, player.id).role === 'starter') ?? reading[0]
  const role = (id: string) => ({ starter: '', bench: ' · bench', not_selected: ' · not selected' })[playerPlan(form.players, id).role]
  const waiting = sharedAt != null && !locked && Date.now() < Date.parse(sharedAt)

  return (
    <div className="grid gap-4 tablet:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tablet:items-start">
      <div className="grid min-w-0 gap-4">
        {sharedAt == null && locked ? (
          <section aria-labelledby="plan-not-shared" className={card}>
            <h2 id="plan-not-shared" className="text-lg font-medium text-ink">Not shared</h2>
            <p className="text-sm text-ink-2">It wasn’t shared before kick-off, so only you saw it.</p>
          </section>
        ) : sharedAt == null ? (
          <div className="arc">
            <ShareReadiness title="Share the plan" subtitle={`${players(reading.length)} and their families, in the app only`}
              actionLabel="Share now" onAction={() => onShare(talked)} busy={sharing && !picking} error={problem}
              alternatives={[{ label: 'Share at…', onSelect: () => setPicking(true) }]}
              checks={[
                { id: 'logistics', label: 'Logistics shared with families', required: true, done: game.published,
                  detail: game.published ? 'Families have the time and the place.' : 'Publish the match in Logistics first.' },
                { id: 'line-up', label: 'Line-up complete', done: placed === form.format,
                  detail: `${placed} of ${form.format} placed.${placed === form.format ? '' : ' You can share before it’s complete.'}` },
                { id: 'jobs', label: 'Every starter has a job', done: placed > 0 && withJob === placed,
                  detail: placed === 0 ? 'Nobody is on the pitch yet.' : `${withJob} of ${placed} starters have one.${withJob === placed ? '' : ' You can still share.'}` },
                { id: 'talked', label: 'I’ve talked selection through with the players, face to face', required: true, done: talked,
                  detail: 'Before this goes out. Players should hear it from you first.', onCheckedChange: setTalked },
              ]}>
              {picking && <ShareAt game={game} initial={{ day: localTodayISO(), time: '' }} cta={when => when ? `Schedule for ${when}` : 'Schedule'} busy={sharing}
                ready={talked && game.published} onSchedule={at => onSchedule(at, talked)} onCancel={() => setPicking(false)} />}
            </ShareReadiness>
          </div>
        ) : waiting && sharedAt ? (
          <section aria-labelledby="plan-scheduled" className={`arc ${card}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="plan-scheduled" className="text-lg font-medium text-ink">Scheduled</h2>
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
          <section aria-labelledby="plan-shared" className={`arc ${card}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="plan-shared" className="text-lg font-medium text-ink">Shared</h2>
              <Badge tone="success">Shared {format(new Date(sharedAt), 'EEE HH:mm')}</Badge>
            </div>
            <p className="text-sm text-ink-2">{players(reading.length)} and their families read it in the app.{locked ? '' : ' Edits stay with you until you share them.'}</p>
            <Alert tone="info" open={!locked && changes.length > 0} title="Changes not shared">
              {changed.length ? `${list(changed)}. ` : ''}Only they and their families get the update.
              <span className="mt-3 block"><Button size="sm" loading={sharing} onClick={() => onShare(false)}>Share the changes with {changes.length}</Button></span>
            </Alert>
            {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
          </section>
        )}

        <section aria-labelledby="plan-who" className={card}>
          <h2 id="plan-who" className="text-lg font-medium text-ink">Who sees what</h2>
          <ul className="divide-y divide-line">
            <li className="grid gap-0.5 py-3"><span className="text-sm font-medium text-ink">Each player</span>
              <span className="text-sm text-ink-3">The goals, their job, and your note to them.</span></li>
            <li className="grid gap-0.5 py-3"><span className="text-sm font-medium text-ink">Families</span>
              <span className="text-sm text-ink-3">The logistics and their player’s job, or “Not in the squad this week”. Never your note.</span></li>
            <li className="grid gap-0.5 py-3"><span className="flex items-center gap-1.5 text-sm font-medium text-ink">Only you<Lock size={14} aria-hidden="true" /></span>
              <span className="text-sm text-ink-3">Expectations and context, until you publish the evaluation. How strong they are and scouting, always.</span></li>
          </ul>
        </section>
      </div>

      <section aria-labelledby="plan-preview" className={`arc ${card}`}>
        <h2 id="plan-preview" className="text-lg font-medium text-ink">Preview</h2>
        {!shown ? <p className="text-sm text-ink-2">Nobody who can come is in this squad yet, so nobody would read it.</p> : <>
          <SegmentedControl label="Preview as" value={as} onValueChange={value => setAs(value as 'player' | 'parent')}
            options={[{ value: 'player', label: 'As the player' }, { value: 'parent', label: 'As the parent' }]} />
          <div className="max-w-[320px]">
            <Select label="Player" value={shown.id} onValueChange={setPick}
              options={reading.map(player => ({ value: player.id, label: `${player.name}${role(player.id)}` }))} />
          </div>
          <div className="rounded-[24px] border border-line bg-ground p-4">
            <GamePlanSection as={as} coachName={coachName} childName={first(shown.name)} plan={previewOf(form, shown.id, as)} />
          </div>
        </>}
      </section>
    </div>
  )
}

/** TRAK-290: Share at… The day and time are the academy's clock, as every form's are; the database turns them into
 *  the moment it goes out, and refuses one that has passed or isn't before kick-off. */
function ShareAt({ game, initial, cta, busy, ready, onSchedule, onCancel }: {
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
