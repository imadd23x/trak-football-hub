import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { registerProblem } from '@/lib/event-register'
import { planPath, type PlannerState } from '@/lib/training/plans'
import { partColour, partLine, partsFromSaved, type Part } from '@/lib/training/parts'
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
   today's plan saves the plan whole. */

const TRAINING_PATH = '/coach/training'
type Choice = 'use' | 'keep'

export function WhosHere({ training, plan }: { training: Training; plan: Plan | null }) {
  const { user } = useAuth()
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
  const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`
  const choiceOf = (key: string): Choice => choices[key] ?? 'use'

  const saveToday = () => {
    const next = parts.map(p => {
      const a = adaptations.get(p.key)
      return a && choiceOf(p.key) === 'use' ? applySuggestion(p, a) : p
    })
    if (next.every((p, i) => p === parts[i])) return navigate(page)
    setProblem(null)
    save.mutate({ parts: next, note: plan?.note ?? '' }, {
      onSuccess: () => { toast.success(`Today’s plan saved for ${players(count ?? 0)}`); navigate(page) },
      onError: () => setProblem('Couldn’t save today’s plan. Check your connection and try again. Your choices are still here.'),
    })
  }

  return <div className="grid gap-5 pt-5">
    <header className="arc grid gap-2">
      <CoachTrail current="Who’s here" parents={[{ label: day, href: page }]} />
      <h1 className="text-[24px] font-medium tracking-[-0.01em] text-ink">Who’s here?</h1>
      <p className="text-sm text-ink-2">{[training.title, day, time, training.venue].filter(Boolean).join(' · ')}</p>
    </header>

    {sessionId && !editing ? <section aria-label="Register" className="arc flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-3.5">
      <p className="min-w-0 flex-1 text-[15px] text-ink"><span className="font-medium">{count ?? '…'}{size ? ` of ${size}` : ''} here.</span>
        <span className="text-ink-3"> The register is saved.</span></p>
      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil aria-hidden size={14} />Change</Button>
    </section>
      : <section aria-labelledby="register" className="arc grid gap-3 rounded-2xl border border-line bg-surface p-5">
        <h2 id="register" className="text-lg font-medium text-ink">Untick anyone who isn’t here</h2>
        {registerWhy && !sessionId ? <p className="text-sm text-ink-2">{registerWhy === 'The register opens once the event has started'
          ? 'Who’s here opens when the training starts.' : `Who’s here: ${registerWhy.toLowerCase()}.`}</p>
          : user && <TakeRegister wide eventId={training.id} coachId={user.id} sessionId={sessionId} squad={training.squad ?? null}
            onSaved={() => {
              setEditing(false)
              void client.invalidateQueries({ queryKey: ['coach', user.id, 'training-registers'] })
              void client.invalidateQueries({ queryKey: ['coach', user.id, 'training-here'] })
            }} />}
        <p className="text-sm text-ink-3">Everyone starts ticked, as planned. Trak checks your plan once you’re done.</p>
      </section>}

    {!parts.length ? <section aria-labelledby="today" className="arc grid justify-items-start gap-3 rounded-2xl border border-line bg-surface p-5">
      <h2 id="today" className="text-lg font-medium text-ink">No plan for today</h2>
      <p className="text-sm text-ink-2">Take the register anyway. You can still plan the session.</p>
      <Button variant="secondary" onClick={() => navigate(planPath(training.id))}>Plan session</Button>
    </section>
      : <section aria-labelledby="today" className={`arc grid gap-4 rounded-2xl border border-line bg-surface p-5 ${checked ? '' : 'opacity-60'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 id="today" className="text-lg font-medium text-ink">{checked ? `Today’s plan for ${players(count)}` : `Your plan, for all ${size ?? 'your squad'}`}</h2>
            <p className="text-sm text-ink-3">{!checked ? 'Trak checks it once you’re done with the register.'
              : count === size ? 'Everyone’s here. Your plan works as it is.'
              : [changes ? `${changes} ${changes === 1 ? 'part needs' : 'parts need'} a change. Pick “Use it” or “Keep” for each.` : '',
                stuck ? `${stuck} ${stuck === 1 ? 'part doesn’t' : 'parts don’t'} work with ${players(count)}. Change ${stuck === 1 ? 'it' : 'them'} yourself.` : '',
              ].filter(Boolean).join(' ') || 'Your plan still works.'}</p>
          </div>
          {checked && changes > 0 && <Button size="sm" variant="secondary" onClick={() => setChoices({})}>Use all suggestions</Button>}
        </div>
        <ol aria-label="Today’s plan" className="grid gap-3 tablet:grid-cols-2 laptop:grid-cols-5">
          {parts.map((part, i) => <li key={part.key}>
            <PartColumn part={part} index={i} count={parts.length} squad={size} adaptation={adaptations.get(part.key)} choice={choiceOf(part.key)}
              onChoose={choice => setChoices(c => ({ ...c, [part.key]: choice }))}
              onChange={() => navigate(planPath(training.id), { state: { editPart: i } satisfies PlannerState })} />
          </li>)}
        </ol>
      </section>}

    {problem && <p role="alert" className="text-[15px] text-danger">{problem}</p>}
    <div className="arc flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={() => navigate(page)}>Back</Button>
      <span className="flex-1" />
      {checked && parts.length > 0 && <Button size="lg" loading={save.isPending} onClick={saveToday}>Save today’s plan</Button>}
    </div>
  </div>
}

