import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { registerProblem } from '@/lib/event-register'
import { DRILL_DETAILS, trainingEnd, trainingMinutes } from '@/lib/training/sessions'
import { loopNote, loopState, practiceStarts } from '@/lib/training/loop'
import { fromSaved, overTime, planPath, plannedMinutes, sourceLabel, viewPath, type Practice } from '@/lib/training/plans'
import { gameWhen } from '@/components/coach/games/useGames'
import { useNotes, usePlan, useRegisters, useTraining, type Plan, type Training } from '@/components/coach/training/useTraining'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { LoopStrip } from '@/components/coach/training/LoopStrip'
import { RegisterSheet } from '@/components/coach/training/RegisterSheet'
import { LoadError, WIDE_COLUMN } from '@/components/trak'
import { Planner } from './Planner'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'

/* TRAK-295 (Training 2/5, spec TRAK-293, mockup boards 3A and 5): a training's plan. Write my own
   (/coach/training/:eventId/plan) types practices one at a time and saves the plan whole; the plan
   (/coach/training/:eventId) shows it with the loop. Only the coach sees either. TRAK-296 (Training 3/5): a practice
   comes from My drills or the Library too, added or swapped in through AddSheet, and Training › Drills can send a
   drill here ("Add to <training>"). TRAK-297 (Training 4/5): Copy a past session opens the planner filled in with its
   practices; nothing saves until Save the plan. TRAK-298 (Training 5/5): the plan page runs the loop: Who's here opens
   the existing register, and the training closes on its own once it has ended with its register taken (Kostas,
   28 Oct). View (/coach/training/:eventId/view) is the plan read at the pitch side: TRAK-309 (Kostas, 29 Oct) took Run
   it out of the loop and named the button and its page View. */

const TRAINING_PATH = '/coach/training'
const linkClass = 'rounded text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

/** The training and its plan, read together, so the page never shows "Not planned" before the plan arrives. */
function WithTraining({ children, wide = false }: { children: (training: Training, plan: Plan | null) => ReactNode; wide?: boolean }) {
  const { eventId } = useParams()
  const training = useTraining(eventId)
  const plan = usePlan(eventId)
  return (
    <div className="min-h-screen bg-ground pb-28">
      {/* TRAK-340: Plan session takes the coach pages' width (TRAK-307), for its two columns. */}
      <div className={wide ? WIDE_COLUMN : 'mx-auto w-full max-w-[1040px] px-5 tablet:px-8'}>
        {training.error || plan.error
          ? <div className="pt-10"><LoadError what="this training" onRetry={() => { void training.refetch(); void plan.refetch() }}
              retrying={training.isFetching || plan.isFetching} /></div>
          : training.isPending || plan.isPending ? <p role="status" className="pt-14 text-center text-[13px] text-ink-3">Loading the training…</p>
          : !training.data ? <div className="grid gap-3 pt-10">
              <p className="text-[15px] text-ink-2">This training isn’t on your schedule.</p>
              <Link to={TRAINING_PATH} className={linkClass}>Back to Training</Link>
            </div>
          // Keyed by training: a route that only changes :eventId must never carry one plan's typing into another's.
          : <div key={training.data.id}>{children(training.data, plan.data)}</div>}
      </div>
    </div>
  )
}

