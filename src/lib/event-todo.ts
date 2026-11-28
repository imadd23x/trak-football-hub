/* TRAK-622 (Other events → To-do 2/6, spec TRAK-620): the rules behind Add to To-do on an "Other" event. Kostas, 27 Nov,
   with Makis's rule: nothing goes into the To-do by itself; the coach says what to do about the event and when it shows,
   and it saves as one of their own to-dos (coach_todos, TRAK-612) linked to the event (TRAK-621). Days are the
   academy's (YYYY-MM-DD), as the rest of Home's are. */

export type EventTodoAction = 'invite' | 'there' | 'bring' | 'else'
export type EventTodoWhen = 'today' | 'before' | 'onday'

export const EVENT_TODO_ACTIONS: EventTodoAction[] = ['invite', 'there', 'bring', 'else']
export const EVENT_TODO_WHENS: EventTodoWhen[] = ['today', 'before', 'onday']

/** Each action's starting choice: inviting starts now, bringing something the day before, the rest on the day. */
const FIRST: Record<EventTodoAction, EventTodoWhen> = { invite: 'today', there: 'onday', bring: 'before', else: 'onday' }

/** A coach's own to-do can't be longer than this (coach_todos.title). */
export const TODO_MAX = 120

export const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** Whether a choice is offered: one that falls on today or earlier isn't, since Today stands in for it. */
export function whenOffered(when: EventTodoWhen, eventDay: string, today: string): boolean {
  if (when === 'today') return true
  return (when === 'before' ? addDays(eventDay, -1) : eventDay) > today
}

/** The choice an action starts on, or Today where that one isn't offered. */
export function firstWhen(action: EventTodoAction, eventDay: string, today: string): EventTodoWhen {
  const when = FIRST[action]
  return whenOffered(when, eventDay, today) ? when : 'today'
}

/** The academy day the to-do is for. Never before today. */
export function dueOn(when: EventTodoWhen, eventDay: string, today: string): string {
  const day = when === 'today' ? today : when === 'before' ? addDays(eventDay, -1) : eventDay
  return day > today ? day : today
}

/** How long the coach's own words can be, so "<words> · <event>" fits a to-do. */
export const wordsMax = (eventTitle: string) => Math.max(1, TODO_MAX - ' · '.length - eventTitle.length)

/** A to-do as Home reads it, with the event it's for (null for one added on Home). */
export type LinkedTodo = { id: string; dueOn: string; doneAt: string | null; eventId?: string | null }

/** The events already In To-do: each event's to-do that isn't ticked yet. A ticked one frees the event. */
export function openEventTodos(own: readonly LinkedTodo[]): Map<string, { id: string; dueOn: string }> {
  const open = new Map<string, { id: string; dueOn: string }>()
  for (const todo of own) if (todo.eventId && !todo.doneAt) open.set(todo.eventId, { id: todo.id, dueOn: todo.dueOn })
  return open
}
