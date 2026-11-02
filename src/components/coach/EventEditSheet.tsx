import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ExternalLink, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCoachSquad } from '@/lib/coach-squad'
import { squadName } from '@/lib/coach-week'
import { useFeature } from '@/components/trak/parked'
import {
  COMPETITIONS, DURATIONS, EVENT_COLOR, EVENT_KINDS, FAMILY_NOTE_MAX, WEEKDAYS, blankRepeat, dateAsDay, dayAsDate, formatEventDay,
  repeatProblem, seriesDates, type EventForm, type Repeat,
} from '@/lib/coach-events'
import {
  EVENT_STEPS, KIND_LABEL, REVIEW, font, inSeries, inputClass, mono, pastProblem, playedMatch, seriesCount, stepProblem,
  type EditSheet, type Scope,
} from '@/lib/event-edit'
import { familyNoteProblem } from '@/lib/event-share'
import { isMapsUrl, joinVenue, splitVenue } from '@/lib/venue-link'
import { TRAINING_THEMES, catalogueLink, type TrainingTheme } from '@/lib/training-theme'
import { describeEventKit } from '@/lib/kit-templates'
import { withAlpha } from '@/lib/with-alpha'
import { EventKitField } from '@/components/trak/kits/EventKitField'
import { EventSummary } from '@/components/coach/EventSummary'
import { DatePicker } from '@/components/arc/date-picker/date-picker'
import { TimePicker } from '@/components/arc/time-picker/time-picker'
import { Stepper } from '@/components/arc/stepper/stepper'
import { Button } from '@/components/arc/button/button'

/* TRAK-182 (Imad's 7c): the event form one step per screen, related fields together, then Review with Publish or Save
   draft. An edit opens on What, where each step can be reopened from the stepper. TRAK-331 (Imad, 2 Nov): moved out of
   Schedule as it was, so a match page pulls up the same bottom sheet to edit its logistics in place. The page that
   opens it keeps the sheet's state and does the saving; everything typed on the way lives here. */

export function Chip({ on, color = 'rgb(var(--t-brand))', onClick, children }: { on: boolean; color?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className="px-3 py-1.5 rounded-full text-xs transition-colors"
      style={{
        background: on ? `${withAlpha(color, 0.13)}` : 'rgb(var(--t-raised))',
        color: on ? color : 'rgb(var(--t-ink-3))',
        border: `1px solid ${on ? withAlpha(color, 0.33) : 'rgb(var(--t-line))'}`,
        ...font,
      }}>
      {children}
    </button>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[9px] tracking-[0.1em] uppercase text-ink-3" style={mono}>{label}</span>
      {children}
    </label>
  )
}

/** A training's theme: the catalogue's seven libraries, and a link into it. */
function ThemeChoice({ theme, onChange }: { theme: TrainingTheme | ''; onChange: (theme: TrainingTheme) => void }) {
  const picked = TRAINING_THEMES.find(t => t.key === theme)
  return (
    <div className="space-y-2">
      <span id="training-theme" className="block text-[9px] tracking-[0.1em] uppercase text-ink-3" style={mono}>Theme</span>
      <div role="radiogroup" aria-labelledby="training-theme" className="grid grid-cols-2 gap-2">
        {TRAINING_THEMES.map(t => {
          const on = t.key === theme
          return (
            <label key={t.key} className="flex items-start gap-2 rounded-[12px] px-3 py-2 cursor-pointer transition-colors"
              style={{
                background: on ? withAlpha(EVENT_COLOR.training, 0.1) : 'rgb(var(--t-ground))',
                border: `1px solid ${on ? withAlpha(EVENT_COLOR.training, 0.33) : 'rgb(var(--t-line))'}`,
                ...font,
              }}>
              <input type="radio" name="training-theme" value={t.key} checked={on} onChange={() => onChange(t.key)}
                className="mt-[2px] w-3.5 h-3.5 shrink-0" style={{ accentColor: EVENT_COLOR.training }} />
              <span className="min-w-0">
                <span className={`block text-[13px] leading-tight text-ink ${on ? 'font-medium' : ''}`}>{t.label}</span>
                <span className="block text-[11px] text-ink-3 mt-0.5 whitespace-nowrap">{t.sessions} sessions · {t.topics} {t.topics === 1 ? 'topic' : 'topics'}</span>
              </span>
            </label>
          )
        })}
      </div>
      {/* A new tab, so the event being set up stays as it is. */}
      <a href={catalogueLink(theme)} target="_blank" rel="noopener"
        className="inline-flex items-center gap-1.5 text-[12px] text-brand" style={font}>
        {picked ? `Find ${picked.label} sessions in the Trainings Catalogue` : 'Browse all sessions in the Trainings Catalogue'}
        <ExternalLink size={12} aria-hidden />
      </a>
    </div>
  )
}

