import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { Database } from '@/integrations/supabase/types'
import { NavBar, WIDE_COLUMN } from '@/components/trak'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { useFeature } from '@/components/trak/parked'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { PageTop } from '@/components/coach/PageTop'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { DatePicker } from '@/components/arc/date-picker/date-picker'
import { useCoachSquad } from '@/lib/coach-squad'
import { localTodayISO } from '@/lib/event-time'
import { dateAsDay, dayAsDate } from '@/lib/coach-events'
import { currentLanguage, useTranslation } from '@/lib/i18n'

/* TRAK-602 (coach–player P16, Makis's PR list of 23 Nov): the coach posts a short announcement to one of their squads,
   from "+" (behind the academy's announcements switch, App.tsx). A link is optional and https:// only; Got it is asked
   by a day, as Send a task does (Tarek, 27 Nov), and only where the tasks switch is on too. Each one posted stays listed
   here; Withdraw hides it from players and keeps it for the coach. The database checks all of it again
   (post_announcement); players read it in their bell from P17. Nothing counts who read or answered. */

type Posted = Database['public']['Functions']['coach_announcements']['Returns'][number]

const MAX = 500
const field = 'w-full rounded-xl border border-line bg-ground px-3 py-2.5 text-[16px] text-ink placeholder-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-primary'
const locale = () => (currentLanguage() === 'en' ? 'en-GB' : currentLanguage())
const shortDay = (date: Date) => date.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })

export default function CoachAnnouncements() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const coachSquad = useCoachSquad(user?.id)
  const posted = useQuery({
    queryKey: ['coach-announcements', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Posted[]> => {
      const { data, error } = await supabase.rpc('coach_announcements')
      if (error) throw error
      return data ?? []
    },
  })
  const title = t('coachTasks:announcements')

  let list
  if (posted.isError) list = <LoadError what={t('coachTasks:yourAnnouncements')} onRetry={() => void posted.refetch()} retrying={posted.isFetching} />
  else if (!posted.data) list = <LoadingSkeleton label={t('coachTasks:loading')} lines={2} rows={2} />
  else if (!posted.data.length) list = <p className="text-sm text-ink-2">{t('coachTasks:nonePosted')}</p>
  else list = posted.data.map(item => <PostedCard key={item.id} item={item} showSquad={coachSquad.squads.length >= 2} onWithdrawn={() => void posted.refetch()} />)

  return (
    <div className="min-h-screen bg-ground pb-24">
      <div className={WIDE_COLUMN}>
        <PageTop title={title} trail={<CoachTrail current={title} />} />
        <div className="grid gap-6">
          <PostForm squads={coachSquad.squads} picked={coachSquad.squad} known={coachSquad.ready} onPosted={() => void posted.refetch()} />
          <section aria-labelledby="posted-announcements" className="grid gap-3">
            <h2 id="posted-announcements" className="text-lg font-medium text-ink">{t('coachTasks:posted')}</h2>
            {list}
          </section>
        </div>
      </div>
      <NavBar role="coach" activeTab={location.pathname} onNavigate={navigate} />
    </div>
  )
}

