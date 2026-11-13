import { currentLanguage, useTranslation } from '@/lib/i18n'
import { bandWord } from '@/lib/band-words'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { Card } from '@/components/arc/card/card'
import { SplitButton } from '@/components/arc/split-button/split-button'
import { CategoryBar, MetadataLabel } from '@/components/trak'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS } from '@/lib/types'

export interface CoachAssessment {
  id: string
  created_at: string
  published_at: string | null
  work_rate: number; tactical: number; attitude: number; technical: number; physical: number; coachability: number
  coach_sessions?: { title: string | null; session_date: string | null } | null
}

const average = (a: CoachAssessment) =>
  (a.work_rate + a.tactical + a.attitude + a.technical + a.physical + a.coachability) / 6

/**
 * TRAK-200 (Imad, 18 Oct): one assessment as Arc's card. Top left says Draft
 * or Published; the bands; the overall band bottom left; Publish (a draft) or
 * Published bottom right, with Edit (and Unpublish) behind its chevron.
 * Tapping opens the quick look: opponent, date, the message, the private note.
 * A draft is the coach's alone, bands included (published_at NULL); Publish
 * shows the bands and the message to the family, Unpublish hides both.
 */
export function CoachAssessmentCard({ assessment, playerName, message, messageFailed = false, note, onChanged }: {
  assessment: CoachAssessment
  playerName?: string
  message?: string | null
  /** The message couldn't be read: say so, never "No message". Publishing doesn't depend on it. */
  messageFailed?: boolean
  note?: string | null
  onChanged?: (published: boolean) => void
}) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [published, setPublished] = useState(assessment.published_at != null)
  const [busy, setBusy] = useState(false)
  const band = scoreToBand(average(assessment))
  const bandName = bandWord(BANDS.find(b => b.word.toLowerCase() === band)?.word ?? band)
  const date = new Date(assessment.created_at).toLocaleDateString(currentLanguage() === 'en' ? 'en-GB' : currentLanguage(), { day: 'numeric', month: 'short' })
  const label = published ? t('coachHome:notePublished') : t('coachHome:stateDraft')

  const setPublishedTo = async (next: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      // One transaction (Tarek's review of #364): the bands and the message change together or not at
      // all, whatever this screen managed to read. Not this coach's, or gone: an error, never "done".
      const { error } = await supabase.rpc('set_assessment_published' as never,
        { p_assessment_id: assessment.id, p_published: next } as never)
      if (error) throw error
      setPublished(next)
      onChanged?.(next)
      toast.success(next ? t('coachAssess:cardPublishedToast') : t('coachAssess:cardUnpublishedToast'))
    } catch {
      toast.error(next ? t('coachAssess:cardNotPublished') : t('coachAssess:cardNotUnpublished'))
    } finally {
      setBusy(false)
    }
  }

  const edit = { label: t('coachSchedule:edit'), onSelect: () => navigate(`/coach/assess?assessment=${assessment.id}`) }
  return (
    // TRAK-229: a light Arc card like the rest; each bar carries its band's colour.
    <Card
      className="arc"
      aria-label={playerName ? t('coachAssess:cardAriaNamed', { label, name: playerName, date }) : t('coachAssess:cardAria', { label, date })}
      title={label}
      description={playerName}
      meta={bandName}
      action={<SplitButton
        label={published ? t('coachHome:notePublished') : t('coachHome:publish')}
        variant={published ? 'secondary' : 'primary'}
        disabled={busy}
        onClick={published ? undefined : () => void setPublishedTo(true)}
        actions={published ? [edit, { label: t('coachAssess:unpublish'), onSelect: () => void setPublishedTo(false) }] : [edit]}
      />}
      details={<div className="space-y-3 text-sm">
        <p className="text-foreground">{assessment.coach_sessions?.title ?? t('coachAssess:noSessionRecorded')}</p>
        <p className="text-muted-foreground">{date}</p>
        <div>
          <MetadataLabel text={t('coachAssess:messageToPlayerCaps')} />
          <p className="mt-1 text-foreground">{messageFailed ? t('coachAssess:couldntLoadMessage') : message || t('coachAssess:noMessage')}</p>
        </div>
        {note ? <div>
          <MetadataLabel text={t('coachAssess:privateNoteCaps')} />
          <p className="mt-1 italic text-muted-foreground">{note}</p>
        </div> : null}
      </div>}
    >
      <div className="space-y-2.5 mt-2">
        <CategoryBar label={t('coachAssess:sliderWorkRate')} score={assessment.work_rate} />
        <CategoryBar label={t('coachHome:attributeTechnical')} score={assessment.technical} />
        <CategoryBar label={t('coachHome:attributePhysical')} score={assessment.physical} />
        <CategoryBar label={t('coachAssess:sliderCoachability')} score={assessment.coachability} />
        <CategoryBar label={t('coachHome:attributeAttitude')} score={assessment.attitude} />
        <CategoryBar label={t('coachHome:attributeTactical')} score={assessment.tactical} />
      </div>
    </Card>
  )
}