/** One part: what was planned for the squad, and Trak's suggestion for those here. */
function PartColumn({ part, index, count, squad, adaptation, choice, onChoose, onChange }: {
  part: Part; index: number; count: number; squad: number | null; adaptation: Adaptation | undefined; choice: Choice
  onChoose: (choice: Choice) => void; onChange: () => void
}) {
  const players = part.drill ? playersOf(part.drill) : null
  const planned = players && squad ? setupFor(players, squad) : null
  const badge = !adaptation ? null : adaptation.status === 'same' ? { label: 'No change', tone: 'success' as const }
    : adaptation.status === 'adjust' ? { label: 'Adjust', tone: 'warning' as const }
    : adaptation.status === 'swap' ? { label: 'Swap', tone: 'warning' as const } : { label: 'Check it', tone: 'neutral' as const }
  const offer = adaptation && (adaptation.status === 'adjust' || (adaptation.status === 'swap' && !!adaptation.alt))
  return <article aria-label={part.name} className="flex h-full flex-col gap-2 rounded-xl border border-line p-3.5">
    <span className="flex items-center gap-1.5 text-[13px] text-ink-3">
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: partColour(index, count) }} />{partLine(part, index)}</span>
    {badge && <span><Badge size="sm" tone={badge.tone}>{badge.label}</Badge></span>}
    <p className="text-[15px] font-medium text-ink break-words">{part.drill?.name ?? 'No drill yet'}</p>
    <p className="text-[13px] text-ink-3">{part.minutes} min{planned?.ok && squad ? ` · planned for ${squad}: ${planned.text}` : ''}</p>
    {adaptation && (adaptation.status === 'same'
      ? <p className="text-sm text-brand">{adaptation.message}</p>
      : <p className="flex gap-1.5 rounded-lg bg-raised p-2.5 text-sm text-ink">
        <Sparkles aria-hidden size={16} className="mt-0.5 flex-none text-brand" />
        <span>{adaptation.status === 'unknown' ? adaptation.message : <><span className="font-medium">Trak suggests:</span> {adaptation.message}</>}</span></p>)}
    <div className="mt-auto grid justify-items-start gap-1.5 pt-1">
      {offer && <SegmentedControl label={`What to do with ${part.name}`} value={choice}
        options={[{ value: 'use', label: 'Use it' }, { value: 'keep', label: 'Keep' }]} onValueChange={value => onChoose(value as Choice)} />}
      {adaptation && <button type="button" onClick={onChange}
        className="min-h-9 rounded text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        Change it myself</button>}
    </div>
  </article>
}
