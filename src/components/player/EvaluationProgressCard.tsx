import { ObjectiveStatusChip } from '@/components/player/ObjectiveStatusChip'
import { format, parseISO } from 'date-fns'
import { progressLabel } from '@/lib/objective-progress'
import type { EvaluationObjective } from '@/lib/evaluation-progress'

/* TRAK-401, TRAK-402 (Season plan 18/18 builds 6 and 7, spec TRAK-366): the Progress on one published evaluation, shared by
   the player's evaluation page and the family's assessment. Each objective with its word at this evaluation and, once
   there is more than one, "4 Oct: Not yet, then 1 Nov: On track". It carries no note. */

const font = { fontFamily: 'var(--t-font)' }

export function EvaluationProgressCard({ objectives }: { objectives: EvaluationObjective[] }) {
  if (objectives.length === 0) return null
  return (
    <section aria-label="Progress" className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-[15px] font-medium text-ink-2" style={font}>Progress</h2>
      <ul className="m-0 grid list-none gap-3.5 p-0">
        {objectives.map(o => (
          <li key={o.id} className="grid gap-1">
            <div className="flex items-start justify-between gap-2.5">
              <span className="text-[16px] font-medium text-ink" style={font}>{o.title}</span>
              <ObjectiveStatusChip status={o.status} />
            </div>
            {o.history.length > 1 && (
              <span className="text-[14px] text-ink-2" style={font}>
                {o.history.map(h => `${format(parseISO(h.due_on), 'd MMM')}: ${progressLabel(h.status)}`).join(', then ')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
