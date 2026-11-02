import { Plus } from 'lucide-react'
import { LIMITS, MAX_GOALS, STRENGTHS, emptyGoal, type Goal, type PlanForm, type Strength } from '@/lib/games/plan'
import { LockIcon } from '@/components/icons/LockIcon'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import { Textarea } from '@/components/arc/textarea/textarea'
import { Tooltip } from '@/components/arc/tooltip/tooltip'

/* TRAK-284 (Games 2/8): plan step 1 (TRAK-282). TRAK-287: locked at kick-off, the fields read only, the picker becomes
   words, and nothing can be added or removed. TRAK-328 (Imad, 2 Nov): the step is Tactics & analysis; the goals are
   Instructions, none shown until the coach adds one; their likely line-up is gone; how strong they are asks only its
   question, with his lock saying who sees it (Arc tooltip, which a tap opens too). TRAK-337 (Imad, 2 Nov): Scouting has
   the same lock. */

const card = 'grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5'

/** Imad's lock at a card's top right: "Only you can see this" on hover, focus or a tap. `what` names it for screen readers. */
function OnlyYou({ what }: { what: string }) {
  return <Tooltip content="Only you can see this" openOnTap>
    <button type="button" aria-label={`Who sees ${what}`}
      className="-m-1.5 grid size-9 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <LockIcon size={20} />
    </button>
  </Tooltip>
}

export function TacticsAndAnalysis({ eventId, opponent, form, onFormChange, locked = false }: {
  eventId: string; opponent: string | null; form: PlanForm; onFormChange: (form: PlanForm) => void; locked?: boolean
}) {
  const change = (next: Partial<PlanForm>) => onFormChange({ ...form, ...next })
  const setGoal = (index: number, next: Partial<Goal>) => change({ goals: form.goals.map((goal, i) => i === index ? { ...goal, ...next } : goal) })
  const strong = `How strong are ${opponent ?? 'they'}?`

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 laptop:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] laptop:items-start">
        <div className="grid min-w-0 gap-4">
        <section aria-labelledby="plan-goals" className={card}>
          <div>
            <h2 id="plan-goals" className="text-lg font-medium text-ink">Instructions</h2>
            <p className="mt-1 text-sm text-ink-3">Up to three. Players see them once you share the plan.</p>
          </div>
          {form.goals.length > 0 && <ol className="grid gap-5">
            {form.goals.map((goal, index) => <li key={index}>
              <fieldset className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                <legend className="sr-only">Instruction {index + 1}</legend>
                <span aria-hidden="true" className="row-span-3 grid size-7 place-items-center rounded-full bg-ink text-sm font-medium text-surface">{index + 1}</span>
                <Input label="Instruction" value={goal.title} maxLength={LIMITS.title} readOnly={locked} onChange={event => setGoal(index, { title: event.target.value })} />
                <Textarea label="What it looks like" rows={2} value={goal.looksLike} maxLength={LIMITS.looksLike} readOnly={locked}
                  onChange={event => setGoal(index, { looksLike: event.target.value })} />
                {!locked && <span><Button variant="ghost" size="sm" aria-label={`Remove instruction ${index + 1}`}
                  onClick={() => change({ goals: form.goals.filter((_, i) => i !== index) })}>Remove</Button></span>}
              </fieldset>
            </li>)}
          </ol>}
          {locked && form.goals.length === 0 && <p className="text-sm text-ink-2">No instructions.</p>}
          {form.goals.length < MAX_GOALS && !locked && <span><Button variant="ghost" size="sm" onClick={() => change({ goals: [...form.goals, emptyGoal()] })}>
            <Plus size={16} aria-hidden="true" />Add instruction</Button></span>}
        </section>

        <section aria-labelledby="plan-scouting" className={card}>
          <div className="flex items-start justify-between gap-3">
            <h2 id="plan-scouting" className="text-lg font-medium text-ink">Scouting</h2>
            <OnlyYou what="scouting" />
          </div>
          <Textarea label="What you know about them" rows={4} value={form.scouting} maxLength={LIMITS.scouting} readOnly={locked}
            onChange={event => change({ scouting: event.target.value })} />
        </section>
        </div>

        <section aria-labelledby="plan-strength" className={card}>
          <div className="flex items-start justify-between gap-3">
            <h2 id="plan-strength" className="text-lg font-medium text-ink">{strong}</h2>
            <OnlyYou what="how strong they are" />
          </div>
          {locked ? <p className="text-sm text-ink">{STRENGTHS.find(option => option.value === form.strength)?.label ?? 'Not set'}</p>
            : <RadioGroup label={strong} hideLabel name={`strength-${eventId}`} options={STRENGTHS} value={form.strength ?? ''}
                onValueChange={value => change({ strength: value as Strength })} />}
        </section>
      </div>
    </div>
  )
}