function Header({ training, children }: { training: Training; children: ReactNode }) {
  const { day, time, academy } = gameWhen(training)
  const minutes = trainingMinutes(training)
  return (
    <header className="arc grid gap-4 pt-5 pb-2">
      {/* TRAK-334: where the coach came from (Training, Home), as every coach page's trail. */}
      <CoachTrail current={day} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-[11px] font-medium uppercase tracking-[.09em] text-brand">Training</p>
          <h1 className="text-[26px] font-medium tracking-[-0.01em] text-ink">{[day, time].filter(Boolean).join(' · ')}</h1>
          <p className="text-sm text-ink-2 break-words">{[training.title, training.venue, minutes ? `${minutes} min` : null].filter(Boolean).join(' · ')}</p>
          {academy && <p className="text-sm text-ink-3">{academy}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </header>
  )
}

/** The plan runs longer than the training was set for: said plainly, never a block (Kostas, 28 Oct). */
function OverTime({ text }: { text: string }) {
  return <p role="status" className="mt-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink">{text}</p>
}

/** The details a practice has, in the mockup's order: "20 × 30 m · 4v4 + 2". */
const detailsLine = (practice: Practice) => DRILL_DETAILS.map(d => practice[d.key].trim()).filter(Boolean).join(' · ')

function PracticeRow({ practice, actions }: { practice: Practice; actions?: ReactNode }) {
  const details = detailsLine(practice)
  const tag = sourceLabel(practice)
  return (
    <div className="arc flex flex-wrap items-start gap-x-3.5 gap-y-1 rounded-2xl border border-line bg-surface px-4 py-3.5 tablet:flex-nowrap tablet:px-5">
      <span className="w-11 flex-none pt-px text-center text-base font-medium text-ink">{practice.minutes}<span className="block text-[11px] font-normal text-ink-3">min</span></span>
      <div className="grid min-w-0 flex-1 gap-1">
        {/* TRAK-340: the part it fills, when it's a different name. */}
        {practice.part && practice.part !== practice.name && <p className="text-[13px] text-ink-3 break-words">{practice.part}</p>}
        <p className="text-[15px] font-medium text-ink break-words">{practice.name}</p>
        {practice.tell.trim() && <p className="text-sm text-ink-2 break-words">“{practice.tell.trim()}”</p>}
        {details && <p className="text-sm text-ink-3 break-words">{details}</p>}
        <span><Badge size="sm" tone={tag === 'Your drill' ? 'success' : tag.startsWith('Library') ? 'info' : 'neutral'}>{tag}</Badge></span>
      </div>
      {/* On a phone the buttons sit under the practice, so its name keeps the width. */}
      {actions && <div className="flex w-full justify-end tablet:w-auto">{actions}</div>}
    </div>
  )
}

/* ── Plan session (TRAK-340) ──────────────────────────────────────────────── */

export function PlanEditorRoute() {
  return <WithTraining wide>{(training, plan) => training.status === 'cancelled'
    ? <><Header training={training}><Badge tone="danger">Cancelled</Badge></Header>
      <p className="pt-4 text-[15px] text-ink-2">This training was cancelled, so its plan can’t change.</p></>
    : <Planner training={training} saved={plan} />}</WithTraining>
}

/* ── The plan ─────────────────────────────────────────────────────────────── */

export function PlanRoute() {
  return <WithTraining>{(training, plan) => <PlanView training={training} plan={plan} />}</WithTraining>
}

function PlanView({ training, plan }: { training: Training; plan: Plan | null }) {
  const navigate = useNavigate()
  const registers = useRegisters()
  const notes = useNotes()
  const [sheet, setSheet] = useState<'register' | 'log' | null>(null)
  const [now] = useState(() => Date.now())
  const cancelled = training.status === 'cancelled'
  const practices = fromSaved(plan?.practices ?? [])
  const total = plannedMinutes(practices)

  const sessionId = registers.data?.get(training.id) ?? null
  const started = Date.parse(training.starts_at) <= now
  const over = trainingEnd(training) <= now
  const loop = loopState({ planned: !!plan, registered: !!sessionId, noted: !!notes.data?.has(training.id), started, over })
  // Who's here opens as the register does everywhere else: published, not cancelled, started.
  const registerWhy = registerProblem({ ...training, event_type: 'training' }, new Date(now))
  const canRegister = !!registers.data && !sessionId && !registerWhy
  const view = () => navigate(viewPath(training.id))
  // TRAK-339 (Kostas, 29 Oct): planning goes straight to the planner; no "How do you want to plan it?".
  const planIt = () => navigate(planPath(training.id))

  return <>
    <Header training={training}>
      {cancelled ? <Badge tone="danger">Cancelled</Badge>
        : loop.closed ? <>
          <Badge tone="success">Closed</Badge>
          <Button variant="secondary" onClick={() => setSheet('log')}>View log</Button>
        </> : <>
          <Badge tone={plan ? 'success' : 'warning'}>{plan ? 'Ready' : 'Not planned'}</Badge>
          {/* On the day, the main action is Who's here; otherwise View, the plan at the pitch side. */}
          {canRegister && <Button onClick={() => setSheet('register')}>Who’s here</Button>}
          {plan && <Button variant={canRegister ? 'secondary' : 'primary'} onClick={view}>View</Button>}
          {sessionId && <Button variant="ghost" onClick={() => setSheet('register')}>Edit register</Button>}
          {plan ? <Button variant="secondary" onClick={() => navigate(planPath(training.id))}>Change the plan</Button>
            : <Button variant={canRegister ? 'secondary' : 'primary'} onClick={planIt}>Plan session</Button>}
        </>}
    </Header>
    {!cancelled && <div className="grid gap-2 pt-2">
      <LoopStrip state={loop} note={loopNote(loop, started)} />
      {registers.error ? <p role="alert" className="text-sm text-danger">Couldn’t check the register. <button type="button"
        className={`min-h-11 ${linkClass}`} onClick={() => void registers.refetch()}>Try again</button></p>
        : !sessionId && registerWhy && <p className="text-sm text-ink-3">{registerWhy === 'The register opens once the event has started'
          ? 'Who’s here opens when the training starts.' : `Who’s here: ${registerWhy.toLowerCase()}.`}</p>}
    </div>}

    <section aria-labelledby="practices" className="mt-6 grid max-w-[720px] gap-2.5">
      {plan ? <>
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="practices" className="text-lg font-medium text-ink">Practices</h2>
          <span className="text-[13px] text-ink-3">{practices.length} {practices.length === 1 ? 'practice' : 'practices'} · {total} min</span>
        </div>
        {!cancelled && overTime(total, trainingMinutes(training)) && <OverTime text={overTime(total, trainingMinutes(training))!} />}
        <ol className="grid gap-2.5">{practices.map((practice, i) => <li key={i}><PracticeRow practice={practice} /></li>)}</ol>
      </> : <>
        <h2 id="practices" className="sr-only">Practices</h2>
        <div className="arc">
          <EmptyState icon={<ClipboardList size={24} strokeWidth={1.5} />} title={cancelled ? 'This training was cancelled' : 'Not planned yet'}
            description={cancelled ? 'It had no plan.' : 'Plan it your way. Only you see the plan.'}
            action={cancelled ? undefined : <Button onClick={planIt}>Plan session</Button>} />
        </div>
      </>}
      <Link to={`/coach/schedule?event=${training.id}`} className={`mt-2 justify-self-start ${linkClass}`}>Open in Schedule</Link>
    </section>

    <RegisterSheet training={training} sheet={sheet} sessionId={sessionId} onClose={() => setSheet(null)} />
  </>
}

/* ── View ─────────────────────────────────────────────────────────────────── */

export function PitchViewRoute() {
  return <WithTraining>{(training, plan) => <PitchView training={training} plan={plan} />}</WithTraining>
}

/** The plan at the pitch side, on a phone: big type, one practice per row, when each starts and how long it runs. */
function PitchView({ training, plan }: { training: Training; plan: Plan | null }) {
  const practices = fromSaved(plan?.practices ?? [])
  const { day, time } = gameWhen(training)
  const starts = practiceStarts(time || null, practices)
  return <div className="mx-auto grid max-w-[720px] gap-5 pt-5">
    {/* TRAK-334: opened from Training home's View plan, the trail goes back there; from the training's page, to that,
        which is also where it sits when opened from a link. */}
    <CoachTrail current="View" parents={[{ label: day, href: `${TRAINING_PATH}/${training.id}` }]} />
    <header className="grid gap-1">
      <p className="text-[11px] font-medium uppercase tracking-[.09em] text-brand">View</p>
      <h1 className="text-[28px] font-medium leading-tight text-ink">{[day, time].filter(Boolean).join(' · ')}</h1>
      <p className="text-base text-ink-2 break-words">{[training.title, training.venue].filter(Boolean).join(' · ')}</p>
    </header>
    {practices.length === 0 ? <p className="text-[17px] text-ink-2">Nothing planned yet. <Link to={planPath(training.id)} className={linkClass}>Plan it</Link></p>
      : <ol aria-label="Practices to run" className="grid gap-3">
        {practices.map((practice, i) => {
          const details = detailsLine(practice)
          return <li key={i} className="flex gap-4 rounded-2xl border border-line bg-surface p-4 tablet:p-5">
            <div className="w-16 flex-none text-center">
              {starts[i] && <p className="text-[15px] font-medium text-brand">{starts[i]}</p>}
              <p className="text-[28px] font-medium leading-none text-ink">{practice.minutes}</p>
              <p className="text-[13px] text-ink-3">min</p>
            </div>
            <div className="grid min-w-0 flex-1 content-start gap-1.5">
              <p className="text-[22px] font-medium leading-snug text-ink break-words">{practice.name}</p>
              {practice.tell.trim() && <p className="text-[19px] leading-snug text-ink break-words">“{practice.tell.trim()}”</p>}
              {details && <p className="text-[17px] text-ink-2 break-words">{details}</p>}
            </div>
          </li>
        })}
      </ol>}
  </div>
}
