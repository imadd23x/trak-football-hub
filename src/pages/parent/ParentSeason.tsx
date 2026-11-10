import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { ParentFamilyContent } from '@/components/parent/ParentFamily'
import { SeasonPlanSections, seasonSubtitle } from '@/components/player/SeasonPlanSections'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { useMarkSeen, useMySeason } from '@/lib/my-season'
import { firstName, type ParentChild } from '@/lib/parent-data'

/* TRAK-400 (Season plan 18/18 build 5/8, spec TRAK-366): the family's Season plan page, opened from the Home card, for
   the child chosen in the picker. The same content as the player's page, written for the family ("Alex's season").
   Read-only; Back is the only control. Opening it clears New for this guardian. Removed objectives never reach it (the
   function leaves them out). No coach note: that is the player's alone, and the function never returns it. */

const font = { fontFamily: 'var(--t-font)' }

function ChildSeason({ child }: { child: ParentChild }) {
  const name = firstName(child)
  const { data: plan, isPending, isError, refetch, isFetching } = useMySeason(child.id)
  const seen = useMarkSeen(child.id)
  // Opening the page is seeing it. It runs when New turns up, once; the re-read after it says New is gone.
  const unseen = plan?.is_new === true
  useEffect(() => { if (unseen) seen.mutate() }, [unseen]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isPending) return <div className="flex items-center justify-center h-[50vh]" role="status" aria-label={`Loading ${name}'s season`}>
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
  if (isError) return <LoadError what={`${name}'s season`} onRetry={() => { void refetch() }} retrying={isFetching} />
  if (!plan) return <p className="text-[13px] text-ink-2" style={font}>{name}'s coach hasn't shared a season plan yet.</p>
  return <>
    <div className="grid gap-1">
      <h1 className="m-0 text-[26px] font-medium text-ink" style={{ ...font, letterSpacing: '-0.01em' }}>{name}'s season</h1>
      <p className="m-0 text-[15px] text-ink-2" style={font}>{seasonSubtitle(plan)}</p>
    </div>
    <SeasonPlanSections plan={plan} child={name} />
    <p className="m-0 rounded-[14px] bg-raised px-3.5 py-3 text-[14px] text-ink-2" style={font}>
      Your coach updates this at each evaluation. You can read it here; nothing needs a reply.
    </p>
  </>
}

export default function ParentSeason() {
  const navigate = useNavigate()
  const { selectedChild } = useParentChildren()
  return (
    <MobileShell>
      <div className="pt-12 pb-28 space-y-5">
        <Link to="/parent/home" className="flex min-h-11 items-center gap-1 text-[13px] text-ink-2"><ChevronLeft size={16} /> Back</Link>
        <ParentFamilyContent>
          {selectedChild && <ChildSeason key={selectedChild.id} child={selectedChild} />}
        </ParentFamilyContent>
      </div>
      <NavBar role="parent" activeTab="/parent/home" onNavigate={navigate} />
    </MobileShell>
  )
}
