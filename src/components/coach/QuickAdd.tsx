import { useCallback, useEffect, useState } from 'react'
import { useNavigate, type NavigateOptions } from 'react-router-dom'
import { ClipboardCheck, ClipboardPen, Plus, Swords, CalendarPlus, Dumbbell } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { localTodayISO } from '@/lib/event-time'
import { blankForm, clashMessage, dateAsDay, dayAsDate, formProblem, formToRow, newDraftFields, pastDateProblem, type EventForm, type EventRow } from '@/lib/coach-events'
import { useFeature, useParked } from '@/components/trak/parked'
import { registerProblem } from '@/lib/event-register'
import { Button } from '@/components/arc/button/button'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { DatePicker } from '@/components/arc/date-picker/date-picker'
import { TimePicker } from '@/components/arc/time-picker/time-picker'
import { ActionMorph, type MorphRow } from '@/components/arc/action-morph/action-morph'
import { useCoachSquad } from '@/lib/coach-squad'
import { useCreateSaved } from './coach-frame-context'

/* TRAK-182 part 8 (Imad, 15 Oct): the coach's "+" opens a menu, then the
   shortest form that makes a real record. Only "New event" finishes here (a
   draft families never see). A match log needs every player's facts (J4:
   nothing invented), so it continues on the log's Squad step; a training is
   logged on its own screen, or its register is taken when today has one.
   TRAK-259 (Imad, 22 Oct): merged into the glass tab bar on a phone, "+ Create"
   at a laptop's top right. TRAK-265 (Imad, 22 Oct): it works as Arc's Action
   morph, one glass shape that grows from the button into the menu (with ✕) and
   into each short form, then folds back. */
type View = 'fab' | 'menu' | 'event' | 'match'

const field = 'w-full rounded-[12px] border border-line bg-ground px-3 py-2.5 text-[16px] text-ink placeholder-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-primary'

/** Home or away as two pressed buttons: it starts unanswered, as on Schedule,
 *  so a fixture is never saved as Home because nobody chose (Tarek, #319). */
function HomeAway({ value, onChange }: { value: '' | 'home' | 'away'; onChange: (v: 'home' | 'away') => void }) {
  return (
    <div role="group" aria-label="Home or away" className="grid grid-cols-2 gap-2">
      {(['home', 'away'] as const).map(v => (
        <Button key={v} size="sm" variant={value === v ? 'primary' : 'secondary'} aria-pressed={value === v} onClick={() => onChange(v)}>
          {v === 'home' ? 'Home' : 'Away'}
        </Button>
      ))}
    </div>
  )
}

/** Keeps a form above the on-screen keyboard (8g): the visual viewport shrinks when it opens. */
function useKeyboardInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [])
  return inset
}

/** Pages keep saying `<QuickAdd onSaved={…} />`: inside the coach's frame (TRAK-259) the "+" is the frame's,
 *  and this only tells the page when it saved something. */
export function QuickAdd({ onSaved }: { onSaved?: () => void; corner?: 'top' | 'bottom'; sideMenuOnly?: boolean }) {
  useCreateSaved(onSaved)
  return null
}

