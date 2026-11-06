import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { useCoachSquad } from '@/lib/coach-squad'
import {
  dateToIso, isoToDate, lastShared, loadSeasonObjectives, loadSeasonPlan, planSquad, seasonObjectivesKey, seasonPlanKey, shortDate,
  useSeasonPlan, writeSeasonObjectives, type SeasonObjective, type SeasonPlan,
} from '@/lib/season-plan'
import { NavBar, WIDE_COLUMN } from '@/components/trak'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { CoachMenuButton } from '@/components/coach/CoachFrame'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { DatePicker } from '@/components/arc/date-picker/date-picker'
import { Stepper } from '@/components/arc/stepper/stepper'
import { PositionsStep } from '@/components/coach/season-plan/PositionsStep'
import { ObjectivesStep } from '@/components/coach/season-plan/ObjectivesStep'
import { ShareStep } from '@/components/coach/season-plan/ShareStep'
import { PlanView } from '@/components/coach/season-plan/PlanView'
import { PlanEdit } from '@/components/coach/season-plan/PlanEdit'
import { SeasonObjectivesEditor } from '@/components/coach/season-plan/SeasonObjectivesEditor'

/* TRAK-350 (Season plan 2/18, spec TRAK-348): the season plan's set-up, step 1. The season's dates and up to three
   season objectives (the mockup's six, or the coach's own), each editable and deletable. It saves as a draft only the
   coach sees, with or without objectives; a failed save keeps everything typed and says so, as Game plan's does. No
   Focus and no Fill in for me (Tarek, 3 Nov). The stepper shows only steps that exist: TRAK-352 adds Positions,
   TRAK-354 Player objectives, TRAK-356 Share. Step 1 stays mounted while another step shows, so moving between steps
   never loses what was typed. TRAK-356: once the plan is shared, the set-up never comes back. The page is View plan,
   each part with its Edit on one screen; a set-up step's address shows View plan instead. */

const STEPS = [
  { id: 'season', label: 'Season and objectives' }, { id: 'positions', label: 'Positions' },
  { id: 'objectives', label: 'Player objectives' }, { id: 'share', label: 'Share' },
]
const STEP_PATHS = ['/coach/season-plan', '/coach/season-plan/positions', '/coach/season-plan/objectives', '/coach/season-plan/share']
const SAVE_FAILED = "Couldn't save the plan. Check your connection and try again; everything you typed is still here."
const NO_TITLE = 'Give each objective a title, or delete it.'
const END_BEFORE_START = 'The season has to end after it starts.'

type Objective = { key: string; id?: string; title: string; looksLike: string }
type Form = { startsOn: string; endsOn: string; objectives: Objective[] }

const toForm = (plan: SeasonPlan | null, saved: SeasonObjective[]): Form => ({
  startsOn: plan?.starts_on ?? '',
  endsOn: plan?.ends_on ?? '',
  objectives: saved.map(o => ({ key: o.id, id: o.id, title: o.title, looksLike: o.looks_like })),
})
/** What a form built from the saved plan shows, to tell when the saved plan has moved on. */
const savedKey = (plan: SeasonPlan | null, saved: SeasonObjective[]) =>
  JSON.stringify([plan?.id, plan?.starts_on, plan?.ends_on, saved.map(o => [o.id, o.title, o.looks_like])])

