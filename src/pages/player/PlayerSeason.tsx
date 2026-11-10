import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { SeasonPlanSections, seasonSubtitle } from '@/components/player/SeasonPlanSections'
import { useMarkSeen, useMySeason } from '@/lib/my-season'

/* TRAK-398 (Season plan 18/18 build 3/8, spec TRAK-366): the player's My season page, opened from the Home card. Read-
   only; Back is the only control. Position (main, Can also play, role), the squad's objectives with what each looks
   like, and the player's own with their word now and one row per published evaluation. Opening it clears New. Removed
   objectives never reach this page (the function leaves them out); a Met objective keeps its Met row. A player the
   coach has not shared, or one whose switch or consent is off, gets the same short line: the database does not say
   which. The evaluation note is not here: it is the player's alone, on the evaluation (TRAK-401). */

const font = { fontFamily: 'var(--t-font)' }

export default function PlayerSeason() {
  const navigate = useNavigate()
  const { data: plan, isPending, isError, refetch, isFetching } = useMySeason()
  const seen = useMarkSeen()
  // Opening the page is seeing it. It runs when New turns up, once; the re-read after it says New is gone.
  const unseen = plan?.is_new === true
  useEffect(() => { if (unseen) seen.mutate() }, [unseen]) // eslint-disable-line react-hooks/exhaustive-deps

  let body: JSX.Element
  if (isPending) {
    body = <div className="flex items-center justify-center h-[50vh]" role="status" aria-label="Loading your season">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  } else if (isError) {
    body = <LoadError what="your season" onRetry={() => { void refetch() }} retrying={isFetching} />
  } else if (!plan) {
    body = <p className="text-[13px] text-ink-2" style={font}>Your coach hasn't shared a season plan with you yet.</p>
  } else {
    body = <>
      <div className="grid gap-1">
        <h1 className="m-0 text-[26px] font-medium text-ink" style={{ ...font, letterSpacing: '-0.01em' }}>My season</h1>
        <p className="m-0 text-[15px] text-ink-2" style={font}>{seasonSubtitle(plan)}</p>
      </div>
      <SeasonPlanSections plan={plan} />
    </>
  }

  return (
    <MobileShell>
      <div className="pt-12 pb-28 space-y-5">
        <Link to="/player/home" className="flex min-h-11 items-center gap-1 text-[13px] text-ink-2"><ChevronLeft size={16} /> Back</Link>
        {body}
      </div>
      <NavBar role="player" activeTab="/player/home" onNavigate={navigate} />
    </MobileShell>
  )
}
