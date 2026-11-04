import { useLayoutEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { Check, Copy, History, Info, Plus, TrafficCone, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCoachSquad } from '@/lib/coach-squad'
import { localTodayISO, phoneEventTime } from '@/lib/event-time'
import { LIBRARIES, SESSIONS, libraryPath } from '@/lib/library/library'
import { ON_LIBRARY } from '@/lib/fixed-colours'
import { searchDrills, splitTrainings, trainingMinutes, type Drill } from '@/lib/training/sessions'
import { herePath, planPath, sessionSummary, type PlannerState } from '@/lib/training/plans'
import { registerProblem } from '@/lib/event-register'
import { AGAIN, NOTE_MAX, againLabel, loopSteps, nextTraining, searchPast, trainingBadge, type Again, type Phase } from '@/lib/training/next'
import { gameWhen } from '@/components/coach/games/useGames'
import {
  useDrafts, useDrills, useHere, useNotes, usePastTrainings, usePlannedTrainings, useRegisters, useSaveNotes, useTrainings, type Draft, type Notes, type Training,
} from '@/components/coach/training/useTraining'
import { DrillSheet } from '@/components/coach/training/DrillSheet'
import { startedLocked } from '@/lib/coach-events'
import type { MyDrill } from '@/lib/training/parts'
import { NOTE_STEP } from '@/lib/event-edit'
import { CopyTargetSheet, PastPlanSheet, type PlanToCopy } from '@/components/coach/training/PastPlanSheet'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { PitchViewRoute, PlanEditorRoute, PlanRoute, WhosHereRoute } from './CoachTrainingPlan'
import { CoachMenuButton } from '@/components/coach/CoachFrame'
import { LoadError, WIDE_COLUMN } from '@/components/trak'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Countdown } from '@/components/arc/countdown/countdown'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { ScrollArea } from '@/components/arc/scroll-area/scroll-area'
import { Stepper } from '@/components/arc/stepper/stepper'
import { Textarea } from '@/components/arc/textarea/textarea'
import { SearchField } from '@/components/arc/search-field/search-field'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* TRAK-294 (Training 1/5, spec TRAK-293): Training home, behind the academy's training switch. Sessions lists the
   coach's trainings from Schedule (Coming up, then Last week); Drills holds My drills, then the Library's tiles.
   Homework and Value of the month are parked (TRAK-293). TRAK-295 (Training 2/5): a training coming up says whether
   it's planned; Plan this session and New session asked how (TRAK-339: no more), and a plan has its own pages. TRAK-296: a
   drill can be added to the next training not planned yet. TRAK-298: Last week says which trainings are closed (ended
   with their register taken) and opens each one's page. TRAK-310 (Kostas, 29 Oct): a training coming up has View plan
   and Edit plan, or Create plan, and New session is gone, since every training coming up has its own Create plan.
   TRAK-311 (Kostas, 29 Oct): View plan opens View, and a training last week has the same buttons. TRAK-339 (Training
   redo 1/5, spec TRAK-338): Sessions is laid out like Matches, from the 2 Nov prototype; see below. */

export const TRAINING_PATH = '/coach/training'
const PAST_PATH = `${TRAINING_PATH}/past`
/** Kostas, 3 Nov: the mockup's row of four; the rest one tap away. */
const UPCOMING_SHOWN = 4
/** Schedule's quick hand-over (TRAK-182 part 8): New event, on its first step, with Training picked. */
const ADD_TRAINING = { quickEvent: { kind: 'training' } }
const linkClass = 'rounded text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

