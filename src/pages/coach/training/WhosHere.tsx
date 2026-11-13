import { useTranslation } from '@/lib/i18n'
import { whyWord } from '@/lib/training/words'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { registerProblem } from '@/lib/event-register'
import { planPath, type PlannerState } from '@/lib/training/plans'
import { libraryOf, partColour, partLine, partsFromSaved, type Part } from '@/lib/training/parts'
import { adapt, setupFor, playersOf, applySuggestion, type Adaptation } from '@/lib/training/turnout'
import { gameWhen } from '@/components/coach/games/useGames'
import { useHere, useRegisters, useSavePlan, useSquadSize, type Plan, type Training } from '@/components/coach/training/useTraining'
import { TakeRegister } from '@/components/coach/TakeRegister'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'

/* TRAK-342 (Training redo 4/5, spec TRAK-338, 2 Nov prototype): Who's here. The coach takes the register first (the
   existing one, TRAK-138; several names a row so a squad fits a laptop screen, Kostas 2 Nov). Once it's saved, and only
   then (Kostas, 2 Nov: not live per tap), each part of the plan shows what Trak suggests for the players who came: no
   change, a new set-up, or a swap. The coach uses it, keeps the part as planned, or changes it themselves; Save
   today's plan saves the plan whole. TRAK-393: a Library drill is fitted again for those here, at its level; using
   the suggestion takes the new set-up, which View then shows. */

const TRAINING_PATH = '/coach/training'
type Choice = 'use' | 'keep'