/** The meet-time list opens half an hour before the start: the usual gap. */
function halfHourBefore(time: string) {
  if (!time) return '17:00'
  const [h, m] = time.split(':').map(Number)
  const t = Math.max(0, h * 60 + m - 30)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** Arc's tokens for a picker in this form; the picker takes className="arc-trak-field" for Trak's label (TRAK-157). */
function ArcField({ children }: { children: ReactNode }) {
  return <div className="arc" style={font}>{children}</div>
}

export function ScopeChoice({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  return (
    <div className="flex gap-2 flex-wrap" role="group" aria-label="Which weeks">
      <Chip on={scope === 'one'} onClick={() => onChange('one')}>Only this week</Chip>
      <Chip on={scope === 'following'} onClick={() => onChange('following')}>This and following weeks</Chip>
    </div>
  )
}

/** New event or Edit event, as a bottom sheet. Give it a `key` per event, so what's typed never carries over. */
export function EventEditSheet({ sheet, onChange, onClose, onSave, saving, venues, childNames }: {
  sheet: EditSheet
  /** Every change the coach makes: the form, the repeat, the scope, the step, an error. */
  onChange: (update: (sheet: EditSheet) => EditSheet) => void
  onClose: () => void
  /** Review's buttons: Save changes and Save draft (), Publish (true), Save and evaluate (true, true). */
  onSave: (publishNow?: boolean, evaluate?: boolean) => void
  saving: boolean
  /** Venues saved before, offered as the coach types one (TRAK-255). */
  venues: { name: string; link: string }[]
  /** The coach's children, so a family note naming one says families won't see it (TRAK-161); null until known. */
  childNames: string[] | null
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const coachSquad = useCoachSquad(user?.id)
  const games = useFeature('games')
  // TRAK-161: tell the coach as they type when families won't see the note.
  const noteProblem = familyNoteProblem(sheet.form.familyNote, childNames)
  // TRAK-127: said as soon as a past day is picked, with the two logs.
  const datePassed = pastProblem(sheet.form, sheet.row, games)
  const played = playedMatch(sheet.form, sheet.row, games)
  const logInstead = (to: 'match' | 'training') => {
    const { date, opponent, homeAway } = sheet.form
    onClose()
    if (to === 'match') navigate('/coach/sessions/quick', { state: { fromEvent: { date, opponent: opponent.trim() || null, homeAway: homeAway || null } } })
    else navigate('/coach/sessions/add', { state: { logDate: date } })
  }

  const setForm = (patch: Partial<EventForm>) =>
    onChange(s => {
      // Until the coach turns repeat on, its weekday follows the first date.
      // A match never repeats: picking Match switches the repeat off, so a
      // hidden repeat can't save a series of identical matches.
      const repeat = patch.kind === 'match' ? { ...s.repeat, on: false }
        : patch.date && !s.repeat.on ? blankRepeat(patch.date) : s.repeat
      return { ...s, form: { ...s.form, ...patch }, repeat, error: null }
    })
  // TRAK-255: the venue is stored as before (the name, then the map link), but the form keeps them
  // in two boxes. The link box keeps what's typed until it is a Maps link; only a Maps link is saved.
  const [mapLinkText, setMapLinkText] = useState<string | null>(null)
  const venueNow = () => splitVenue(sheet.form.venue)
  const setVenueName = (typed: string) => {
    // A link pasted into the name box moves to the link box.
    const pasted = splitVenue(typed)
    if (pasted.link) { setMapLinkText(null); setForm({ venue: joinVenue(pasted.name, pasted.link) }); return }
    let link = venueNow().link
    // A saved venue brings the map link it was last used with.
    if (!link && !mapLinkText) link = venues.find(v => v.name.toLowerCase() === typed.trim().toLowerCase())?.link ?? ''
    setForm({ venue: joinVenue(typed, link) })
  }
  const setVenueLink = (typed: string) => {
    setMapLinkText(typed)
    setForm({ venue: joinVenue(venueNow().name, isMapsUrl(typed) ? typed.trim() : '') })
  }
  const setRepeat = (patch: Partial<Repeat>) => onChange(s => ({ ...s, repeat: { ...s.repeat, ...patch }, error: null }))
  const toggleDay = (day: number) =>
    onChange(s => {
      const days = s.repeat.days.includes(day) ? s.repeat.days.filter(d => d !== day) : [...s.repeat.days, day].sort()
      return { ...s, repeat: { ...s.repeat, days }, error: null }
    })
  const toStep = (step: number) => onChange(s => ({ ...s, step, error: null }))
  const nextStep = () => {
    const problem = stepProblem(sheet.step, sheet.form, sheet.repeat, sheet.row, games)
    if (problem) onChange(s => ({ ...s, error: problem }))
    else toStep(sheet.step + 1)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center"
      style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-label={sheet.row ? 'Edit event' : 'New event'}
        className="w-full max-w-sheet rounded-t-[24px] px-5 pt-5 space-y-3 overflow-y-auto"
        style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', maxHeight: '85vh', marginBottom: 64 }}>
        <div className="flex items-center justify-between">
          <span className="text-[16px] font-medium text-ink" style={font}>
            {sheet.row ? 'Edit event' : 'New event'}
          </span>
          <button onClick={() => onClose()} aria-label="Close">
            <X size={18} color="rgb(var(--t-ink-2))" />
          </button>
        </div>

        <div className="arc">
          <Stepper label="Event steps" steps={EVENT_STEPS} current={sheet.step} onStepSelect={toStep} />
        </div>

        {sheet.step === 0 && <>
          {/* An edit opens here, so a weekly series asks first which weeks change:
              "This and following" keeps each week's own date (the When step). */}
          {inSeries(sheet.row) && (
            <ScopeChoice scope={sheet.scope}
              onChange={scope => onChange(s => ({ ...s, scope, error: null }))} />
          )}
          <div className="flex gap-2 flex-wrap" role="group" aria-label="Event type">
            {EVENT_KINDS.map(t => (
              <Chip key={t} on={sheet.form.kind === t} color={EVENT_COLOR[t]} onClick={() => setForm({ kind: t })}>
                {KIND_LABEL[t]}
              </Chip>
            ))}
          </div>

          {/* Imad, 24 Oct: which squad a new event is for, never silently the last pill tapped. A saved event keeps
              its squad: moving a published one would change which families have it. */}
          {!sheet.row && coachSquad.squads.length >= 2 && (
            <div className="flex gap-2 flex-wrap" role="group" aria-label="Squad">
              {[...coachSquad.squads, null].map(squad => (
                <Chip key={squad ?? 'all'} on={(sheet.form.squad === undefined ? coachSquad.squad : sheet.form.squad) === squad} onClick={() => setForm({ squad })}>
                  {squadName(squad)}
                </Chip>
              ))}
            </div>
          )}

          {sheet.form.kind === 'training' && (
            <ThemeChoice theme={sheet.form.theme} onChange={theme => setForm({ theme })} />
          )}

          {sheet.form.kind === 'match' && (
            <>
              <Field label="Opponent">
                <input value={sheet.form.opponent} onChange={e => setForm({ opponent: e.target.value })}
                  placeholder="e.g. Al Wasl U15" className={inputClass} style={font} />
              </Field>
              <div className="flex gap-2" role="group" aria-label="Home or away">
                <Chip on={sheet.form.homeAway === 'home'} onClick={() => setForm({ homeAway: sheet.form.homeAway === 'home' ? '' : 'home' })}>Home</Chip>
                <Chip on={sheet.form.homeAway === 'away'} onClick={() => setForm({ homeAway: sheet.form.homeAway === 'away' ? '' : 'away' })}>Away</Chip>
              </div>
              {/* TRAK-288: asked here, so publishing the evaluation reads it from the match (Imad, 28 Oct). */}
              {games && <div className="flex gap-2 flex-wrap" role="group" aria-label="Competition">
                {COMPETITIONS.map(c => <Chip key={c.value} on={sheet.form.competition === c.value} onClick={() => setForm({ competition: c.value })}>{c.label}</Chip>)}
              </div>}
            </>
          )}

          <Field label={sheet.form.kind === 'other' ? 'What is it' : 'Title (optional)'}>
            <input value={sheet.form.title} onChange={e => setForm({ title: e.target.value })}
              placeholder={sheet.form.kind === 'match' ? `vs ${sheet.form.opponent || 'Opponent'}` : sheet.form.kind === 'training' ? 'Training' : 'e.g. Team photo'}
              className={inputClass} style={font} />
          </Field>

          {/* TRAK-255: a venue is a name everyone reads; its map link has a box of its own. */}
          <Field label="Venue">
            <input value={splitVenue(sheet.form.venue).name} onChange={e => setVenueName(e.target.value)}
              list="saved-venues" placeholder="Pick a saved venue or type its name" className={inputClass} style={font} />
            <datalist id="saved-venues">
              {venues.map(v => <option key={v.name} value={v.name} />)}
            </datalist>
          </Field>
          <div className="space-y-1">
            <Field label="Map link (optional)">
              <input value={mapLinkText ?? splitVenue(sheet.form.venue).link} onChange={e => setVenueLink(e.target.value)}
                inputMode="url" placeholder="Paste a Google Maps or Apple Maps link" className={inputClass} style={font} />
            </Field>
            {mapLinkText && !isMapsUrl(mapLinkText) && (
              <p className="text-[11px] text-warning" style={font}>That isn't a Google Maps or Apple Maps link, so it won't be saved.</p>
            )}
          </div>
        </>}

        {sheet.step === 1 && <>
          {/* TRAK-157: Arc's date and time pickers (founders, 12 Oct). A start
              time is picked whole from the list; there is no "no time". */}
          <ArcField>
            <DatePicker label={sheet.repeat.on ? 'First date' : 'Date'} className="arc-trak-field"
              value={dayAsDate(sheet.form.date)} onChange={date => { if (date) setForm({ date: dateAsDay(date) }) }}
              disabled={sheet.scope === 'following'} clearable={false} placeholder="Pick a date"
              format={{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }} locale="en-GB" />
          </ArcField>
          <ArcField>
            <TimePicker label={sheet.form.kind === 'match' ? 'Kickoff' : 'Start'} className="arc-trak-field"
              value={sheet.form.time} onChange={time => setForm({ time })}
              minuteStep={5} format="12h" placeholder="Pick a start time" emptyAt="17:00" />
          </ArcField>

          {sheet.scope === 'following' && (
            <p className="text-[11px] text-ink-3" style={font}>Each week keeps its own date; everything else changes.</p>
          )}

          {/* Optional: empty means meet at the start time. */}
          <ArcField>
            <TimePicker label="Meet time (if earlier)" className="arc-trak-field"
              value={sheet.form.meetTime} onChange={meetTime => setForm({ meetTime })}
              minuteStep={5} format="12h" placeholder="Same as the start" emptyAt={halfHourBefore(sheet.form.time)}
              disabled={!sheet.form.time} />
            {sheet.form.meetTime && (
              <button type="button" onClick={() => setForm({ meetTime: '' })}
                className="mt-1 text-[12px] text-ink-2" style={font}>
                No separate meet time
              </button>
            )}
          </ArcField>

          <div className="space-y-1">
            <span className="text-[9px] tracking-[0.1em] uppercase text-ink-3" style={mono}>Length</span>
            <div className="flex gap-2 flex-wrap" role="group" aria-label="Length">
              {DURATIONS.map(d => (
                <Chip key={d} on={sheet.form.duration === d} onClick={() => setForm({ duration: d })}>{d} min</Chip>
              ))}
            </div>
          </div>

          {!sheet.row && sheet.form.kind !== 'match' && (
            <div className="space-y-2">
              <Chip on={sheet.repeat.on} onClick={() => setRepeat({ on: !sheet.repeat.on })}>Repeats weekly</Chip>
              {sheet.repeat.on && (
                <>
                  <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Repeat on">
                    {WEEKDAYS.map((label, day) => (
                      <Chip key={label} on={sheet.repeat.days.includes(day)} onClick={() => toggleDay(day)}>{label}</Chip>
                    ))}
                  </div>
                  <ArcField>
                    <DatePicker label="Ends on" className="arc-trak-field"
                      value={dayAsDate(sheet.repeat.until)} onChange={date => { if (date) setRepeat({ until: dateAsDay(date) }) }}
                      clearable={false} placeholder="Pick the last date"
                      format={{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }} locale="en-GB" />
                  </ArcField>
                  {!repeatProblem(sheet.form, sheet.repeat) && (
                    <p className="text-[11px] text-ink-2" style={font}>
                      {seriesDates(sheet.form.date, sheet.repeat.until, sheet.repeat.days).length} events, last one {formatEventDay(sheet.repeat.until)}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </>}

        {/* Keep the kit editor mounted between steps so unsaved colors survive Back. */}
        <div hidden={sheet.step !== 2}>
          {user && coachSquad.ready && <EventKitField
            key={`${user.id}:${sheet.row ? sheet.row.squad ?? '' : coachSquad.squad ?? ''}`}
            coachId={user.id} squad={sheet.row ? sheet.row.squad ?? null : coachSquad.squad}
            value={sheet.form.kitSnapshot ?? null}
            onChange={kitSnapshot => setForm({ kitSnapshot, kit: kitSnapshot ? describeEventKit(kitSnapshot) : '' })} />}
        </div>
        {sheet.step === 2 && <>
          {/* TRAK-161: kit and a family note on every kind of event. */}
          {!sheet.form.kitSnapshot && <Field label="Kit">
            <input value={sheet.form.kit} onChange={e => setForm({ kit: e.target.value })}
              placeholder={sheet.form.kind === 'match' ? 'e.g. Red shirts, black shorts' : 'e.g. Green bibs, shin guards'} className={inputClass} style={font} />
          </Field>}

          <div className="space-y-1">
            <Field label="Note for families">
              <input value={sheet.form.familyNote} onChange={e => setForm({ familyNote: e.target.value })}
                maxLength={FAMILY_NOTE_MAX} aria-describedby={noteProblem ? "family-note-hint family-note-problem" : "family-note-hint"}
                placeholder="e.g. Bring extra water, it's a hot day" className={inputClass} style={font} />
            </Field>
            <p id="family-note-hint" className="text-[11px] text-ink-3" style={font}>
              Players and parents see this. A note with a player's name or a link isn't shown to them.
            </p>
            {noteProblem && (
              <p id="family-note-problem" role="status" className="text-[11px] text-warning" style={font}>
                Families won't see this note: {noteProblem === 'link' ? 'it has a link' : 'it names a player'}.
              </p>
            )}
          </div>
        </>}

        {sheet.step === REVIEW && <>
          {inSeries(sheet.row) && (
            <p className="text-[12px] text-ink-2" style={font}>
              {sheet.scope === 'following' ? 'Saves this week and the following weeks.' : 'Saves only this week.'}
            </p>
          )}
          <EventSummary form={sheet.form} repeat={sheet.row ? null : sheet.repeat} noteProblem={noteProblem}
            squad={coachSquad.squads.length >= 2 ? squadName(sheet.row ? sheet.row.squad : sheet.form.squad === undefined ? coachSquad.squad : sheet.form.squad) : undefined} />
        </>}

        {datePassed && (sheet.step === 1 || sheet.step === REVIEW) && (
          <div role="alert" className="rounded-[12px] p-3 space-y-2 border border-danger/30 bg-danger/[0.06]">
            <p className="text-[12px] text-danger" style={font}>{datePassed}</p>
            <div className="flex gap-2">
              {/* TRAK-288: where Games is on, a played match is a New event Match, evaluated on its game page. */}
              {!games && <Button size="md" variant="secondary" className="flex-1" onClick={() => logInstead('match')}>Log match</Button>}
              <Button size="md" variant="secondary" className="flex-1" onClick={() => logInstead('training')}>Log training</Button>
            </div>
          </div>
        )}

        {sheet.error && sheet.error !== datePassed && (
          <p role="alert" className="text-[12px] text-danger" style={font}>{sheet.error}</p>
        )}

        {sheet.step === REVIEW && sheet.row?.published && (
          <p className="text-[11px] text-ink-3" style={font}>Families see the change as soon as you save.</p>
        )}

        {/* The decision sits where the thumb is, as on the assessment. */}
        <div className="arc sticky bottom-0 -mx-5 px-5 pt-3 pb-5 flex gap-2 bg-raised border-t border-line">
          {sheet.step === REVIEW ? <>
            <Button size="lg" variant="secondary" aria-label={`Back to ${EVENT_STEPS[REVIEW - 1].label}`} onClick={() => toStep(REVIEW - 1)}>
              <ChevronLeft size={18} aria-hidden="true" />
            </Button>
            {sheet.row?.published ? (
              <Button size="lg" className="flex-1" loading={saving} disabled={!!datePassed} onClick={() => onSave()}>Save changes</Button>
            ) : played ? (
              <Button size="lg" className="flex-1" loading={saving} onClick={() => onSave(true, true)}>Save and evaluate</Button>
            ) : <>
              <Button size="lg" variant="secondary" className="flex-1" loading={saving} disabled={!!datePassed} onClick={() => onSave()}>
                {seriesCount(sheet) > 1 ? `Save ${seriesCount(sheet)} drafts` : 'Save draft'}
              </Button>
              <Button size="lg" className="flex-1" loading={saving} disabled={!!datePassed} onClick={() => onSave(true)}>
                {seriesCount(sheet) > 1 ? `Publish ${seriesCount(sheet)}` : 'Publish'}
              </Button>
            </>}
          </> : <>
            {sheet.step > 0 && (
              <Button size="lg" variant="secondary" className="flex-1" aria-label={`Back to ${EVENT_STEPS[sheet.step - 1].label}`}
                onClick={() => toStep(sheet.step - 1)}>Back</Button>
            )}
            <Button size="lg" className="flex-1" onClick={nextStep}>Next</Button>
          </>}
        </div>
      </div>
    </div>
  )
}
