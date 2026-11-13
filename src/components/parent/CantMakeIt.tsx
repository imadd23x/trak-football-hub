import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { format, parseISO } from 'date-fns'
import { Button as ArcButton } from '@/components/arc/button/button'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { eventHeading, type PlayerEvent } from '@/lib/player-events'
import { ABSENCE_REASONS, absenceReasonWord, type AbsenceReason } from '@/lib/absence-reasons'

/* TRAK-137 (J8.14, Imad 8 Oct): like a school register, everyone counts as
   coming; a guardian reports the exception (or, since TRAK-183, a player at or
   above their academy's consent age, for themselves). The database decides who may and
   until when (report_cant_make_it / undo_cant_make_it, kickoff), so this page
   only shows its answer. Hidden on cancelled and past days, like the lists. */
async function fetchAbsence(childId: string, eventId: string, signal: AbortSignal) {
  const squad = await supabase.from('squad_players').select('id').eq('linked_player_id', childId)
    .abortSignal(signal).retry(false)
  if (squad.error) throw squad.error
  const ids = (squad.data ?? []).map(row => row.id)
  if (!ids.length) return null
  const { data, error } = await supabase.from('event_absences').select('reason').eq('event_id', eventId)
    .in('squad_player_id', ids).abortSignal(signal).retry(false).maybeSingle()
  if (error) throw error
  return data
}

/** Cancelled and past days take no report (the database also refuses after kickoff). */
const closed = (event: PlayerEvent) => event.status === 'cancelled' || event.date < new Date().toLocaleDateString('en-CA')

/** `self`: the player reporting for themselves, at or above their academy's
 *  consent age (TRAK-183). The words say "you"; the database decides.
 *  `onDone`: inside CantMakeItButton's sheet, it opens on the reasons and closes the sheet when sent or cancelled. */
export function CantMakeIt({ event, child, self = false, onDone }: { event: PlayerEvent; child: { id: string; name: string }; self?: boolean; onDone?: () => void }) {
  const reasonId = useId()
  const client = useQueryClient()
  const [writing, setWriting] = useState(!!onDone)
  const [reason, setReason] = useState<AbsenceReason | ''>('')
  const key = ['parent', 'absence', child.id, event.id]
  const absence = useQuery({ queryKey: key, queryFn: ({ signal }) => fetchAbsence(child.id, event.id, signal) })
  const change = useMutation({
    mutationFn: async (report: boolean) => {
      const { error } = report
        ? await supabase.rpc('report_cant_make_it', { p_event_id: event.id, p_child: child.id, p_reason: reason || undefined })
        : await supabase.rpc('undo_cant_make_it', { p_event_id: event.id, p_child: child.id })
      if (error) throw error
    },
    // TRAK-231: the whole child's absences, so the week strip's marks follow too.
    onSuccess: () => { setWriting(false); setReason(''); onDone?.(); return client.invalidateQueries({ queryKey: ['parent', 'absence', child.id] }) },
  })

  if (closed(event)) return null
  const refusal = change.error && <p role="alert" className="text-sm text-destructive mt-2">{change.error.message}</p>
  const button = 'min-h-11 shrink-0 px-4 rounded-full border border-border text-sm text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50'

  return (
    // No box: one line and its button (Imad, 16 Oct: the box took space for nothing).
    <section aria-label="Attendance" className="arc">
      {absence.isError ? <>
        <p className="text-sm text-foreground">Couldn't check whether {self ? "you're" : `${child.name} is`} coming.</p>
        <button type="button" onClick={() => { void absence.refetch() }} className={`${button} mt-3`}>Retry</button>
      </> : absence.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading…</p>
        : absence.data ? <>
          <p className="text-sm text-foreground">You told the coach {self ? 'you' : child.name} can't make it.</p>
          {absenceReasonWord(absence.data.reason) && <p className="text-sm text-muted-foreground mt-1">{absenceReasonWord(absence.data.reason)}</p>}
          <button type="button" disabled={change.isPending} onClick={() => change.mutate(false)} className={`${button} mt-3`}>Undo</button>
          {refusal}
        </> : writing ? <>
          {/* TRAK-249 (Imad, 21 Oct; list 13 Nov): a fixed choice, no text box, so no health details can be typed. */}
          <p id={reasonId} className="text-sm text-ink mb-2">Reason (optional, the coach sees it)</p>
          <div role="radiogroup" aria-labelledby={reasonId} className="flex flex-wrap gap-2">
            {ABSENCE_REASONS.map(key => <label key={key} className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm text-ink focus-within:ring-2 focus-within:ring-primary ${reason === key ? 'border-brand bg-brand/10' : 'border-line'}`}>
              <input type="radio" name={reasonId} value={key} checked={reason === key} onChange={() => setReason(key)} className="sr-only" />
              {absenceReasonWord(key)}
            </label>)}
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" disabled={change.isPending} onClick={() => change.mutate(true)} className={button}>Tell the coach</button>
            <button type="button" onClick={() => { change.reset(); if (onDone) onDone(); else setWriting(false) }} className={button}>Cancel</button>
          </div>
          {refusal}
        </> : <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Everyone counts as coming. Only say if {self ? 'you' : child.name} can't.</p>
            {/* Arc's danger button (Imad, 16 Oct): the one action here that changes the default. */}
            <ArcButton variant="danger" className="shrink-0" onClick={() => setWriting(true)}>Can't make it</ArcButton>
          </div>
        </>}
    </section>
  )
}

/** TRAK-441 (mockup, 12 Nov): the family week's red Can't make it beside Details, for an event not yet reported.
 *  The reasons open in a sheet; Undo stays in Details. */
export function CantMakeItButton({ event, child, self = false }: { event: PlayerEvent & { absent?: boolean }; child: { id: string; name: string }; self?: boolean }) {
  const [open, setOpen] = useState(false)
  if (event.absent || closed(event)) return null
  return <BottomSheet open={open} onOpenChange={setOpen} title="Can't make it" description={eventHeading(event)}
    aside={format(parseISO(event.date), 'EEE MMM d')} className="arc"
    trigger={<ArcButton variant="danger" size="sm">Can't make it</ArcButton>}>
    <div className="pb-4"><CantMakeIt event={event} child={child} self={self} onDone={() => setOpen(false)} /></div>
  </BottomSheet>
}