export default function CoachSeasonPlan() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile } = useAuth()
  const squad = planSquad(useCoachSquad(user?.id))
  const season = useSeasonPlan(user?.id, squad)
  const objectives = useQuery({
    queryKey: seasonObjectivesKey(user?.id, season.plan?.id),
    queryFn: () => loadSeasonObjectives(season.plan!.id),
    enabled: !!season.plan,
  })
  const loaded = !!squad && !season.isPending && !season.error && (!season.plan || objectives.isSuccess)
  const onPositions = !!useMatch('/coach/season-plan/positions'), onObjectives = !!useMatch('/coach/season-plan/objectives')
  const onShare = !!useMatch('/coach/season-plan/share')
  const editing = useMatch('/coach/season-plan/edit/:part')?.params.part ?? null
  const step = onPositions ? 1 : onObjectives ? 2 : onShare ? 3 : 0
  const goTo = (index: number) => navigate(STEP_PATHS[index])
  const shared = season.plan?.shared_at ? season.plan : null
  const sharedOn = shared ? lastShared(shared) : null

  return (
    <div className="min-h-screen bg-ground pb-24">
      <div className={WIDE_COLUMN}>
        <CoachTrail className="mt-5" current="Season plan" />
        {/* An edit screen has its own heading, and Cancel as its way out. */}
        {!(shared && editing) && <header className="pt-4 pb-4">
          <div className="flex items-center gap-2">
            {/* TRAK-378: on a phone the avatar opens the side menu, where the squad picker is (TRAK-376). */}
            <CoachMenuButton name={profile?.full_name || 'Coach'} />
            <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">Season plan</h1>
          </div>
          {squad && !season.isPending && <p className="mt-1 text-sm text-ink-3">{squad} · {sharedOn ? `Shared ${shortDate(sharedOn)}` : season.plan ? 'Draft, only you see it' : 'Not started'}</p>}
        </header>}
        {!squad ? <p className="text-sm text-ink-2">Pick one squad in the menu to plan its season.</p>
          : season.error || objectives.error ? (
            <div className="arc grid justify-items-start gap-3">
              <p className="text-sm text-ink-2">Couldn't load your season plan.</p>
              <Button variant="secondary" onClick={() => { season.retry(); void objectives.refetch() }}>Try again</Button>
            </div>)
          : !loaded ? <LoadingSkeleton label="Loading your season plan…" lines={3} className="pt-2" />
          : shared && user ? (editing
            ? <div className="pt-4"><PlanEdit key={editing} part={editing} coachId={user.id} squad={squad} plan={shared} seasonObjectives={objectives.data ?? []} /></div>
            : step !== 0 ? <Navigate to={{ pathname: '/coach/season-plan', search: location.search }} replace />
            : <PlanView coachId={user.id} squad={squad} plan={shared} seasonObjectives={objectives.data ?? []} />)
          : editing ? <Navigate to="/coach/season-plan" replace />
          : <div className="arc grid gap-5">
            <Stepper steps={STEPS} current={step} label="Season plan steps" onStepSelect={goTo} jumpAhead />
            {/* Keyed by squad, not plan: the first save creates the plan, and "Saved" must survive it. */}
            <div className={step === 0 ? undefined : 'hidden'}>
              <SetUp key={squad} squad={squad} plan={season.plan} saved={objectives.data ?? []} onNext={() => goTo(1)} />
            </div>
            {step === 1 && user && <PositionsStep coachId={user.id} squad={squad} plan={season.plan} onBack={() => goTo(0)} onNext={() => goTo(2)} />}
            {step === 2 && user && <ObjectivesStep coachId={user.id} squad={squad} plan={season.plan} seasonObjectives={objectives.data ?? []}
              onBack={() => goTo(1)} onPositions={() => goTo(1)} onNext={() => goTo(3)} />}
            {step === 3 && user && <ShareStep coachId={user.id} squad={squad} plan={season.plan} seasonObjectives={objectives.data ?? []}
              onBack={() => goTo(2)} onSeason={() => goTo(0)} onShared={() => navigate('/coach/season-plan', { replace: true })} />}
          </div>}
      </div>
      <NavBar role="coach" activeTab={location.pathname} onNavigate={navigate} />
    </div>
  )
}

