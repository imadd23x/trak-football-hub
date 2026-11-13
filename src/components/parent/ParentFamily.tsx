import { useId, type ChangeEventHandler, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { BandPill } from '@/components/trak'
import { HomeTitle } from '@/components/trak/HomeHeader'
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu'
import { TeamSwitcher } from '@/components/arc/team-switcher/team-switcher'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS } from '@/lib/types'
import type { ParentAssessment } from '@/lib/parent-data'

export function ParentLoadError({ onRetry, message = "Couldn't load this child's information." }: {
  onRetry: () => void
  message?: string
}) {
  return (
    <div role="alert" className="rounded-xl border border-border bg-card p-4 my-4">
      <p className="text-sm text-foreground">{message}</p>
      <p className="text-sm text-muted-foreground mt-1">Check your connection and try again.</p>
      <button onClick={onRetry} className="mt-3 min-h-11 px-4 rounded-lg border border-border text-sm text-foreground focus-visible:ring-2 focus-visible:ring-primary">
        Retry
      </button>
    </div>
  )
}

export function ParentLoading() {
  return <p role="status" className="py-6 text-sm text-muted-foreground">Loading…</p>
}

/* TRAK-181: a family's child picker. A native select (on iPhone a tap opens
   iOS's own picker), drawn by Trak: Safari otherwise keeps its own small grey
   bar and ignores the height and padding Chrome honours. Same pattern as the
   coach's selects. */
export function FamilySelect({ id, value, onChange, disabled, children }: {
  id: string
  value: string
  onChange: ChangeEventHandler<HTMLSelectElement>
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={onChange} disabled={disabled}
        className="w-full min-h-11 appearance-none rounded-xl border border-border bg-card pl-3 pr-10 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-primary">
        {children}
      </select>
      <ChevronDown size={16} aria-hidden data-testid="family-select-chevron"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

export function ParentChildSelector() {
  const { children, selectedChild, selectChild } = useParentChildren()
  const id = useId()
  if (!selectedChild) return null
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-xs text-muted-foreground mb-2">Following</label>
      <FamilySelect id={id} value={selectedChild.id} onChange={event => selectChild(event.target.value)}>
        {children.map(child => <option key={child.id} value={child.id}>{child.name}</option>)}
      </FamilySelect>
    </div>
  )
}

// TRAK-163: the child's name at the top of parent Home; with siblings it is
// Arc's dropdown menu and switches the child everywhere, like the selector.
export function ParentChildSwitcher() {
  const { children, selectedChild, selectChild } = useParentChildren()
  if (!selectedChild) return <HomeTitle>Home</HomeTitle>
  if (children.length < 2) return <HomeTitle>{selectedChild.name}</HomeTitle>
  return (
    <div className="arc min-w-0" role="group" aria-label="Following">
      <DropdownMenu label={selectedChild.name}
        items={children.map(child => ({ label: child.name, onSelect: () => selectChild(child.id) }))} />
    </div>
  )
}

/** TRAK-441 slice 2 (spec, Imad 12 Nov): the parent picks the child with the coach's squad switcher, in the side menu
 *  where the coach picks a squad. The pick is the one every parent page follows. */
export function ChildSwitcher() {
  const { children, selectedChild, selectChild } = useParentChildren()
  if (!selectedChild) return null
  const initials = (name: string) => name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()
  return <TeamSwitcher className="arc" manage={false} noun={{ one: 'child', many: 'Children' }} value={selectedChild.id} onSwitch={async () => {}}
    onValueChange={selectChild} workspaces={children.map(child => ({ id: child.id, name: child.name,
      logo: <span aria-hidden="true" style={{ fontSize: '.4em', fontWeight: 500 }}>{initials(child.name)}</span> }))} />
}

export function ParentFamilyContent({ children }: { children: ReactNode }) {
  const family = useParentChildren()
  if (family.loading) return <ParentLoading />
  if (family.error) return <ParentLoadError message="Couldn't load your linked children." onRetry={family.retry} />
  if (!family.selectedChild) return (
    <div className="py-8 text-center">
      {/* TRAK-98: roster guardians approve before the child has an account, so
          "open the parent invite" was the wrong instruction. */}
      <p className="text-foreground">No child has signed up yet</p>
      <p className="text-sm text-muted-foreground mt-2">Children you approve appear here once they've set up their Trak account.</p>
    </div>
  )
  return <>{children}</>
}

export function ParentRating({ rating, missing = 'Not rated' }: { rating: number | null | undefined; missing?: string }) {
  return rating == null || !Number.isFinite(rating)
    ? <span className="text-xs text-muted-foreground">{missing}</span>
    : <BandPill band={scoreToBand(rating)} />
}

/** The six category bands of one assessment. Bands only: parents never see the coach's message (TRAK-63). */
export function ParentAssessmentBands({ assessment }: { assessment: ParentAssessment }) {
  return (
    <div className="space-y-3">
      {[
        { label: 'Work Rate', score: assessment.work_rate },
        { label: 'Tactical', score: assessment.tactical },
        { label: 'Attitude', score: assessment.attitude },
        { label: 'Technical', score: assessment.technical },
        { label: 'Physical', score: assessment.physical },
        { label: 'Coachability', score: assessment.coachability },
      ].map(category => {
        const rated = category.score != null && Number.isFinite(category.score)
        const band = rated ? BANDS.find(item => item.word.toLowerCase() === scoreToBand(category.score)) : null
        return <div key={category.label} className="flex items-center gap-3">
          <span className="w-24 text-xs text-muted-foreground">{category.label}</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden="true">
            {rated && <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(10, category.score)) * 10}%`, backgroundColor: band?.color }} />}
          </div>
          <span className="text-xs w-20 text-right text-muted-foreground" style={band ? { color: band.text } : undefined}>{band?.word ?? 'Not assessed'}</span>
        </div>
      })}
    </div>
  )
}