export function WhosHere({ training, plan }: { training: Training; plan: Plan | null }) {
  const { user } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const registers = useRegisters()
  const sessionId = registers.data?.get(training.id) ?? null
  const here = useHere(sessionId ? [sessionId] : [])
  const squad = useSquadSize(training.squad ?? null)
  const save = useSavePlan(training.id)
  const [editing, setEditing] = useState(false)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const parts = useMemo(() => partsFromSaved(plan?.practices ?? []), [plan?.practices])
  const { day, time } = gameWhen(training)
  const page = `${TRAINING_PATH}/${training.id}`
  const registerWhy = registerProblem({ ...training, event_type: 'training' }, new Date())
  const count = sessionId ? here.data?.get(sessionId) ?? null : null
  const size = squad.data ?? null
  // Suggestions once the register is saved and both numbers are known.
  const checked = count != null && size != null && !editing
  const adaptations = new Map<string, Adaptation>(checked ? parts.flatMap(p => p.drill ? [[p.key, adapt(p.drill, count, size)] as const] : []) : [])
  const changes = [...adaptations.values()].filter(a => a.status === 'adjust' || (a.status === 'swap' && a.alt)).length
  // Parts that don't work with this many and have nothing Trak can swap to: the coach changes those.
  const stuck = [...adaptations.values()].filter(a => a.status === 'swap' && !a.alt).length
  const players = (n: number) => t('coachMatches:playersCount', { count: n })
  const choiceOf = (key: string): Choice => choices[key] ?? 'use'

  const saveToday = () => {
    const next = parts.map(p => {
      const a = adaptations.get(p.key)
      return a && choiceOf(p.key) === 'use' ? applySuggestion(p, a) : p
    })
    if (next.every((p, i) => p === parts[i])) return navigate(page)
    setProblem(null)
    save.mutate({ parts: next, note: plan?.note ?? '' }, {
      onSuccess: () => { toast.success(t('coachTraining:todaysPlanSaved', { players: players(count ?? 0) })); navigate(page) },
      onError: () => setProblem(t('coachTraining:todaysPlanFailed')),
    })
  }

  return <div className="grid gap-5 pt-5">
    <header className="arc grid gap-2">
      <CoachTrail current={t('coachTraining:loopHere')} parents={[{ label: day, href: page }]} />
      <h1 className="text-[24px] font-medium tracking-[-0.01em] text-ink">{t('coachTraining:whosHereQ')}</h1>
      <p className="text-sm text-ink-2">{[training.title, day, time, training.venue].filter(Boolean).join(' · ')}</p>
    </header>

    {sessionId && !editing ? <section aria-label={t('coachTraining:register')} className="arc flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-3.5">
      <p className="min-w-0 flex-1 text-[15px] text-ink"><span className="font-medium">{size ? t('coachTraining:hereOf', { count: count ?? '…', size }) : t('coachTraining:hereOnly', { count: count ?? '…' })}</span>
        <span className="text-ink-3">{t('coachTraining:registerSaved')}</span></p>
      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil aria-hidden size={14} />{t('coachTraining:change')}</Button>
    </section>
      : <section aria-labelledby="register" className="arc grid gap-3 rounded-2xl border border-line bg-surface p-5">
        <h2 id="register" className="text-lg font-medium text-ink">{t('coachTraining:untick')}</h2>
        {registerWhy && !sessionId ? <p className="text-sm text-ink-2">{registerWhy === 'The register opens once the event has started'
          ? t('coachTraining:hereOpens') : t('coachTraining:hereWhy', { why: whyWord(registerWhy) })}</p>
          : user && <TakeRegister wide eventId={training.id} coachId={user.id} sessionId={sessionId} squad={training.squad ?? null}
            onSaved={() => {
              setEditing(false)
              void client.invalidateQueries({ queryKey: ['coach', user.id, 'training-registers'] })
              void client.invalidateQueries({ queryKey: ['coach', user.id, 'training-here'] })
            }} />}
        <p className="text-sm text-ink-3">{t('coachTraining:everyoneTicked')}</p>
      </section>}

    {!parts.length ? <section aria-labelledby="today" className="arc grid justify-items-start gap-3 rounded-2xl border border-line bg-surface p-5">
      <h2 id="today" className="text-lg font-medium text-ink">{t('coachTraining:noPlanToday')}</h2>
      <p className="text-sm text-ink-2">{t('coachTraining:registerAnyway')}</p>
      <Button variant="secondary" onClick={() => navigate(planPath(training.id))}>{t('coachTraining:planSession')}</Button>
    </section>
      : <section aria-labelledby="today" className={`arc grid gap-4 rounded-2xl border border-line bg-surface p-5 ${checked ? '' : 'opacity-60'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 id="today" className="text-lg font-medium text-ink">{checked ? t('coachTraining:todaysPlanFor', { players: players(count) }) : size ? t('coachTraining:yourPlanForAll', { size }) : t('coachTraining:yourPlanForSquad')}</h2>
            <p className="text-sm text-ink-3">{!checked ? t('coachTraining:checksOnceDone')
              : count === size ? t('coachTraining:everyoneWorks')
              : [changes ? t('coachTraining:partsNeed', { count: changes }) : '',
                stuck ? t('coachTraining:partsStuck', { count: stuck, players: players(count) }) : '',
              ].filter(Boolean).join(' ') || t('coachTraining:planStillWorks')}</p>
          </div>
          {checked && changes > 0 && <Button size="sm" variant="secondary" onClick={() => setChoices({})}>{t('coachTraining:useAllSuggestions')}</Button>}
        </div>
        <ol aria-label={t('coachTraining:todaysPlan')} className="grid gap-3 tablet:grid-cols-2 laptop:grid-cols-5">
          {parts.map((part, i) => <li key={part.key}>
            <PartColumn part={part} index={i} count={parts.length} squad={size} adaptation={adaptations.get(part.key)} choice={choiceOf(part.key)}
              onChoose={choice => setChoices(c => ({ ...c, [part.key]: choice }))}
              onChange={() => navigate(planPath(training.id), { state: { editPart: i } satisfies PlannerState })} />
          </li>)}
        </ol>
      </section>}

    {problem && <p role="alert" className="text-[15px] text-danger">{problem}</p>}
    <div className="arc flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={() => navigate(page)}>{t('common:back')}</Button>
      <span className="flex-1" />
      {checked && parts.length > 0 && <Button size="lg" loading={save.isPending} onClick={saveToday}>{t('coachTraining:saveTodaysPlan')}</Button>}
    </div>
  </div>
}

/** One part: what was planned for the squad, and Trak's suggestion for those here. */
function PartColumn({ part, index, count, squad, adaptation, choice, onChoose, onChange }: {
  part: Part; index: number; count: number; squad: number | null; adaptation: Adaptation | undefined; choice: Choice
  onChoose: (choice: Choice) => void; onChange: () => void
}) {
  const { t } = useTranslation()
  const players = part.drill ? playersOf(part.drill) : null
  const planned = players && squad ? setupFor(players, squad) : null
  // TRAK-393: a Library drill says the set-up it was planned with, in its own words.
  const lib = libraryOf(part.drill)
  const badge = !adaptation ? null : adaptation.status === 'same' ? { label: t('coachTraining:noChange'), tone: 'success' as const }
    : adaptation.status === 'adjust' ? { label: t('coachTraining:adjust'), tone: 'warning' as const }
    : adaptation.status === 'swap' ? { label: t('coachTraining:swap'), tone: 'warning' as const } : { label: t('coachTraining:checkIt'), tone: 'neutral' as const }
  const offer = adaptation && (adaptation.status === 'adjust' || (adaptation.status === 'swap' && !!adaptation.alt))
  return <article aria-label={part.name} className="flex h-full flex-col gap-2 rounded-xl border border-line p-3.5">
    <span className="flex items-center gap-1.5 text-[13px] text-ink-3">
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: partColour(index, count) }} />{partLine(part, index)}</span>
    {badge && <span><Badge size="sm" tone={badge.tone}>{badge.label}</Badge></span>}
    <p className="text-[15px] font-medium text-ink break-words">{part.drill?.name ?? t('coachTraining:noDrillYet')}</p>
    <p className="text-[13px] text-ink-3">{t('coachHome:minutes', { count: part.minutes })}{lib && part.drill
      ? t('coachTraining:plannedDetail', { detail: [part.drill.numbers, part.drill.area].filter(Boolean).join(', ') })
      : planned?.ok && squad ? t('coachTraining:plannedFor', { squad, text: planned.text }) : ''}</p>
    {adaptation && (adaptation.status === 'same'
      ? <p className="text-sm text-brand">{adaptation.message}</p>
      : <p className="flex gap-1.5 rounded-lg bg-raised p-2.5 text-sm text-ink">
        <Sparkles aria-hidden size={16} className="mt-0.5 flex-none text-brand" />
        <span>{adaptation.status === 'unknown' ? adaptation.message : <><span className="font-medium">{t('coachTraining:trakSuggests')}</span> {adaptation.message}</>}</span></p>)}
    <div className="mt-auto grid justify-items-start gap-1.5 pt-1">
      {offer && <SegmentedControl label={t('coachTraining:whatToDo', { part: part.name })} value={choice}
        options={[{ value: 'use', label: t('coachTraining:useIt') }, { value: 'keep', label: t('coachTraining:keep') }]} onValueChange={value => onChoose(value as Choice)} />}
      {adaptation && <button type="button" onClick={onChange}
        className="min-h-9 rounded text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {t('coachTraining:changeMyself')}</button>}
    </div>
  </article>
}