function SetUp({ squad, plan, saved, onNext }: { squad: string; plan: SeasonPlan | null; saved: SeasonObjective[]; onNext: () => void }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const [form, setForm] = useState<Form>(() => toForm(plan, saved))
  const [savedNow, setSavedNow] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  // Every change counts, so a save that lands after more typing doesn't say "Saved" for what it never sent.
  const version = useRef(0)
  const nextKey = useRef(0)
  // Until the coach types, the form follows what's saved: a plan whose objectives arrive late never shows as empty
  // (CI, 3 Nov). Once the coach has typed, only a save replaces the form.
  const shownFrom = useRef(savedKey(plan, saved))
  useEffect(() => {
    const next = savedKey(plan, saved)
    if (version.current !== 0 || next === shownFrom.current) return
    shownFrom.current = next
    setForm(toForm(plan, saved))
  }, [plan, saved])
  const change = (next: Form) => {
    version.current += 1
    setForm(next)
    setSavedNow(false)
    setProblem(null)
  }
  const add = (title: string, looksLike: string) => {
    const key = `new-${(nextKey.current += 1)}`
    change({ ...form, objectives: [...form.objectives, { key, title, looksLike }] })
    if (!title) setFocusKey(key)
  }
  const datesProblem = form.startsOn && form.endsOn && form.endsOn <= form.startsOn ? END_BEFORE_START : null

  const save = useMutation({
    mutationFn: async (sent: { form: Form; version: number }) => {
      const dates = { starts_on: sent.form.startsOn || null, ends_on: sent.form.endsOn || null }
      let planId = plan?.id
      if (planId) {
        const { error } = await supabase.from('season_plans').update(dates).eq('id', planId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('season_plans').insert({ squad, ...dates }).select('id').single()
        if (error) throw error
        planId = data.id
      }
      await writeSeasonObjectives(planId!, saved, sent.form.objectives, !!plan?.shared_at)
      return { plan: await loadSeasonPlan(user!.id, squad), objectives: await loadSeasonObjectives(planId!) }
    },
    onSuccess: (result, sent) => {
      client.setQueryData(seasonObjectivesKey(user?.id, result.plan?.id), result.objectives)
      client.setQueryData(seasonPlanKey(user?.id, squad), result.plan)
      if (sent.version !== version.current) return
      setForm(toForm(result.plan, result.objectives))
      setSavedNow(true)
    },
    onError: () => setProblem(SAVE_FAILED),
  })
  const submit = (then?: () => void) => {
    if (datesProblem) return setProblem(datesProblem)
    if (form.objectives.some(o => !o.title.trim())) return setProblem(NO_TITLE)
    save.mutate({ form, version: version.current }, { onSuccess: () => then?.() })
  }
  // Next saves first when anything is unsaved, so leaving from a later step never drops this one's typing.
  const next = () => (version.current === 0 || savedNow ? onNext() : submit(onNext))

  return (
    <div className="arc grid gap-5">
      <p className="text-sm text-ink-2">Your dates and up to three season objectives. You can save with none and add them later.</p>
      <div className="grid items-start gap-5 laptop:grid-cols-2">
        <section aria-labelledby="season-dates" className="grid gap-4 rounded-2xl border border-line bg-surface p-5">
          <h2 id="season-dates" className="text-lg font-medium text-ink">Your season</h2>
          <div className="grid gap-4 tablet:grid-cols-2">
            <DatePicker label="Starts" value={isoToDate(form.startsOn)} onChange={date => change({ ...form, startsOn: dateToIso(date) })} />
            <DatePicker label="Ends" value={isoToDate(form.endsOn)} onChange={date => change({ ...form, endsOn: dateToIso(date) })}
              minDate={isoToDate(form.startsOn)} />
          </div>
          {datesProblem && <p role="alert" className="text-sm text-danger">{datesProblem}</p>}
        </section>

        <SeasonObjectivesEditor objectives={form.objectives} focusKey={focusKey} removeWord="Delete"
          onChange={objectives => change({ ...form, objectives })} onAdd={add} />
      </div>

      {problem && <Alert tone={problem === SAVE_FAILED ? 'danger' : 'warning'} title={problem} />}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" loading={save.isPending} onClick={() => submit()}>{savedNow ? 'Saved' : 'Save draft'}</Button>
        <Button disabled={save.isPending} onClick={next}>Next: Positions</Button>
      </div>
    </div>
  )
}
