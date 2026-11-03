import { Check } from 'lucide-react'
import { LOOP_STEPS, type LoopState } from '@/lib/training/loop'

/* TRAK-295 (Training 2/5, spec TRAK-293): every training's loop and where this one is. TRAK-298 (5/5): each step done
   or not comes from what exists (loopState). TRAK-339 (Training redo 1/5): Logistics → Plan → Who's here → Notes. */

/** `note` says why the current step is there, e.g. "now". */
export function LoopStrip({ state, note }: { state: Pick<LoopState, 'done' | 'at' | 'closed'>; note: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <ol aria-label="Training loop" className="flex flex-wrap items-center gap-1.5">
        {LOOP_STEPS.map((step, i) => {
          const done = state.done[i]
          const current = i === state.at
          return <li key={step} aria-current={current ? 'step' : undefined} className="flex items-center gap-1.5 text-[13px]">
            {i > 0 && <span aria-hidden="true" className="text-ink-3">→</span>}
            <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1 ${done ? 'bg-brand font-medium text-on-brand'
              : current ? 'border-[1.5px] border-brand bg-brand/10 font-medium text-brand' : 'bg-raised text-ink-3'}`}>
              {done && <Check aria-hidden size={14} />}
              {i + 1} · {step}
              {done && <span className="sr-only">(done)</span>}
              {current && <span className="font-normal">({note})</span>}
            </span>
          </li>
        })}
      </ol>
      <span className="text-[13px] text-ink-3">{state.closed ? 'Closed. It’s in Past trainings.'
        : 'It closes when the training ends and the register is taken. Notes are optional.'}</span>
    </div>
  )
}