function PostForm({ squads, picked, known, onPosted }: { squads: string[]; picked: string | null; known: boolean; onPosted: () => void }) {
  const { t } = useTranslation()
  const tasksOn = useFeature('tasks')
  const [squadPick, setSquadPick] = useState<string>()
  const squad = squadPick ?? picked ?? squads[0] ?? ''
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [gotIt, setGotIt] = useState(false)
  const [day, setDay] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  // Characters as the database counts them (an emoji is one), of what it keeps (trimmed).
  const length = [...body.trim()].length
  const tooLong = length > MAX
  const change = <T,>(set: (value: T) => void) => (value: T) => { set(value); setError(null) }

  const post = async () => {
    if (!length) { setError(t('coachTasks:needMessage')); return }
    if (link.trim() && !/^https:\/\/\S+$/.test(link.trim())) { setError(t('coachTasks:linkHttps')); return }
    if (gotIt && !day) { setError(t('coachTasks:needAnswerBy')); return }
    setPosting(true)
    const { error: failed } = await supabase.rpc('post_announcement', {
      p_squad: squad, p_body: body.trim(), p_link: link.trim() || undefined, p_got_it_by: gotIt ? day : undefined,
    })
    setPosting(false)
    if (failed) { setError(t('coachTasks:couldntPost')); return }
    toast.success(t('coachTasks:postedTo', { squad }))
    setBody(''); setLink(''); setGotIt(false); setDay('')
    onPosted()
  }

  return (
    <section aria-labelledby="new-announcement" className="grid gap-4 rounded-2xl border border-line bg-surface p-5 laptop:p-6">
      <h2 id="new-announcement" className="text-lg font-medium text-ink">{t('coachTasks:newAnnouncement')}</h2>
      {squads.length >= 2 && <div className="arc-trak-field grid gap-1.5">
        <span aria-hidden="true">{t('nav:squad')}</span>
        <SegmentedControl label={t('nav:squad')} value={squad} onValueChange={change(setSquadPick)} options={squads.map(s => ({ value: s, label: s }))} />
      </div>}
      <div className="grid gap-1.5">
        <label className="arc-trak-field grid gap-1.5">
          <span>{t('coachTasks:message')}</span>
          <textarea value={body} rows={4} aria-describedby="announcement-count" onChange={e => change(setBody)(e.target.value)}
            placeholder={t('coachTasks:messageExample')} className={field} />
        </label>
        <p id="announcement-count" className={`text-[12px] ${tooLong ? 'text-danger' : 'text-ink-3'}`}>
          {t('coachTasks:characters', { n: length })}{tooLong && ` · ${t('coachTasks:tooLong')}`}
        </p>
      </div>
      <label className="arc-trak-field grid gap-1.5">
        <span>{t('coachTasks:link')}</span>
        <input type="url" inputMode="url" value={link} onChange={e => change(setLink)(e.target.value)} placeholder="https://" className={field} />
      </label>
      {tasksOn && <Checkbox label={t('coachTasks:askGotIt')} checked={gotIt} onCheckedChange={v => change(setGotIt)(v === true)} />}
      {tasksOn && gotIt && <DatePicker label={t('coachTasks:answerBy')} className="arc-trak-field" value={(day && dayAsDate(day)) || undefined}
        minDate={dayAsDate(localTodayISO())} onChange={d => change(setDay)(d ? dateAsDay(d) : '')} placeholder={t('coachSchedule:pickDate')}
        format={{ weekday: 'short', day: 'numeric', month: 'short' }} locale={locale()} />}
      {known && !squads.length && <p className="text-sm text-ink-2">{t('coachTasks:noSquad')}</p>}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <Button size="md" className="w-full laptop:w-auto laptop:justify-self-start" loading={posting} disabled={tooLong || !squad}
        onClick={() => void post()}>{t('coachTasks:post')}</Button>
    </section>
  )
}

function PostedCard({ item, showSquad, onWithdrawn }: { item: Posted; showSquad: boolean; onWithdrawn: () => void }) {
  const { t } = useTranslation()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const about = item.body.length > 40 ? `${item.body.slice(0, 40)}…` : item.body

  const withdraw = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('withdraw_announcement', { p_id: item.id })
    setBusy(false)
    if (error) { toast(t('coachTasks:couldntWithdraw')); return }
    setAsking(false)
    onWithdrawn()
  }

  const facts = [showSquad && item.squad, shortDay(new Date(item.published_at)),
    item.got_it_by && t('coachTasks:gotItBy', { day: shortDay(dayAsDate(item.got_it_by)!) }), item.withdrawn_at && t('coachTasks:withdrawn')]
  return (
    <article className="grid gap-3 rounded-2xl border border-line bg-surface p-5 laptop:p-6">
      <p className="text-sm text-ink-3">{facts.filter(Boolean).join(' · ')}</p>
      <p className="whitespace-pre-wrap break-words text-base text-ink">{item.body}</p>
      {item.link && <a href={item.link} target="_blank" rel="noopener noreferrer" className="w-fit text-sm font-medium text-brand underline">{t('coachTasks:openLink')}</a>}
      {!item.withdrawn_at && (asking
        ? <div className="grid gap-2">
            <p className="text-sm text-ink-2">{t('coachTasks:withdrawAsk')}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="danger" loading={busy} aria-label={`${t('coachTasks:withdraw')}: ${about}`} onClick={() => void withdraw()}>{t('coachTasks:withdraw')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>{t('coachTasks:keep')}</Button>
            </div>
          </div>
        : <span><Button size="sm" variant="secondary" aria-label={`${t('coachTasks:withdraw')}: ${about}`} onClick={() => setAsking(true)}>{t('coachTasks:withdraw')}</Button></span>)}
    </article>
  )
}
