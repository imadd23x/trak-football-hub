import { useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { useParentMatchDetail } from '@/hooks/useParentData'
import { formatParentAward, formatParentDate, matchResult, type ParentAssessment, type ParentAward, type ParentMatch } from '@/lib/parent-data'
import { ParentLoadError, ParentLoading, ParentRating } from './ParentFamily'

interface RecordDialogProps {
  label: string
  title: string
  description: string
  className?: string
  children: ReactNode
  details: ReactNode
}

function RecordDialog({ label, title, description, className, children, details }: RecordDialogProps) {
  const [open, setOpen] = useState(false)
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <button type="button" aria-label={label}
        className={`w-full text-left min-h-11 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:bg-muted/40 ${className ?? ''}`}>
        {children}
      </button>
    </DialogTrigger>
    {open && <DialogContent className="w-[calc(100%-2rem)] max-w-sm max-h-[85dvh] overflow-y-auto rounded-xl">
      <DialogHeader className="pr-5 text-left">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {details}
    </DialogContent>}
  </Dialog>
}

// Identity changes destroy the open dialog before the next account/child renders,
// including A -> B -> A. Never retain a selected record across family changes.
function FamilyRecordDialog(props: RecordDialogProps) {
  const { parentId, selectedChild } = useParentChildren()
  return <RecordDialog key={`${parentId}:${selectedChild?.id}`} {...props} />
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-start justify-between gap-4 py-2 text-sm" aria-label={label}>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-right text-foreground break-words min-w-0">{value ?? 'Not recorded'}</dd>
  </div>
}

function MatchFacts({ matchId }: { matchId: string }) {
  const query = useParentMatchDetail(matchId)
  if (query.isError) return <ParentLoadError message="Couldn't load match details. The record may no longer be available." onRetry={() => { void query.refetch() }} />
  if (query.isPending || !query.data) return <ParentLoading />
  const match = query.data
  return <>
    <div className="flex items-center justify-between gap-3">
      <p className="text-xl text-foreground">{matchResult(match) ? `${match.team_score}–${match.opponent_score}` : 'Score not recorded'}</p>
      <ParentRating rating={match.computed_rating} />
    </div>
    <dl className="divide-y divide-border">
      <Fact label="Opponent" value={match.opponent || null} />
      <Fact label="Date" value={formatParentDate(match.match_date ?? match.created_at)} />
      <Fact label="Competition" value={match.competition || null} />
      <Fact label="Venue" value={match.venue || null} />
      <Fact label="Position" value={match.position?.toUpperCase() || null} />
      <Fact label="Age group" value={match.age_group || null} />
      <Fact label="Minutes played" value={match.minutes_played} />
      <Fact label="Goals" value={match.goals} />
      <Fact label="Assists" value={match.assists} />
    </dl>
    <p className="text-xs text-muted-foreground">Recorded match facts. The match rating is separate from the coach's assessment.</p>
  </>
}

export function ParentMatchRecord({ match, children, className }: { match: ParentMatch; children: ReactNode; className?: string }) {
  const { selectedChild } = useParentChildren()
  return <FamilyRecordDialog title="Match details" description={selectedChild?.name ?? 'Match'}
    label={`View match against ${match.opponent || match.competition || 'unknown opponent'} on ${formatParentDate(match.match_date ?? match.created_at)}`}
    className={className} details={<MatchFacts matchId={match.id} />}>{children}</FamilyRecordDialog>
}

export function ParentAssessmentRecord({ assessment, coachName, children, className }: {
  assessment: ParentAssessment; coachName: string; children: ReactNode; className?: string
}) {
  const { selectedChild } = useParentChildren()
  return <FamilyRecordDialog title="Coach assessment" description={`${selectedChild?.name ?? 'Player'} · ${coachName}`}
    label={`View coach assessment from ${coachName} on ${formatParentDate(assessment.created_at)}`} className={className}
    details={<>
      <p className="text-sm text-muted-foreground">{formatParentDate(assessment.created_at)}</p>
      <div aria-label="Overall assessment"><ParentRating rating={assessment.coach_rating} missing="Not assessed" /></div>
      <dl className="divide-y divide-border">
        {([
          ['Work Rate', assessment.work_rate], ['Tactical', assessment.tactical], ['Attitude', assessment.attitude],
          ['Technical', assessment.technical], ['Physical', assessment.physical], ['Coachability', assessment.coachability],
        ] as const).map(([label, score]) => <Fact key={label} label={label} value={<ParentRating rating={score} missing="Not assessed" />} />)}
      </dl>
    </>}>{children}</FamilyRecordDialog>
}

export function ParentAwardRecord({ award, coachName, children, className }: {
  award: ParentAward; coachName: string; children: ReactNode; className?: string
}) {
  const { selectedChild } = useParentChildren()
  return <FamilyRecordDialog title="Recognition" description={`${selectedChild?.name ?? 'Player'} · ${coachName}`}
    label={`View recognition: ${formatParentAward(award.award_type)} on ${formatParentDate(award.created_at)}`} className={className}
    details={<div className="space-y-3 text-sm text-foreground break-words">
      <p>{formatParentAward(award.award_type)}</p>
      <p className="text-muted-foreground">{formatParentDate(award.created_at)}</p>
      {award.awarded_for && <p>{award.awarded_for}</p>}
      {award.note && <p>{award.note}</p>}
    </div>}>{children}</FamilyRecordDialog>
}
