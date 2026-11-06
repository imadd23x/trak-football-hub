import { useRef, useState, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronLeft } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { DatePicker } from '@/components/arc/date-picker/date-picker'
import {
  dateToIso, isoToDate, removedSeasonObjectivesKey, seasonObjectivesKey, seasonPlanKey, writeSeasonObjectives,
  type SeasonObjective, type SeasonPlan,
} from '@/lib/season-plan'
import { DEFAULT_WATCH_RULE, effectiveRule, isWatchRule, rulesFor, type WatchRule } from '@/lib/watch-first'
import { SeasonObjectivesEditor, type EditableObjective } from './SeasonObjectivesEditor'
import { trainsIn, useSetWatchRule, useTrainingSquads } from './useWatching'

/* TRAK-356 (Season plan 8/18, spec TRAK-348): one part of a shared plan, edited on one screen (Tarek, 1 Nov). Cancel
   leaves it as it was; Save keeps the change, which waits under "Not shared yet" until the coach shares the changes.
   Removing a season objective here retires it: it stays in the plan's history, with its dates. The watching reminder
   (TRAK-355) is the coach's alone, so it never waits to be shared. */

const PLAN_PARTS = { dates: 'Season dates', objectives: 'Season objectives', reminder: 'Watching reminder' } as const
type Part = keyof typeof PLAN_PARTS
const isPart = (part: string): part is Part => part in PLAN_PARTS

const PLAN = '/coach/season-plan'
const SAVE_FAILED = "Couldn't save. Check your connection and try again; your changes are still here."
const WAITS = 'Your changes wait under Not shared yet until you share them.'
const SAVED = 'Saved. Share the changes when you’ve told your players.'

export function PlanEdit({ part, coachId, squad, plan, seasonObjectives }: {
  part: string
  coachId: string
  squad: string
  plan: SeasonPlan
  seasonObjectives: SeasonObjective[]
}) {
  if (!isPart(part)) return <Navigate to={PLAN} replace />
  return part === 'dates' ? <DatesEdit coachId={coachId} squad={squad} plan={plan} />
    : part === 'reminder' ? <ReminderEdit coachId={coachId} squad={squad} plan={plan} />
    : <ObjectivesEdit coachId={coachId} squad={squad} plan={plan} saved={seasonObjectives} />
}

function EditScreen({ part, problem, saving, canSave, onSave, children }: {
  part: Part; problem: string | null; saving: boolean; canSave: boolean; onSave: () => void; children: ReactNode
}) {
  const navigate = useNavigate()
  const back = () => navigate(PLAN)
  return (
    <div className="arc grid gap-5">
      <button type="button" onClick={back}
        className="inline-flex min-h-11 items-center gap-1 justify-self-start rounded-md text-[15px] font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <ChevronLeft size={16} aria-hidden="true" />Season plan
      </button>
      <header className="grid gap-1">
        <p className="text-sm text-ink-3">Edit</p>
        <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">{PLAN_PARTS[part]}</h1>
        <p className="text-sm text-ink-3">{part === 'reminder' ? 'Only you see this.' : WAITS}</p>
      </header>
      {children}
      {problem && <Alert tone={problem === SAVE_FAILED ? 'danger' : 'warning'} title={problem} />}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={back}>Cancel</Button>
        <Button loading={saving} disabled={!canSave} onClick={onSave}>Save</Button>
      </div>
    </div>
  )
}

function DatesEdit({ coachId, squad, plan }: { coachId: string; squad: string; plan: SeasonPlan }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [startsOn, setStartsOn] = useState(plan.starts_on ?? '')
  const [endsOn, setEndsOn] = useState(plan.ends_on ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const changed = startsOn !== (plan.starts_on ?? '') || endsOn !== (plan.ends_on ?? '')
  // Share needed both dates, so a shared plan keeps them.
  const bad = !startsOn || !endsOn ? 'A shared plan keeps both its dates.' : endsOn <= startsOn ? 'The season has to end after it starts.' : null
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('season_plans').update({ starts_on: startsOn, ends_on: endsOn }).eq('id', plan.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: seasonPlanKey(coachId, squad) })
      toast.success(SAVED)
      navigate(PLAN)
    },
    onError: () => setProblem(SAVE_FAILED),
  })
  const edit = (set: (iso: string) => void) => (date: Date | undefined) => { set(dateToIso(date)); setProblem(null) }

  return (
    <EditScreen part="dates" problem={problem} saving={save.isPending} canSave={changed && !bad} onSave={() => save.mutate()}>
      <section aria-label="Your season" className="grid gap-4 rounded-2xl border border-line bg-surface p-5">
        <div className="grid gap-4 tablet:grid-cols-2">
          <DatePicker label="Starts" value={isoToDate(startsOn)} onChange={edit(setStartsOn)} />
          <DatePicker label="Ends" value={isoToDate(endsOn)} onChange={edit(setEndsOn)} minDate={isoToDate(startsOn)} />
        </div>
        {changed && bad && <p role="alert" className="text-sm text-danger">{bad}</p>}
      </section>
    </EditScreen>
  )
}

