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
  COMPETITION_WORD, EVENT_STEPS, KIND_WORD, REVIEW, STEP_WORD, THEME_WORD, WEEKDAY_WORD, font, inSeries, inputClass, mono, pastProblem, playedMatch, playedTraining, seriesCount, stepProblem,
  type EditSheet, type Scope,
} from '@/lib/event-edit'
import { familyNoteProblem } from '@/lib/event-share'
import { isMapsUrl, joinVenue, splitVenue } from '@/lib/venue-link'
import { TRAINING_THEMES, catalogueLink, drillsLink, type TrainingTheme } from '@/lib/training-theme'
import { describeEventKit } from '@/lib/kit-templates'
import { withAlpha } from '@/lib/with-alpha'
import { EventKitField } from '@/components/trak/kits/EventKitField'
import { EventSummary } from '@/components/coach/EventSummary'
import { DatePicker } from '@/components/arc/date-picker/date-picker'
import { TimePicker } from '@/components/arc/time-picker/time-picker'
import { Stepper } from '@/components/arc/stepper/stepper'
import { Button } from '@/components/arc/button/button'
import { currentLanguage, useLanguage, useTranslation } from '@/lib/i18n'

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
  const { t } = useTranslation()
  const picked = TRAINING_THEMES.find(option => option.key === theme)
  // TRAK-419: where Training is on, the link opens Training › Drills, and the old catalogue's counts go (they are not
  // Drills' counts). Where it is off, the old Library, as before.
  const drills = useFeature('training')
  const themeName = picked ? t(THEME_WORD[picked.key]) : ''
  return (
    <div className="space-y-2">
      <span id="training-theme" className="block text-[9px] tracking-[0.1em] uppercase text-ink-3" style={mono}>{t('coachSchedule:theme')}</span>
      <div role="radiogroup" aria-labelledby="training-theme" className="grid grid-cols-2 gap-2">
        {TRAINING_THEMES.map(option => {
          const on = option.key === theme
          return (
            <label key={option.key} className="flex items-start gap-2 rounded-[12px] px-3 py-2 cursor-pointer transition-colors"
              style={{
                background: on ? withAlpha(EVENT_COLOR.training, 0.1) : 'rgb(var(--t-ground))',
                border: `1px solid ${on ? withAlpha(EVENT_COLOR.training, 0.33) : 'rgb(var(--t-line))'}`,
                ...font,
              }}>
              <input type="radio" name="training-theme" value={option.key} checked={on} onChange={() => onChange(option.key)}
                className="mt-[2px] w-3.5 h-3.5 shrink-0" style={{ accentColor: EVENT_COLOR.training }} />
              <span className="min-w-0">
                <span className={`block text-[13px] leading-tight text-ink ${on ? 'font-medium' : ''}`}>{t(THEME_WORD[option.key])}</span>
                {!drills && <span className="block text-[11px] text-ink-3 mt-0.5 whitespace-nowrap">{t('coachSchedule:themeCount', { sessions: option.sessions, count: option.topics })}</span>}
              </span>
            </label>
          )
        })}
      </div>
      {/* A new tab, so the event being set up stays as it is. */}
      <a href={drills ? drillsLink(theme) : catalogueLink(theme)} target="_blank" rel="noopener"
        className="inline-flex items-center gap-1.5 text-[12px] text-brand" style={font}>
        {drills
          ? picked ? t('coachSchedule:findThemeDrills', { theme: themeName }) : t('coachSchedule:browseAllDrills')
          : picked ? t('coachSchedule:findThemeSessions', { theme: themeName }) : t('coachSchedule:browseAllSessions')}
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
  const { t } = useTranslation()
  return (
    <div className="flex gap-2 flex-wrap" role="group" aria-label={t('coachSchedule:whichWeeks')}>
      <Chip on={scope === 'one'} onClick={() => onChange('one')}>{t('coachSchedule:onlyThisWeek')}</Chip>
      <Chip on={scope === 'following'} onClick={() => onChange('following')}>{t('coachSchedule:thisAndFollowing')}</Chip>
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
  // TRAK-407: the form's words and its pickers' day names, in the language showing.
  const { t } = useLanguage()
  const pickerLocale = currentLanguage() === 'en' ? 'en-GB' : currentLanguage()
  const steps = EVENT_STEPS.map(step => ({ ...step, label: t(STEP_WORD[step.id as keyof typeof STEP_WORD]) }))
  const coachSquad = useCoachSquad(user?.id)
  const games = useFeature('games')
  // TRAK-161: tell the coach as they type when families won't see the note.
  const noteProblem = familyNoteProblem(sheet.form.familyNote, childNames)
  // TRAK-127: said as soon as a past day is picked, with the two logs.
  // TRAK-426: where Training is on, a training already held is saved and opened on its register (Who's here).
  const training = useFeature('training')
  const datePassed = pastProblem(sheet.form, sheet.row, games, training)
  const played = playedMatch(sheet.form, sheet.row, games)
  const heldTraining = playedTraining(sheet.form, sheet.row, training)
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
    const problem = stepProblem(sheet.step, sheet.form, sheet.repeat, sheet.row, games, training)
    if (problem) onChange(s => ({ ...s, error: problem }))
    else toStep(sheet.step + 1)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center"
      style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-label={sheet.row ? t('coachSchedule:editEvent') : t('coachSchedule:newEvent')}
        className="w-full max-w-sheet rounded-t-[24px] px-5 pt-5 space-y-3 overflow-y-auto"
        style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', maxHeight: '85vh', marginBottom: 64 }}>
        <div className="flex items-center justify-between">
          <span className="text-[16px] font-medium text-ink" style={font}>
            {sheet.row ? t('coachSchedule:editEvent') : t('coachSchedule:newEvent')}
          </span>
          <button onClick={() => onClose()} aria-label={t('coachSchedule:close')}>
            <X size={18} color="rgb(var(--t-ink-2))" />
          </button>
        </div>

        <div className="arc">
          <Stepper label={t('coachSchedule:eventSteps')} steps={steps} current={sheet.step} onStepSelect={toStep} />
        </div>

        {sheet.step === 0 && <>
          {/* An edit opens here, so a weekly series asks first which weeks change:
              "This and following" keeps each week's own date (the When step). */}
          {inSeries(sheet.row) && (
            <ScopeChoice scope={sheet.scope}
              onChange={scope => onChange(s => ({ ...s, scope, error: null }))} />
          )}
          <div className="flex gap-2 flex-wrap" role="group" aria-label={t('coachSchedule:eventType')}>
            {EVENT_KINDS.map(kind => (
              <Chip key={kind} on={sheet.form.kind === kind} color={EVENT_COLOR[kind]} onClick={() => setForm({ kind })}>
                {t(KIND_WORD[kind])}
              </Chip>
            ))}
          </div>

          {/* Imad, 24 Oct: which squad a new event is for, never silently the last pill tapped. A saved event keeps
              its squad: moving a published one would change which families have it. */}
          {!sheet.row && coachSquad.squads.length >= 2 && (
            <div className="flex gap-2 flex-wrap" role="group" aria-label={t('nav:squad')}>
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
              <Field label={t('coachSchedule:opponent')}>
                <input value={sheet.form.opponent} onChange={e => setForm({ opponent: e.target.value })}
                  placeholder={t('coachSchedule:opponentExample')} className={inputClass} style={font} />
              </Field>
              <div className="flex gap-2" role="group" aria-label={t('coachSchedule:homeOrAway')}>
                <Chip on={sheet.form.homeAway === 'home'} onClick={() => setForm({ homeAway: sheet.form.homeAway === 'home' ? '' : 'home' })}>{t('coachSchedule:home')}</Chip>
                <Chip on={sheet.form.homeAway === 'away'} onClick={() => setForm({ homeAway: sheet.form.homeAway === 'away' ? '' : 'away' })}>{t('coachSchedule:away')}</Chip>
              </div>
              {/* TRAK-288: asked here, so publishing the evaluation reads it from the match (Imad, 28 Oct). */}
              {games && <div className="flex gap-2 flex-wrap" role="group" aria-label={t('coachSchedule:competition')}>
                {COMPETITIONS.map(c => <Chip key={c.value} on={sheet.form.competition === c.value} onClick={() => setForm({ competition: c.value })}>{c.value in COMPETITION_WORD ? t(COMPETITION_WORD[c.value as keyof typeof COMPETITION_WORD]) : c.label}</Chip>)}
              </div>}
            </>
          )}

          <Field label={sheet.form.kind === 'other' ? t('coachSchedule:whatIsIt') : t('coachSchedule:titleOptional')}>
            <input value={sheet.form.title} onChange={e => setForm({ title: e.target.value })}
              placeholder={sheet.form.kind === 'match' ? t('coachSchedule:vsOpponent', { opponent: sheet.form.opponent || t('coachSchedule:opponent') }) : sheet.form.kind === 'training' ? t('coachSchedule:kindTraining') : t('coachSchedule:titleExampleOther')}
              className={inputClass} style={font} />
          </Field>

          {/* TRAK-255: a venue is a name everyone reads; its map link has a box of its own. */}
          <Field label={t('coachSchedule:venue')}>
            <input value={splitVenue(sheet.form.venue).name} onChange={e => setVenueName(e.target.value)}
              list="saved-venues" placeholder={t('coachSchedule:venuePlaceholder')} className={inputClass} style={font} />
            <datalist id="saved-venues">
              {venues.map(v => <option key={v.name} value={v.name} />)}
            </datalist>
          </Field>
          <div className="space-y-1">
            <Field label={t('coachSchedule:mapLinkOptional')}>
              <input value={mapLinkText ?? splitVenue(sheet.form.venue).link} onChange={e => setVenueLink(e.target.value)}
                inputMode="url" placeholder={t('coachSchedule:mapLinkPlaceholder')} className={inputClass} style={font} />
            </Field>
            {mapLinkText && !isMapsUrl(mapLinkText) && (
              <p className="text-[11px] text-warning" style={font}>{t('coachSchedule:notMapLink')}</p>
            )}
          </div>
        </>}

        {sheet.step === 1 && <>
          {/* TRAK-157: Arc's date and time pickers (founders, 12 Oct). A start
              time is picked whole from the list; there is no "no time". */}
          <ArcField>
            <DatePicker label={sheet.repeat.on ? t('coachSchedule:firstDate') : t('coachSchedule:date')} className="arc-trak-field"
              value={dayAsDate(sheet.form.date)} onChange={date => { if (date) setForm({ date: dateAsDay(date) }) }}
              disabled={sheet.scope === 'following'} clearable={false} placeholder={t('coachSchedule:pickDate')}
              format={{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }} locale={pickerLocale} />
          </ArcField>
          <ArcField>
            <TimePicker label={sheet.form.kind === 'match' ? t('coachSchedule:kickoff') : t('coachSchedule:start')} className="arc-trak-field"
              value={sheet.form.time} onChange={time => setForm({ time })}
              minuteStep={5} format="12h" placeholder={t('coachSchedule:pickStartTime')} emptyAt="17:00" />
          </ArcField>

          {sheet.scope === 'following' && (
            <p className="text-[11px] text-ink-3" style={font}>{t('coachSchedule:eachWeekKeepsDate')}</p>
          )}

          {/* Optional: empty means meet at the start time. */}
          <ArcField>
            <TimePicker label={t('coachSchedule:meetTimeEarlier')} className="arc-trak-field"
              value={sheet.form.meetTime} onChange={meetTime => setForm({ meetTime })}
              minuteStep={5} format="12h" placeholder={t('coachSchedule:sameAsStart')} emptyAt={halfHourBefore(sheet.form.time)}
              disabled={!sheet.form.time} />
            {sheet.form.meetTime && (
              <button type="button" onClick={() => setForm({ meetTime: '' })}
                className="mt-1 text-[12px] text-ink-2" style={font}>
                {t('coachSchedule:noSeparateMeet')}
              </button>
            )}
          </ArcField>

          <div className="space-y-1">
            <span className="text-[9px] tracking-[0.1em] uppercase text-ink-3" style={mono}>{t('coachSchedule:length')}</span>
            <div className="flex gap-2 flex-wrap" role="group" aria-label={t('coachSchedule:length')}>
              {DURATIONS.map(d => (
                <Chip key={d} on={sheet.form.duration === d} onClick={() => setForm({ duration: d })}>{t('coachSchedule:lengthMinutes', { count: d })}</Chip>
              ))}
            </div>
          </div>

          {!sheet.row && sheet.form.kind !== 'match' && !heldTraining && (
            <div className="space-y-2">
              <Chip on={sheet.repeat.on} onClick={() => setRepeat({ on: !sheet.repeat.on })}>{t('coachSchedule:repeatsWeekly')}</Chip>
              {sheet.repeat.on && (
                <>
                  <div className="flex gap-1.5 flex-wrap" role="group" aria-label={t('coachSchedule:repeatOn')}>
                    {WEEKDAYS.map((label, day) => (
                      <Chip key={label} on={sheet.repeat.days.includes(day)} onClick={() => toggleDay(day)}>{t(WEEKDAY_WORD[day])}</Chip>
                    ))}
                  </div>
                  <ArcField>
                    <DatePicker label={t('coachSchedule:endsOn')} className="arc-trak-field"
                      value={dayAsDate(sheet.repeat.until)} onChange={date => { if (date) setRepeat({ until: dateAsDay(date) }) }}
                      clearable={false} placeholder={t('coachSchedule:pickLastDate')}
                      format={{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }} locale={pickerLocale} />
                  </ArcField>
                  {!repeatProblem(sheet.form, sheet.repeat) && (
                    <p className="text-[11px] text-ink-2" style={font}>
                      {t('coachSchedule:seriesCountLine', { count: seriesDates(sheet.form.date, sheet.repeat.until, sheet.repeat.days).length, day: formatEventDay(sheet.repeat.until) })}
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
          {!sheet.form.kitSnapshot && <Field label={t('coachSchedule:kit')}>
            <input value={sheet.form.kit} onChange={e => setForm({ kit: e.target.value })}
              placeholder={sheet.form.kind === 'match' ? t('coachSchedule:kitExampleMatch') : t('coachSchedule:kitExampleTraining')} className={inputClass} style={font} />
          </Field>}

          <div className="space-y-1">
            <Field label={t('coachSchedule:messageToPlayers')}>
              <input value={sheet.form.familyNote} onChange={e => setForm({ familyNote: e.target.value })}
                maxLength={FAMILY_NOTE_MAX} aria-describedby={noteProblem ? "family-note-hint family-note-problem" : "family-note-hint"}
                placeholder={t('coachSchedule:messageExample')} className={inputClass} style={font} />
            </Field>
            <p id="family-note-hint" className="text-[11px] text-ink-3" style={font}>
              {t('coachSchedule:messageHint')}
            </p>
            {noteProblem && (
              <p id="family-note-problem" role="status" className="text-[11px] text-warning" style={font}>
                {noteProblem === 'link' ? t('coachSchedule:messageHiddenLink') : t('coachSchedule:messageHiddenName')}
              </p>
            )}
          </div>
        </>}

        {sheet.step === REVIEW && <>
          {inSeries(sheet.row) && (
            <p className="text-[12px] text-ink-2" style={font}>
              {sheet.scope === 'following' ? t('coachSchedule:savesFollowing') : t('coachSchedule:savesOnlyThis')}
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
              {!games && <Button size="md" variant="secondary" className="flex-1" onClick={() => logInstead('match')}>{t('coachSchedule:logMatch')}</Button>}
              {/* TRAK-426: where Training is on, a held training is a New event Training, registered on its own page. */}
              {!training && <Button size="md" variant="secondary" className="flex-1" onClick={() => logInstead('training')}>{t('coachSchedule:logTraining')}</Button>}
            </div>
          </div>
        )}

        {sheet.error && sheet.error !== datePassed && (
          <p role="alert" className="text-[12px] text-danger" style={font}>{sheet.error}</p>
        )}

        {sheet.step === REVIEW && sheet.row?.published && (
          <p className="text-[11px] text-ink-3" style={font}>{t('coachSchedule:familiesSeeOnSave')}</p>
        )}

        {/* The decision sits where the thumb is, as on the assessment. */}
        <div className="arc sticky bottom-0 -mx-5 px-5 pt-3 pb-5 flex gap-2 bg-raised border-t border-line">
          {sheet.step === REVIEW ? <>
            <Button size="lg" variant="secondary" aria-label={t('coachSchedule:backTo', { step: steps[REVIEW - 1].label })} onClick={() => toStep(REVIEW - 1)}>
              <ChevronLeft size={18} aria-hidden="true" />
            </Button>
            {sheet.row?.published ? (
              <Button size="lg" className="flex-1" loading={saving} disabled={!!datePassed} onClick={() => onSave()}>{t('coachSchedule:saveChanges')}</Button>
            ) : played ? (
              <Button size="lg" className="flex-1" loading={saving} onClick={() => onSave(true, true)}>{t('coachSchedule:saveAndEvaluate')}</Button>
            ) : heldTraining ? (
              <Button size="lg" className="flex-1" loading={saving} onClick={() => onSave(true, true)}>{t('coachSchedule:saveAndTakeRegister')}</Button>
            ) : <>
              <Button size="lg" variant="secondary" className="flex-1" loading={saving} disabled={!!datePassed} onClick={() => onSave()}>
                {seriesCount(sheet) > 1 ? t('coachSchedule:saveDrafts', { count: seriesCount(sheet) }) : t('coachSchedule:saveDraft')}
              </Button>
              <Button size="lg" className="flex-1" loading={saving} disabled={!!datePassed} onClick={() => onSave(true)}>
                {seriesCount(sheet) > 1 ? t('coachSchedule:publishCount', { count: seriesCount(sheet) }) : t('coachHome:publish')}
              </Button>
            </>}
          </> : <>
            {sheet.step > 0 && (
              <Button size="lg" variant="secondary" className="flex-1" aria-label={t('coachSchedule:backTo', { step: steps[sheet.step - 1].label })}
                onClick={() => toStep(sheet.step - 1)}>{t('common:back')}</Button>
            )}
            <Button size="lg" className="flex-1" onClick={nextStep}>{t('coachSchedule:next')}</Button>
          </>}
        </div>
      </div>
    </div>
  )
}