export default function CoachTraining() {
  const { pathname } = useLocation()
  const navigation = useNavigationType()
  // As the Library's pages do: a page the coach opens (a plan once saved, too) starts at its top; Back (POP) is left to
  // the browser, which returns them to their place.
  useLayoutEffect(() => {
    if (navigation !== 'POP') (document.scrollingElement ?? document.documentElement).scrollTo(0, 0)
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps -- only a new page moves to the top

  return (
    <Routes>
      <Route index element={<SessionsView />} />
      <Route path="past" element={<PastTrainings />} />
      <Route path="drills" element={<DrillsView />} />
      <Route path=":eventId" element={<PlanRoute />} />
      <Route path=":eventId/plan" element={<PlanEditorRoute />} />
      <Route path=":eventId/view" element={<PitchViewRoute />} />
      <Route path=":eventId/here" element={<WhosHereRoute />} />
      {/* TRAK-309: View was Run it, at /run. An open tab or an older link (Home's Today card) still lands on it. */}
      <Route path=":eventId/run" element={<Navigate to="../view" relative="path" replace />} />
      <Route path="*" element={<Navigate to={TRAINING_PATH} replace />} />
    </Routes>
  )
}

function Page({ view, action, children }: { view: 'sessions' | 'drills'; action?: ReactNode; children: ReactNode }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-ground pb-28">
      <div className={WIDE_COLUMN}>
        <header className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-6 pb-4">
          <CoachMenuButton name={profile?.full_name || 'Coach'} />
          {/* Kostas, 30 Oct: "training" is too repetitive, so the page has no visible title. */}
          <h1 className="sr-only">Training</h1>
          <div className="arc">
            <SegmentedControl label="Training view" value={view}
              options={[{ value: 'sessions', label: 'Sessions' }, { value: 'drills', label: 'Drills' }]}
              onValueChange={next => navigate(next === 'drills' ? `${TRAINING_PATH}/drills` : TRAINING_PATH)} />
          </div>
          {action && <div className="arc ml-auto">{action}</div>}
        </header>
        {children}
      </div>
    </div>
  )
}

/* ── Sessions ───────────────────────────────────────────────────────────── */

/* TRAK-339 (Training redo 1/5, spec TRAK-338, 2 Nov prototype): laid out like Matches. The Next training card (where it
   is in its loop and its one next action), Upcoming trainings in a row, and Past trainings at the very bottom (Kostas,
   2 Nov). After a training, its Notes are asked on the card. */


function SessionsView() {
  const { user } = useAuth()
  const coachSquad = useCoachSquad(user?.id)
  const navigate = useNavigate()
  const trainings = useTrainings()
  const planned = usePlannedTrainings()
  const registers = useRegisters()
  const notes = useNotes()
  const drafts = useDrafts()
  const past = usePastTrainings()
  const location = useLocation()
  // TRAK-340: back from saving a plan, say so and offer the next one not planned yet.
  const [savedPlan, setSavedPlan] = useState<string | null>(() => (location.state as { savedPlan?: string } | null)?.savedPlan ?? null)
  // The countdown's end moves the card on, so the clock is read again then.
  const [now, setNow] = useState(() => Date.now())
  const [closed, setClosed] = useState<string | null>(null)
  const [allUpcoming, setAllUpcoming] = useState(false)
  // TRAK-305: All or one squad, as picked at the top of the frame.
  const { everySquad } = coachSquad
  const inView = (trainings.data ?? []).filter(t => everySquad || coachSquad.eventInSquad(t.squad))
  const isToday = (training: Training) => phoneEventTime(training).date === localTodayISO()
  const next = nextTraining(inView, now, id => !!notes.data?.has(id), isToday)
  const upcoming = splitTrainings(inView, now).comingUp
  const pastInView = (past.data ?? []).filter(t => everySquad || coachSquad.eventInSquad(t.squad))
  const reads = [trainings, planned, registers, notes, drafts]
  const justSaved = savedPlan ? inView.find(t => t.id === savedPlan) : undefined
  const nextToPlan = justSaved ? upcoming.find(t => t.id !== justSaved.id && !planned.data?.has(t.id)) : undefined

  return (
    <Page view="sessions">
      {reads.some(r => r.error) ? <LoadError what="your trainings" onRetry={() => reads.forEach(r => void r.refetch())} retrying={reads.some(r => r.isFetching)} />
        : reads.some(r => r.isPending) ? <LoadingSkeleton label="Loading your trainings…" rows={3} className="pt-6" />
        : <div className="grid gap-6">
          {closed && <div role="status" className="arc flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-3.5">
            <Check aria-hidden size={18} className="text-brand" />
            <p className="min-w-0 flex-1 text-[15px] text-ink"><span className="font-medium">{closed} is closed.</span>
              <span className="text-ink-2"> It’s now in Past trainings.</span></p>
            <Button size="sm" variant="secondary" onClick={() => navigate(PAST_PATH)}>Past trainings</Button>
            <button type="button" aria-label="Close message" onClick={() => setClosed(null)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X aria-hidden size={16} /></button>
          </div>}

          {justSaved && <div role="status" className="arc flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-3.5">
            <Check aria-hidden size={18} className="text-brand" />
            <p className="min-w-0 flex-1 text-[15px] text-ink"><span className="font-medium">Plan saved for {justSaved.title}, {gameWhen(justSaved).day}.</span>
              {nextToPlan && <span className="text-ink-2"> Next to plan: {nextToPlan.title}, {gameWhen(nextToPlan).day}.</span>}</p>
            {nextToPlan && <Button size="sm" onClick={() => navigate(planPath(nextToPlan.id))}>
              {drafts.data?.has(nextToPlan.id) ? 'Continue' : 'Plan'} {nextToPlan.title}</Button>}
            <button type="button" aria-label="Close message" onClick={() => setSavedPlan(null)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X aria-hidden size={16} /></button>
          </div>}

          {/* Kostas, 3 Nov: as the mockup, the Next training card and Open drafts side by side on a laptop. */}
          <div className="grid gap-4 laptop:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] laptop:items-start">
          {next ? <NextTraining key={next.training.id} draft={drafts.data?.get(next.training.id)} training={next.training} phase={next.phase} planned={!!planned.data?.has(next.training.id)}
            sessionId={registers.data?.get(next.training.id) ?? null} onStart={() => setNow(Date.now())}
            onClosed={() => setClosed(next.training.title)} />
            : <div className="arc">
              <EmptyState icon={<TrafficCone size={24} strokeWidth={1.5} />} title="No training coming up"
                description="Add a training in Schedule. You’ll plan it here."
                action={<Button onClick={() => navigate('/coach/schedule', { state: ADD_TRAINING })}>Add a training</Button>} />
            </div>}
          <OpenDrafts drafts={upcoming.filter(t => drafts.data?.has(t.id) && !planned.data?.has(t.id)).map(t => ({ training: t, draft: drafts.data!.get(t.id)! }))} />
          </div>

          {upcoming.length > 0 && <section aria-labelledby="upcoming" className="min-w-0">
            <h2 id="upcoming" className="mb-2 text-lg font-medium text-ink">Upcoming trainings</h2>
            <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
              {(allUpcoming ? upcoming : upcoming.slice(0, UPCOMING_SHOWN)).map(training => {
                const { day, time } = gameWhen(training)
                const badge = trainingBadge({ phase: isToday(training) ? 'day' : 'before', planned: !!planned.data?.has(training.id),
                  draft: drafts.data?.has(training.id) })
                return <li key={training.id}>
                  <Link to={`${TRAINING_PATH}/${training.id}`}
                    className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-transform active:scale-[.98] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <span className="grid min-w-0">
                      <span className="truncate text-base font-medium text-ink">{training.title}</span>
                      <span className="truncate text-sm text-ink-3">{[isToday(training) ? 'Today' : day, time, everySquad ? training.squad : null].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="mt-auto"><Badge tone={badge.tone} size="sm">{badge.label}</Badge></span>
                  </Link>
                </li>
              })}
            </ul>
            {upcoming.length > UPCOMING_SHOWN && <div className="arc mt-2"><Button variant="ghost" size="sm" onClick={() => setAllUpcoming(!allUpcoming)}>
              {allUpcoming ? 'Show fewer' : `Show all ${upcoming.length}`}</Button></div>}
          </section>}

          <div className="arc flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <Button variant="secondary" onClick={() => navigate(PAST_PATH)}><History aria-hidden size={16} />Past trainings
              {past.data && <Badge size="sm">{pastInView.length}</Badge>}</Button>
            <span className="text-sm text-ink-3">Look back at a session, or copy its plan.</span>
          </div>
        </div>}
    </Page>
  )
}

/** The training the card shows: its name and badge, when and where, the loop, the message to families, and the one next
 *  action. After the training, its Notes. */
function NextTraining({ training, phase, planned, draft, sessionId, onStart, onClosed }: {
  training: Training; phase: Phase; planned: boolean; draft: Draft | undefined; sessionId: string | null; onStart: () => void; onClosed: () => void
}) {
  const navigate = useNavigate()
  const here = useHere(sessionId ? [sessionId] : [])
  const [copying, setCopying] = useState(false)
  const { day, time, academy } = gameWhen(training)
  const minutes = trainingMinutes(training)
  const count = sessionId ? here.data?.get(sessionId) ?? null : null
  const badge = trainingBadge({ phase, planned, here: count, draft: !!draft })
  const stoppedAt = draft ? draft.parts[draft.step]?.name ?? 'Review' : null
  const current = phase === 'after' ? 3 : planned || phase === 'day' ? 2 : 1
  // A step the card has moved past is ticked only if it really happened; otherwise it says what's missing (live check,
  // 3 Nov: a training ended with no register showed Who's here ticked).
  const steps = loopSteps({ current, planned, registered: !!sessionId })
  const message = training.family_note?.trim()
  const locked = startedLocked(training)
  // Who's here opens as the register does everywhere else: published, not cancelled, started.
  const registerWhy = registerProblem({ ...training, event_type: 'training' }, new Date())
  const review = () => navigate(`${TRAINING_PATH}/${training.id}`)
  const plan = () => navigate(planPath(training.id))

  return (
    <section aria-labelledby="next-training" className="arc flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          {/* Kostas, 30 Oct: no "Next training" heading; the name and badge lead the card. */}
          <h2 id="next-training" className="text-[22px] font-medium tracking-[-0.01em] text-ink break-words">{training.title}</h2>
          <p className="text-sm text-ink-2">{[phase !== 'before' && phoneEventTime(training).date === localTodayISO() ? 'Today' : day, time,
            training.venue, minutes ? `${minutes} min` : null].filter(Boolean).join(' · ')}</p>
          {academy && <p className="text-sm text-ink-3">{academy}</p>}
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      <Stepper label="Where this training is" steps={steps} current={current} />

      {phase === 'after' ? <NotesForm training={training} planned={planned} onReview={review} onClosed={onClosed} />
        : <>
          {/* TRAK-367: always there to add one, until the training starts and its details are fixed. Edit opens the form at
              the note, in Schedule, which alone can save it to this training and the ones after. */}
          {(message || !locked) && <p className="flex items-start gap-2 rounded-xl bg-raised px-4 py-3 text-sm text-ink-2">
            <Info aria-hidden size={16} className="mt-0.5 flex-none text-ink-3" />
            <span className="min-w-0 flex-1 break-words"><span className="font-medium text-ink">Message to players{message && ':'}</span> {message}</span>
            {!locked && <Link to={`/coach/schedule?edit=${training.id}&step=${NOTE_STEP}`} className={linkClass}>{message ? 'Edit' : 'Add a message'}</Link>}
          </p>}
          <div className="flex flex-wrap items-center gap-3">
            {phase === 'day' ? <>
              <Button size="lg" disabled={!!registerWhy && !sessionId} onClick={() => navigate(herePath(training.id))}>Who’s here</Button>
              {planned ? <Button size="lg" variant="secondary" onClick={review}>Review plan</Button>
                : <Button size="lg" variant="secondary" onClick={plan}>Plan session</Button>}
            </> : planned ? <>
              <Button size="lg" onClick={review}>Review plan</Button>
              <Button variant="ghost" onClick={plan}>Edit plan</Button>
            </> : draft ? <>
              <Button size="lg" onClick={plan}>Continue plan</Button>
            </> : <>
              <Button size="lg" onClick={plan}>Plan session</Button>
              <Button size="lg" variant="secondary" onClick={() => setCopying(true)}><Copy aria-hidden size={16} />Use a past plan</Button>
            </>}
            <Countdown variant="compact" units={['days', 'hours', 'minutes']} target={training.starts_at}
              label="Starts in" completeLabel="Started" onComplete={onStart} className="ml-auto" />
          </div>
          {/* Kostas, 3 Nov: the mockup is clean; a line only when a button is waiting for the training to start. */}
          {phase === 'day' && registerWhy && !sessionId && <p className="text-sm text-ink-3">Who’s here opens when the training starts.</p>}
          {stoppedAt && phase === 'before' && !planned && <p className="text-sm text-ink-3">You stopped at {stoppedAt}.</p>}
        </>}

      <PastPlanSheet open={copying} onOpenChange={setCopying} training={training} />
    </section>
  )
}

/** Open drafts (the mockup's card beside the Next training): plans the coach kept for later, with where they stopped.
 *  Only the coach sees a draft. */
function OpenDrafts({ drafts }: { drafts: { training: Training; draft: Draft }[] }) {
  const navigate = useNavigate()
  return <section aria-labelledby="open-drafts" className="arc grid gap-2 rounded-2xl border border-line bg-surface p-5">
    <h2 id="open-drafts" className="text-lg font-medium text-ink">Open drafts</h2>
    <p className="text-sm text-ink-3">Only you see a draft.</p>
    {drafts.length === 0 ? <p className="pt-1 text-sm text-ink-2">No drafts. Stop a plan half-way with Save as draft and it waits here.</p>
      : <ul className="mt-1 divide-y divide-line border-t border-line">
        {drafts.map(({ training, draft }) => <li key={training.id} className="flex items-center justify-between gap-3 py-3">
          <span className="grid min-w-0">
            <span className="truncate text-[15px] font-medium text-ink">{training.title}</span>
            <span className="truncate text-sm text-ink-3">{gameWhen(training).day} · stopped at {draft.parts[draft.step]?.name ?? 'Review'}</span>
          </span>
          <Button size="sm" variant="secondary" aria-label={`Continue ${training.title}`} onClick={() => navigate(planPath(training.id))}>Continue</Button>
        </li>)}
      </ul>}
  </section>
}

/** Notes, after the training (Kostas, 2 Nov): one question for the whole session and a note for next time. Optional:
 *  Skip and close closes it all the same. */
function NotesForm({ training, planned, onReview, onClosed }: { training: Training; planned: boolean; onReview: () => void; onClosed: () => void }) {
  const save = useSaveNotes()
  const [again, setAgain] = useState<Again | null>(null)
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const close = (notes: Notes) => {
    setProblem(null)
    save.mutate({ eventId: training.id, ...notes }, {
      onSuccess: onClosed,
      onError: () => setProblem('Couldn’t save. Check your connection and try again. Nothing you typed is lost.'),
    })
  }
  return <div className="grid gap-4">
    {/* As the mockup: the question and the note in one soft panel. */}
    <div className="grid gap-3 rounded-2xl bg-ground p-4">
    <div className="grid justify-items-start gap-2">
      {/* The loop above already says Notes are optional. */}
      <p aria-hidden="true" className="text-[15px] font-medium text-ink">Would you run this session again?</p>
      <SegmentedControl label="Would you run this session again?" value={again ?? ''}
        options={AGAIN.map(a => ({ value: a.value, label: a.label }))} onValueChange={value => setAgain(value as Again)} />
    </div>
    <Textarea label="A note for next time" rows={2} maxLength={NOTE_MAX} value={note} onChange={e => setNote(e.target.value)}
      placeholder="For example: the rondo grids were too small for this group" />
    </div>
    {problem && <p role="alert" className="text-[15px] text-danger">{problem}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <Button size="lg" loading={save.isPending} onClick={() => close({ again, note })}>Save and close</Button>
      {planned && <Button size="lg" variant="secondary" onClick={onReview}>Review today’s plan</Button>}
      <Button variant="ghost" disabled={save.isPending} onClick={() => close({ again: null, note: '' })}>Skip and close</Button>
    </div>
  </div>
}

/* ── Past trainings ─────────────────────────────────────────────────────── */

/** Every training that's over, newest first: what was planned, who came, and the Notes. View opens its page; Use this
 *  plan asks which training to copy it into (Kostas, 30 Oct: Past trainings is a list of its own, not a row on the
 *  front page). */
function PastTrainings() {
  const { user } = useAuth()
  const coachSquad = useCoachSquad(user?.id)
  const navigate = useNavigate()
  const past = usePastTrainings()
  const trainings = useTrainings()
  const registers = useRegisters()
  const [query, setQuery] = useState('')
  const [copying, setCopying] = useState<PlanToCopy | null>(null)
  const { everySquad } = coachSquad
  const inView = (past.data ?? []).filter(t => everySquad || coachSquad.eventInSquad(t.squad))
  const shown = searchPast(inView.map(t => ({ ...t, note: t.notes?.note ?? '' })), query)
  const here = useHere(inView.flatMap(t => registers.data?.get(t.id) ?? []))
  const coming = splitTrainings((trainings.data ?? []).filter(t => everySquad || coachSquad.eventInSquad(t.squad)), Date.now()).comingUp

  return (
    <div className="min-h-screen bg-ground pb-28">
      <div className={WIDE_COLUMN}>
        <header className="arc grid gap-3 pt-5 pb-4">
          <CoachTrail current="Past trainings" />
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">Past trainings</h1>
          <p className="text-sm text-ink-3">Look back at a session, or copy its plan into one coming up.</p>
        </header>
        {past.error ? <LoadError what="your past trainings" onRetry={() => void past.refetch()} retrying={past.isFetching} />
          : past.isPending ? <LoadingSkeleton label="Loading your past trainings…" lines={2} rows={4} className="pt-6" />
          : inView.length === 0 ? <div className="arc"><EmptyState icon={<History size={24} strokeWidth={1.5} />} title="No past trainings yet"
              description="Once a training is over, it’s kept here with its plan and your notes." /></div>
          : <div className="grid gap-4">
            <div className="arc max-w-[560px]">
              <SearchField label="Search past trainings" placeholder="Search by name, drill or note" value={query} onValueChange={setQuery} />
            </div>
            {shown.length === 0 ? <p className="text-[15px] text-ink-2">No past training matches “{query.trim()}”.</p>
              : <ul aria-label="Past trainings" className="grid gap-3">
                {shown.map(training => {
                  const { day } = gameWhen(training)
                  const sessionId = registers.data?.get(training.id)
                  const count = sessionId ? here.data?.get(sessionId) : undefined
                  const again = againLabel(training.notes?.again)
                  return <li key={training.id} className="arc flex flex-wrap items-start gap-x-6 gap-y-3 rounded-2xl border border-line bg-surface p-5">
                    <div className="grid min-w-0 flex-[1_1_16rem] gap-1.5">
                      <p className="text-sm text-ink-3">{[day, everySquad ? training.squad : null, count != null ? `${count} here` : null].filter(Boolean).join(' · ')}</p>
                      <p className="text-lg font-medium text-ink break-words">{training.title}</p>
                      <p className="text-sm text-ink-2 break-words">{training.planned ? sessionSummary(training.practices) : 'No plan written'}</p>
                      {(again || training.notes?.note) && <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                        {again && <Badge size="sm" tone={training.notes?.again === 'no' ? 'warning' : 'success'}>Run it again: {again}</Badge>}
                        {training.notes?.note && <span className="break-words">“{training.notes.note}”</span>}
                      </p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => navigate(`${TRAINING_PATH}/${training.id}`)}
                        aria-label={`View ${training.title}, ${day}`}>View</Button>
                      {training.planned && training.practices.length > 0 && <Button size="sm" aria-label={`Use this plan: ${training.title}, ${day}`}
                        onClick={() => setCopying({ title: training.title, day, practices: training.practices })}><Copy aria-hidden size={16} />Use this plan</Button>}
                    </div>
                  </li>
                })}
              </ul>}
          </div>}
      </div>
      <CopyTargetSheet plan={copying} trainings={coming} onClose={() => setCopying(null)} />
    </div>
  )
}

/* ── Drills ─────────────────────────────────────────────────────────────── */

function DrillsView() {
  const drills = useDrills()
  const navigate = useNavigate()
  const trainings = useTrainings()
  const planned = usePlannedTrainings()
  // The next training not planned yet, of any squad; none while either read is pending or failed.
  const next = trainings.data && planned.data
    ? splitTrainings(trainings.data, Date.now()).comingUp.find(training => !planned.data.has(training.id)) : undefined
  const nextDay = next ? gameWhen(next).day : null
  const [query, setQuery] = useState('')
  // The sheet: closed, a new drill, or one of the coach's drills to change.
  const [sheet, setSheet] = useState<{ drill: (Drill & MyDrill) | null } | null>(null)
  const shown = searchDrills(drills.data ?? [], query)

  return (
    <Page view="drills" action={<Button onClick={() => setSheet({ drill: null })}><Plus aria-hidden size={18} />New drill</Button>}>
      <div className="arc max-w-[560px]">
        <SearchField label="Search my drills" placeholder="Search my drills" value={query} onValueChange={setQuery} />
      </div>

      <section aria-labelledby="my-drills" className="mt-7">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="my-drills" className="text-lg font-medium text-ink">My drills</h2>
          <p className="text-sm text-ink-3">Only you see these.</p>
        </div>
        {drills.error ? <div className="mt-3"><LoadError what="your drills" onRetry={() => void drills.refetch()} retrying={drills.isFetching} /></div>
          : drills.isPending ? <LoadingSkeleton label="Loading your drills…" lines={2} rows={3} className="mt-3" />
          : (drills.data ?? []).length === 0 ? <p className="mt-3 text-[15px] text-ink-2">No drills yet. Add one with New drill, and use it in any session.</p>
          : shown.length === 0 ? <p className="mt-3 text-[15px] text-ink-2">No drill matches “{query.trim()}”.</p>
          : <ul className="mt-3 grid gap-3 tablet:grid-cols-2 laptop:grid-cols-3">
            {shown.map(drill => <li key={drill.id} className="flex h-full flex-col rounded-2xl border border-line bg-surface">
              <button type="button" onClick={() => setSheet({ drill })} aria-label={`${drill.name}, ${drill.minutes} min. Edit`}
                className="flex w-full flex-1 flex-col gap-1 rounded-2xl p-4 text-left transition-transform active:scale-[.98] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="flex w-full items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words text-[15px] font-medium text-ink">{drill.name}</span>
                  <span className="flex-none text-sm text-ink-3">{drill.minutes} min</span>
                </span>
                {drill.how && <span className="line-clamp-2 text-sm text-ink-2">{drill.how}</span>}
              </button>
              {next && <button type="button" aria-label={`Add ${drill.name} to ${nextDay}`}
                onClick={() => navigate(planPath(next.id), { state: { addDrill: drill } satisfies PlannerState })}
                className={`mx-4 mb-3 inline-flex min-h-11 items-center gap-1.5 self-start ${linkClass}`}>
                <Plus aria-hidden size={16} />Add to {nextDay}</button>}
            </li>)}
          </ul>}
      </section>

      <section aria-labelledby="from-library" className="mt-9">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="from-library" className="text-lg font-medium text-ink">From the Library</h2>
          <p className="text-sm text-ink-3">When you want ideas</p>
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-2.5 tablet:grid-cols-4">
          {LIBRARIES.map(library => <li key={library.key}>
            <Link to={libraryPath(library.key)}
              className="flex h-20 flex-col justify-end rounded-[10px] p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              style={{ background: library.colour, color: ON_LIBRARY }}>
              <span className="text-[15px] font-medium leading-tight">{library.label}</span>
              <span className="text-[12px]">{SESSIONS.filter(s => s.library === library.name).length} sessions</span>
            </Link>
          </li>)}
        </ul>
      </section>

      <DrillSheet open={!!sheet} drill={sheet?.drill ?? null} onOpenChange={open => { if (!open) setSheet(null) }} />
    </Page>
  )
}