function ObjectivesEdit({ coachId, squad, plan, saved }: { coachId: string; squad: string; plan: SeasonPlan; saved: SeasonObjective[] }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [list, setList] = useState<EditableObjective[]>(() => saved.map(o => ({ key: o.id, id: o.id, title: o.title, looksLike: o.looks_like })))
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const nextKey = useRef(0)
  const changed = JSON.stringify(list.map(o => [o.id, o.title.trim(), o.looksLike.trim()])) !== JSON.stringify(saved.map(o => [o.id, o.title, o.looks_like]))
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: seasonObjectivesKey(coachId, plan.id) }),
    client.invalidateQueries({ queryKey: removedSeasonObjectivesKey(coachId, plan.id) }),
    client.invalidateQueries({ queryKey: seasonPlanKey(coachId, squad) }),
  ])
  const save = useMutation({
    mutationFn: () => writeSeasonObjectives(plan.id, saved, list, true),
    onSuccess: async () => {
      await refresh()
      toast.success(SAVED)
      navigate(PLAN)
    },
    // Part of it may have gone through: what's saved is read again, and what's typed stays.
    onError: () => { setProblem(SAVE_FAILED); void refresh() },
  })
  const change = (next: EditableObjective[]) => { setList(next); setProblem(null) }
  const add = (title: string, looksLike: string) => {
    const key = `new-${(nextKey.current += 1)}`
    change([...list, { key, title, looksLike }])
    if (!title) setFocusKey(key)
  }
  const submit = () => (list.some(o => !o.title.trim()) ? setProblem('Give each objective a title, or remove it.') : save.mutate())

  return (
    <EditScreen part="objectives" problem={problem} saving={save.isPending} canSave={changed} onSave={submit}>
      <SeasonObjectivesEditor objectives={list} focusKey={focusKey} removeWord="Remove" onChange={change} onAdd={add} />
      <p className="text-sm text-ink-3">A removed objective stays in the plan’s history, with its dates.</p>
    </EditScreen>
  )
}

const chip = (on: boolean) =>
  `min-h-10 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink'}`

function ReminderEdit({ coachId, squad, plan }: { coachId: string; squad: string; plan: SeasonPlan }) {
  const navigate = useNavigate()
  const training = useTrainingSquads(coachId)
  const set = useSetWatchRule(coachId, squad)
  const hasTrainings = trainsIn(training.data, squad)
  // What the squad follows now: a trainings rule counts as weeks where the squad has no trainings (TRAK-355).
  const saved = effectiveRule(isWatchRule(plan.watch_rule) ? plan.watch_rule : DEFAULT_WATCH_RULE, hasTrainings)
  const [rule, setRule] = useState<WatchRule | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const current = rule ?? saved
  const save = () => set.mutate({ planId: plan.id, rule: current }, {
    onSuccess: () => { toast.success('Saved.'); navigate(PLAN) },
    onError: () => setProblem(SAVE_FAILED),
  })

  return (
    <EditScreen part="reminder" problem={problem} saving={set.isPending} canSave={!training.isPending && current !== saved} onSave={save}>
      <section aria-label="Watching reminder" className="grid gap-3 rounded-2xl border border-line bg-surface p-5">
        <div role="group" aria-labelledby="reminder-edit" className="grid gap-2">
          <span id="reminder-edit" className="text-sm font-medium text-ink">Remind me about players I’m watching after</span>
          <div className="flex flex-wrap gap-2">
            {rulesFor(hasTrainings).map(option => <button key={option.value} type="button" aria-pressed={current === option.value} className={chip(current === option.value)}
              onClick={() => { setRule(option.value); setProblem(null) }}>{option.label}</button>)}
          </div>
        </div>
        <p className="text-sm text-ink-3">{hasTrainings ? 'Trainings count each player’s own, from your register. ' : ''}4 weeks at the latest.</p>
      </section>
    </EditScreen>
  )
}