/** The coach's "+". `bar`: round, in the phone's glass tab bar, growing upward. `top`: "+ Create" at a laptop's top right, growing down. */
export function CoachCreate({ placement, onSaved }: { placement: 'bar' | 'top'; onSaved?: () => void }) {
  const { user } = useAuth()
  // TRAK-176: a new event belongs to the squad picked; wait until the squads are known.
  const coachSquad = useCoachSquad(user?.id)
  const navigate = useNavigate()
  const keyboard = useKeyboardInset()
  // Events switched off for the academy (TRAK-124): New event and the register
  // say "Coming soon", as Schedule does; logging is not an events feature.
  const eventsOn = useFeature('events')
  // TRAK-288: where Games is on, a match is logged as a New event Match and evaluated on its game page (Imad, 28 Oct).
  const games = useFeature('games')
  const { comingSoon } = useParked()
  const [view, setView] = useState<View>('fab')
  const [register, setRegister] = useState<EventRow | null>(null)
  const bar = placement === 'bar'

  // New event: the fields a valid draft needs. Log match: what the log's first step needs.
  const [kind, setKind] = useState<'training' | 'match'>('training')
  const [date, setDate] = useState(localTodayISO)
  const [time, setTime] = useState('')
  const [opponent, setOpponent] = useState('')
  const [homeAway, setHomeAway] = useState<'' | 'home' | 'away'>('')
  const [scoreUs, setScoreUs] = useState('')
  const [scoreThem, setScoreThem] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Imad, 24 Oct: a new event's squad, chosen here; until then the squad last picked. null is every squad.
  const [squadPick, setSquadPick] = useState<string | null | undefined>(undefined)
  const squad = squadPick === undefined ? coachSquad.squad : squadPick

  const show = useCallback((next: string) => { setError(null); setView(next as View) }, [])
  const close = () => show('fab')

  // Today's training whose register can open now: the menu offers it first.
  useEffect(() => {
    if (view !== 'menu' || !user || !eventsOn) return
    let cancelled = false
    supabase.from('coach_calendar_events').select('*').eq('coach_user_id', user.id).eq('event_date', localTodayISO())
      .eq('published', true).then(({ data }) => {
        if (!cancelled) setRegister(((data ?? []) as EventRow[]).find(row => !registerProblem(row)) ?? null)
      })
    return () => { cancelled = true }
  }, [view, user, eventsOn])

  const datePassed = pastDateProblem(date, localTodayISO())
  const eventForm = (): EventForm => ({ ...blankForm(date), kind, time, opponent: kind === 'match' ? opponent : '', homeAway: kind === 'match' ? homeAway : '', squad })
  const saveDraft = async () => {
    if (!user || saving) return
    const draft = eventForm()
    const problem = formProblem(draft) ?? pastDateProblem(draft.date, localTodayISO())
    if (problem) { setError(problem); return }
    if (!coachSquad.ready) { setError(coachSquad.retry()); return }
    setSaving(true)
    // As Schedule's Save draft: a new event starts unpublished; families never see a draft.
    const { data, error: failed } = await supabase.from('coach_calendar_events')
      .insert([{ ...formToRow(draft), ...newDraftFields(user.id, squad) }]).select('id')
    setSaving(false)
    if (failed || !data?.length) { setError(clashMessage(failed) ?? "Couldn't save the draft. Check your connection and try again."); return }
    setTime(''); setOpponent(''); setHomeAway('')
    onSaved?.()
    close()
    toast.success('Draft saved. Publish it from Schedule.')
  }
  // Leaving closes the shape first: on Schedule itself nothing remounts, so it
  // would otherwise stay open over the sheet it hands to (Tarek, #319).
  const go = (to: string, options?: NavigateOptions) => { close(); navigate(to, options) }
  const moreDetails = () => go('/coach/schedule', { state: { quickEvent: eventForm() } })
  const logMatch = () => games ? go('/coach/schedule', { state: { quickEvent: { ...eventForm(), kind: 'match' } } }) : show('match')
  const continueMatch = () => {
    if (!opponent.trim() || scoreUs === '' || scoreThem === '') { setError('Add the opponent and the score.'); return }
    if (!homeAway) { setError('Say whether it was home or away.'); return }
    if (date > localTodayISO()) { setError("A match can't be logged before it's played."); return }
    go('/coach/sessions/add', { state: { quickMatch: { opponent: opponent.trim(), venue: homeAway === 'home' ? 'Home' : 'Away', scoreUs, scoreThem, date } } })
  }

  const choose = (id: string) => {
    setError(null)
    if (id === 'register' && register) go(`/coach/schedule?register=${register.id}`)
    else if (id === 'training') go('/coach/sessions/add')
    else if (id === 'assess') go('/coach/assess')
    else if (id === 'match') logMatch()
    else if (id === 'event') { if (eventsOn) show('event'); else { close(); comingSoon() } }
  }
  const rows: MorphRow[] = [
    ...(register ? [{ id: 'register', label: `Take register · ${register.title}`, icon: <ClipboardCheck /> }] : []),
    { id: 'training', label: 'Log training', icon: <Dumbbell /> },
    { id: 'match', label: 'Log match', icon: <Swords /> },
    // Imad, 16 Oct (Kostas's item 9): assessing is one of the coach's quick actions.
    { id: 'assess', label: 'Assess player', icon: <ClipboardPen /> },
    { id: 'event', label: 'New event', icon: <CalendarPlus /> },
  ]

  // In the tab bar the pickers open upward: opening down ran off the screen (Imad, 16 Oct).
  const pickers = `space-y-3 ${bar ? `[&_[role=listbox]]:top-auto [&_[role=listbox]]:bottom-[calc(100%+6px)] [&_[role=listbox]]:origin-bottom
    [&_[aria-label$=calendar]]:top-auto [&_[aria-label$=calendar]]:bottom-[calc(100%+8px)] [&_[aria-label$=calendar]]:origin-bottom-left` : ''}
    [&_[aria-label$=calendar]]:bg-raised [&_[role=listbox]]:bg-raised`

  const eventFace = <div className={pickers}>
    <SegmentedControl label="Event type" value={kind} onValueChange={v => { setKind(v as 'training' | 'match'); setError(null) }}
      options={[{ value: 'training', label: 'Training' }, { value: 'match', label: 'Match' }]} />
    {/* Its own row, labelled like Date and Start, so it never reads as part of Training / Match. */}
    {coachSquad.squads.length >= 2 && <div className="arc-trak-field grid gap-1.5">
      <span aria-hidden="true">Squad</span>
      <SegmentedControl label="Squad" value={squad ?? ''} onValueChange={v => setSquadPick(v || null)}
        options={[...coachSquad.squads.map(s => ({ value: s, label: s })), { value: '', label: 'All squads' }]} />
    </div>}
    {kind === 'match' && <>
      <input aria-label="Opponent" value={opponent} onChange={e => { setOpponent(e.target.value); setError(null) }}
        placeholder="Opponent" className={field} />
      <HomeAway value={homeAway} onChange={v => { setHomeAway(v); setError(null) }} />
    </>}
    {/* One per row: each picker's panel opens across the form's full width. */}
    <DatePicker label="Date" className="arc-trak-field" value={dayAsDate(date)} clearable={false}
      onChange={d => { if (d) { setDate(dateAsDay(d)); setError(null) } }} placeholder="Pick a date"
      format={{ weekday: 'short', day: 'numeric', month: 'short' }} locale="en-GB" />
    <TimePicker label={kind === 'match' ? 'Kickoff' : 'Start'} className="arc-trak-field" value={time}
      onChange={t => { setTime(t); setError(null) }} minuteStep={5} format="12h" placeholder="Pick a time" emptyAt="17:00" />
    {/* TRAK-127: New event is for what's coming; a past day offers the logs. */}
    {datePassed ? (
      <div role="alert" className="space-y-2">
        <p className="text-[12px] text-danger">{datePassed}</p>
        <div className="flex gap-2">
          <Button size="md" variant="secondary" className="flex-1" onClick={logMatch}>Log match</Button>
          <Button size="md" variant="secondary" className="flex-1" onClick={() => go('/coach/sessions/add', { state: { logDate: date } })}>Log training</Button>
        </div>
      </div>
    ) : error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    <div className="flex gap-2">
      <Button size="md" variant="ghost" className="flex-1" onClick={moreDetails}>More details</Button>
      <Button size="md" className="flex-1" loading={saving} disabled={!!datePassed} onClick={() => void saveDraft()}>Save draft</Button>
    </div>
  </div>

  const matchFace = <div className={pickers}>
    <input aria-label="Opponent" value={opponent} onChange={e => { setOpponent(e.target.value); setError(null) }}
      placeholder="Opponent" className={field} />
    <HomeAway value={homeAway} onChange={v => { setHomeAway(v); setError(null) }} />
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <input aria-label="Our score" inputMode="numeric" value={scoreUs} placeholder="Us"
        onChange={e => { setScoreUs(e.target.value.replace(/\D/g, '').slice(0, 2)); setError(null) }} className={`${field} text-center`} />
      <span aria-hidden="true" className="text-ink-3">–</span>
      <input aria-label="Their score" inputMode="numeric" value={scoreThem} placeholder="Them"
        onChange={e => { setScoreThem(e.target.value.replace(/\D/g, '').slice(0, 2)); setError(null) }} className={`${field} text-center`} />
    </div>
    <DatePicker label="Date" className="arc-trak-field" value={dayAsDate(date)} clearable={false}
      onChange={d => { if (d) { setDate(dateAsDay(d)); setError(null) } }} placeholder="Pick a date"
      format={{ weekday: 'short', day: 'numeric', month: 'short' }} locale="en-GB" />
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    <p className="text-[12px] text-ink-3">Next: who played, their goals and assists.</p>
    <Button size="md" className="w-full" onClick={continueMatch}>Continue</Button>
  </div>

  return <ActionMorph label={bar ? 'Quick add' : 'Create'} anchor={bar ? 'bottom' : 'top'} lift={bar ? keyboard : 0}
    // At the top the root needs a size of its own: in the bar the slot gives it one.
    className={bar ? undefined : 'arc'} style={bar ? undefined : { width: 104, height: 40 }} rows={rows} view={view} onViewChange={show} onSelect={choose}
    faces={[{ id: 'event', title: 'New event', content: eventFace }, { id: 'match', title: 'Log a match', content: matchFace }]}
    trigger={bar
      ? <Plus size={22} strokeWidth={2.2} aria-hidden="true" className="text-brand" />
      : <><Plus size={16} strokeWidth={2.2} aria-hidden="true" className="text-brand" />Create</>} />
}
