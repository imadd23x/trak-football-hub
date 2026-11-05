import { useEffect, useRef, useState } from 'react'
import { useLocation, useMatch, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { useCoachSquad } from '@/lib/coach-squad'
import {
  MAX_SEASON_OBJECTIVES, OBJECTIVE_LINE_MAX, OBJECTIVE_TITLE_MAX, SEASON_OBJECTIVE_PRESETS, loadSeasonObjectives, loadSeasonPlan,
  planSquad, seasonObjectivesKey, seasonPlanKey, useSeasonPlan, type SeasonObjective, type SeasonPlan,
} from '@/lib/season-plan'
import { NavBar, WIDE_COLUMN } from '@/components/trak'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { CoachMenuButton } from '@/components/coach/CoachFrame'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { DatePicker } from '@/components/arc/date-picker/date-picker'
import { Input } from '@/components/arc/input/input'
import { Stepper } from '@/components/arc/stepper/stepper'
import { Textarea } from '@/components/arc/textarea/textarea'
import { PositionsStep } from '@/components/coach/season-plan/PositionsStep'

/* TRAK-350 (Season plan 2/18, spec TRAK-348): the season plan's set-up, step 1. The season's dates and up to three
   season objectives (the mockup's six, or the coach's own), each editable and deletable. It saves as a draft only the
   coach sees, with or without objectives; a failed save keeps everything typed and says so, as Game plan's does. No
   Focus and no Fill in for me (Tarek, 3 Nov). The stepper shows only steps that exist: TRAK-352 adds Positions;
   Player objectives and Share arrive with TRAK-354 and TRAK-356. Step 1 stays mounted while another step shows, so
   moving between steps never loses what was typed. */

const STEPS = [{ id: 'season', label: 'Season and objectives' }, { id: 'positions', label: 'Positions' }]
const STEP_PATHS = ['/coach/season-plan', '/coach/season-plan/positions']
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
const isoToDate = (iso: string) => (iso ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) : undefined)
const dateToIso = (date: Date | undefined) => (date
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '')

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
  const step = useMatch('/coach/season-plan/positions') ? 1 : 0
  const goTo = (index: number) => navigate(STEP_PATHS[index])

  return (
    <div className="min-h-screen bg-ground pb-24">
      <div className={WIDE_COLUMN}>
        <CoachTrail className="mt-5" current="Season plan" />
        <header className="pt-4 pb-4">
          <div className="flex items-center gap-2">
            {/* TRAK-378: on a phone the avatar opens the side menu, where the squad picker is (TRAK-376). */}
            <CoachMenuButton name={profile?.full_name || 'Coach'} />
            <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">Season plan</h1>
          </div>
          {squad && !season.isPending && <p className="mt-1 text-sm text-ink-3">{squad} · {season.plan ? 'Draft, only you see it' : 'Not started'}</p>}
        </header>
        {!squad ? <p className="text-sm text-ink-2">Pick one squad in the menu to plan its season.</p>
          : season.error || objectives.error ? (
            <div className="arc grid justify-items-start gap-3">
              <p className="text-sm text-ink-2">Couldn't load your season plan.</p>
              <Button variant="secondary" onClick={() => { season.retry(); void objectives.refetch() }}>Try again</Button>
            </div>)
          : !loaded ? <LoadingSkeleton label="Loading your season plan…" lines={3} className="pt-2" />
          : <div className="arc grid gap-5">
            <Stepper steps={STEPS} current={step} label="Season plan steps" onStepSelect={goTo} jumpAhead />
            {/* Keyed by squad, not plan: the first save creates the plan, and "Saved" must survive it. */}
            <div className={step === 0 ? undefined : 'hidden'}>
              <SetUp key={squad} squad={squad} plan={season.plan} saved={objectives.data ?? []} onNext={() => goTo(1)} />
            </div>
            {step === 1 && user && <PositionsStep coachId={user.id} squad={squad} plan={season.plan} onBack={() => goTo(0)} onDone={() => navigate('/coach/home')} />}
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
  const setObjective = (key: string, patch: Partial<Objective>) =>
    change({ ...form, objectives: form.objectives.map(o => (o.key === key ? { ...o, ...patch } : o)) })
  const add = (title: string, looksLike: string) => {
    const key = `new-${(nextKey.current += 1)}`
    change({ ...form, objectives: [...form.objectives, { key, title, looksLike }] })
    if (!title) setFocusKey(key)
  }
  const full = form.objectives.length >= MAX_SEASON_OBJECTIVES
  const chosen = new Set(form.objectives.map(o => o.title.trim()))
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
      // Deletes first, so their places are free for what's new: three places, one objective each.
      const kept = new Set(sent.form.objectives.flatMap(o => (o.id ? [o.id] : [])))
      const gone = saved.filter(o => !kept.has(o.id)).map(o => o.id)
      if (gone.length) {
        const { error } = await supabase.from('season_objectives').delete().in('id', gone)
        if (error) throw error
      }
      for (const o of sent.form.objectives) {
        const before = saved.find(s => s.id === o.id)
        if (!before || (before.title === o.title.trim() && before.looks_like === o.looksLike.trim())) continue
        const { error } = await supabase.from('season_objectives').update({ title: o.title.trim(), looks_like: o.looksLike.trim() }).eq('id', before.id)
        if (error) throw error
      }
      const taken = new Set(saved.filter(s => kept.has(s.id)).map(s => s.place))
      const free = [1, 2, 3].filter(place => !taken.has(place))
      const fresh = sent.form.objectives.filter(o => !o.id)
        .map((o, i) => ({ plan_id: planId!, place: free[i], title: o.title.trim(), looks_like: o.looksLike.trim() }))
      if (fresh.length) {
        const { error } = await supabase.from('season_objectives').insert(fresh)
        if (error) throw error
      }
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

        <section aria-labelledby="season-objectives" className="grid gap-4 rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="season-objectives" className="text-lg font-medium text-ink">Season objectives</h2>
            <span className="text-sm text-ink-3">{form.objectives.length} of {MAX_SEASON_OBJECTIVES}</span>
          </div>
          {form.objectives.length === 0 && <p className="text-sm text-ink-3">None yet. Pick from the list or write your own.</p>}
          <ol className="grid gap-4">
            {form.objectives.map((o, index) => (
              <li key={o.key} className="grid gap-2 rounded-xl border border-line p-3">
                <Input label={`Objective ${index + 1}`} value={o.title} maxLength={OBJECTIVE_TITLE_MAX} autoFocus={o.key === focusKey}
                  placeholder="For example: Win the second ball" onChange={event => setObjective(o.key, { title: event.target.value })} />
                <Textarea label="What it looks like" value={o.looksLike} maxLength={OBJECTIVE_LINE_MAX} rows={2}
                  onChange={event => setObjective(o.key, { looksLike: event.target.value })} />
                <span className="justify-self-end">
                  <Button variant="ghost" size="sm" aria-label={`Delete ${o.title.trim() || `objective ${index + 1}`}`}
                    onClick={() => change({ ...form, objectives: form.objectives.filter(other => other.key !== o.key) })}>
                    <Trash2 size={16} aria-hidden="true" />Delete
                  </Button>
                </span>
              </li>
            ))}
          </ol>
          <div className="grid gap-2">
            <h3 className="text-sm font-medium text-ink-2">Add one</h3>
            {full && <p className="text-sm text-ink-3">Up to three. Delete one to add another.</p>}
            <div className="flex flex-wrap gap-2">
              {SEASON_OBJECTIVE_PRESETS.filter(preset => !chosen.has(preset.title)).map(preset => (
                <Button key={preset.title} variant="secondary" size="sm" disabled={full} title={preset.looksLike}
                  onClick={() => add(preset.title, preset.looksLike)}>
                  <Plus size={16} aria-hidden="true" />{preset.title}
                </Button>
              ))}
              <Button variant="secondary" size="sm" disabled={full} onClick={() => add('', '')}>
                <Plus size={16} aria-hidden="true" />Write your own
              </Button>
            </div>
          </div>
        </section>
      </div>

      {problem && <Alert tone={problem === SAVE_FAILED ? 'danger' : 'warning'} title={problem} />}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" loading={save.isPending} onClick={() => submit()}>{savedNow ? 'Saved' : 'Save draft'}</Button>
        <Button disabled={save.isPending} onClick={next}>Next: Positions</Button>
      </div>
    </div>
  )
}
