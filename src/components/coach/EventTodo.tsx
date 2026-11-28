import { useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { Button, type ButtonSize, type ButtonVariant } from '@/components/arc/button/button'
import { isCancelled, type EventRow } from '@/lib/coach-events'
import { phoneEventTime } from '@/lib/event-time'
import { evalDay } from '@/lib/evaluation'
import { venueParts } from '@/lib/venue-link'
import { dayIn } from '@/lib/watch-first'
import { useAcademyTimeZone } from './season-plan/useWatching'
import { useTranslation } from '@/lib/i18n'
import { EVENT_TODO_ACTIONS, EVENT_TODO_WHENS, dueOn, firstWhen, openEventTodos, whenOffered, wordsMax,
  type EventTodoAction, type EventTodoWhen } from '@/lib/event-todo'
import { useAddTodo, useOwnTodos } from './home/useOwnTodos'

/* TRAK-622 (Other events → To-do 2/6, spec TRAK-620; Kostas's 28 Nov mockup): Add to To-do on an "Other" event. One
   pop-up asks what to do (Invite the team, Be there, Bring or buy something, or the coach's own words) and when it shows
   (Today, The day before, On the day), and saves one of the coach's own to-dos linked to the event. The Events card,
   its sheet and Upcoming show the same button, or "In To-do" once it's added (steps 3 and 5). */

/** The event, as the pop-up shows it. `day` is the academy's day (YYYY-MM-DD); `time` is HH:mm. */
export type TodoEvent = { id: string; title: string; day: string; time: string | null; venue: string | null }


/** TRAK-623: whether an event offers Add to To-do: an "Other" event of the coach's own, not cancelled and not over (its
 *  end has passed, or, with no end, its day has). Trainings and matches reach the To-do with their own steps. */
export function offersEventTodo(row: Pick<EventRow, 'event_type' | 'status' | 'starts_at' | 'ends_at' | 'event_date'> & { coach_user_id?: string },
  coachId: string | undefined, zone: string, now = Date.now()): boolean {
  // The screens read only the coach's own events; a row that says whose it is must be theirs (TRAK-621's rule).
  if (row.event_type !== 'other' || isCancelled(row) || !coachId || (row.coach_user_id && row.coach_user_id !== coachId) || !row.starts_at) return false
  return row.ends_at ? Date.parse(row.ends_at) > now : eventDay(row, zone) >= dayIn(zone, new Date(now))
}

/** The event's academy day: its own date, or, for an old row without one, the day its start falls on there. */
const eventDay = (row: Pick<EventRow, 'starts_at' | 'event_date'>, zone: string) => row.event_date || dayIn(zone, new Date(row.starts_at))

/** TRAK-623: an event as the pop-up shows it: its academy day, its time, and its venue without a Maps link. */
function todoEventOf(row: Pick<EventRow, 'id' | 'title' | 'starts_at' | 'event_date' | 'start_time' | 'venue'>, zone: string): TodoEvent {
  return { id: row.id, title: row.title, day: eventDay(row, zone), time: phoneEventTime(row).time,
    venue: row.venue ? venueParts(row.venue).text || null : null }
}

/** The coach's events already In To-do, and the day each shows from. */
export function useEventTodos(coachId: string | undefined) {
  const own = useOwnTodos(coachId)
  return useMemo(() => openEventTodos(own.data ?? []), [own.data])
}

/** TRAK-623: Add to To-do for an event row, where it's offered (an "Other" event of the coach's, not cancelled or over),
 *  or In To-do once added; nothing otherwise. Screens render it only for "Other" events, so no other event asks for the
 *  coach's to-dos or the academy's time zone. */
export function EventTodoSlot({ row, coachId, variant, size }: {
  row: Parameters<typeof offersEventTodo>[0] & Parameters<typeof todoEventOf>[0]
  coachId: string | undefined
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  const open = useEventTodos(coachId)
  const { zone } = useAcademyTimeZone(coachId)
  if (!offersEventTodo(row, coachId, zone)) return null
  return <EventTodoButton event={todoEventOf(row, zone)} today={dayIn(zone, new Date())} inTodo={open.get(row.id)} variant={variant} size={size} />
}

const ACTION_WORD = { invite: 'coachHome:eventTodoInvite', there: 'coachHome:eventTodoThere', bring: 'coachHome:eventTodoBring', else: 'coachHome:eventTodoElse' } as const
const WHEN_WORD = { today: 'coachHome:eventTodoToday', before: 'coachHome:eventTodoBefore', onday: 'coachHome:eventTodoOnDay' } as const
const chip = (pressed: boolean) => `rounded-full border px-3.5 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${pressed ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink hover:border-line-strong'}`

function AddEventTodoSheet({ event, today, open, onOpenChange }: {
  event: TodoEvent
  /** The academy's day. */
  today: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const add = useAddTodo()
  const [action, setAction] = useState<EventTodoAction>('invite')
  const [when, setWhen] = useState<EventTodoWhen>(() => firstWhen('invite', event.day, today))
  const [words, setWords] = useState('')
  const isToday = event.day <= today
  const due = dueOn(when, event.day, today)
  const doing = action === 'else' ? words.trim() : t(ACTION_WORD[action])
  const line = t('coachHome:eventTodoLine', { action: doing || t('coachHome:eventTodoElsePh'), event: event.title })
  const place = [event.title, isToday ? t('coachHome:eventTodoToday') : evalDay(event.day), event.time, event.venue].filter(Boolean).join(' · ')
  const reset = () => { setAction('invite'); setWhen(firstWhen('invite', event.day, today)); setWords('') }
  const close = () => { onOpenChange(false); reset() }
  const pick = (next: EventTodoAction) => { setAction(next); setWhen(firstWhen(next, event.day, today)) }
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault()
    if (!doing) return
    add.mutate({ title: t('coachHome:eventTodoLine', { action: doing, event: event.title }), dueOn: due, urgent: false, eventId: event.id }, {
      onSuccess: () => { toast.success(due === today ? t('coachHome:eventTodoAdded') : t('coachHome:eventTodoAddedFor', { day: evalDay(due) })); close() },
      // 23505: this event already has a to-do open (one per event, TRAK-621), e.g. added on another screen.
      onError: (error: unknown) => {
        if ((error as { code?: string } | null)?.code === '23505') { toast.error(t('coachHome:eventTodoTaken')); close() }
        else toast.error(t('coachHome:eventTodoFailed'))
      },
    })
  }
  return <BottomSheet className="arc" open={open} onOpenChange={next => (next ? onOpenChange(true) : close())} title={t('coachHome:eventTodoAdd')} description={place}>
    <form onSubmit={submit} aria-label={t('coachHome:eventTodoAdd')} className="grid gap-5 pb-4">
      <fieldset className="grid gap-2.5">
        <legend className="mb-2.5 text-[15px] font-semibold text-ink">{t('coachHome:eventTodoWhat')}</legend>
        <div className="flex flex-wrap gap-2">
          {EVENT_TODO_ACTIONS.map(option => <button key={option} type="button" aria-pressed={action === option} className={chip(action === option)}
            onClick={() => pick(option)}>{t(ACTION_WORD[option])}</button>)}
        </div>
        {action === 'else' && <input autoFocus value={words} maxLength={wordsMax(event.title)} onChange={change => setWords(change.target.value)}
          aria-label={t('coachHome:eventTodoElse')} placeholder={t('coachHome:eventTodoElsePh')}
          className="w-full rounded-xl border border-line bg-ground px-3 py-2.5 text-[16px] text-ink placeholder-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-primary" />}
      </fieldset>
      <fieldset className="grid gap-2.5">
        <legend className="mb-2.5 text-[15px] font-semibold text-ink">{t('coachHome:eventTodoWhen')}</legend>
        <div className="flex flex-wrap gap-2">
          {EVENT_TODO_WHENS.map(option => <button key={option} type="button" aria-pressed={when === option} disabled={!whenOffered(option, event.day, today)}
            className={chip(when === option)} onClick={() => setWhen(option)}>{t(WHEN_WORD[option])}</button>)}
        </div>
        {isToday && <p className="text-[13px] text-ink-2">{t('coachHome:eventTodoIsToday', { event: event.title })}</p>}
      </fieldset>
      <div role="status" className="grid gap-0.5 rounded-xl bg-raised px-3.5 py-3 text-[13px] text-ink-2">
        <span>{t('coachHome:eventTodoWillSay')}</span>
        <strong className="text-[15px] font-semibold text-ink">{line}</strong>
        <span>{due === today ? t('coachHome:eventTodoShowsToday') : t('coachHome:eventTodoShowsFrom', { day: evalDay(due) })}</span>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={close}>{t('coachHome:eventTodoCancel')}</Button>
        <Button type="submit" loading={add.isPending} disabled={!doing}>{t('coachHome:eventTodoAdd')}</Button>
      </div>
    </form>
  </BottomSheet>
}

/** "In To-do", with the day it shows from when that's later than today. */
function InTodoChip({ dueOn: day, today }: { dueOn: string; today: string }) {
  const { t } = useTranslation()
  return <span className="whitespace-nowrap rounded-full bg-raised px-2.5 py-1 text-[13px] font-medium text-ink-2">
    {day > today ? t('coachHome:eventTodoInFrom', { day: evalDay(day) }) : t('coachHome:upcomingInTodo')}
  </span>
}

/** Add to To-do for one event, or "In To-do" once it's added. */
export function EventTodoButton({ event, today, inTodo, variant = 'secondary', size = 'sm' }: {
  event: TodoEvent
  today: string
  /** This event's open to-do (useEventTodos), if it has one. */
  inTodo: { dueOn: string } | undefined
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (inTodo) return <InTodoChip dueOn={inTodo.dueOn} today={today} />
  return <>
    <Button type="button" variant={variant} size={size} aria-label={t('coachHome:eventTodoAddNamed', { event: event.title })}
      onClick={() => setOpen(true)}>{t('coachHome:eventTodoAdd')}</Button>
    <AddEventTodoSheet event={event} today={today} open={open} onOpenChange={setOpen} />
  </>
}
