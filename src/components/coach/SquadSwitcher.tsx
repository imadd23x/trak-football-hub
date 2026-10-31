import { useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { ALL_SQUADS, useCoachSquad } from '@/lib/coach-squad'
import { TeamSwitcher } from '@/components/arc/team-switcher/team-switcher'

/* TRAK-324 (Imad, 30 Oct): the coach picks their squad with Arc's team switcher, in the sidebar on a tablet or laptop
   and at the top of a phone page: each squad with its size ("U17 · 26 players"), All squads first. The pick is
   TRAK-305's: kept on this device, and every coach page follows it. Squads come from the roster, so there's no
   Create or Join. */

const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`

export function SquadSwitcher({ coachId }: { coachId: string }) {
  const coachSquad = useCoachSquad(coachId)
  // The roster's sizes, from the same read loadSquads makes.
  const sizes = useQuery({
    queryKey: ['coach', coachId, 'squad-sizes'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('squad_players').select('age_group, status').eq('coach_user_id', coachId)
      if (error) throw error
      const counts = new Map<string, number>()
      for (const row of data ?? []) {
        const squad = row.age_group?.trim()
        if (squad && row.status !== 'coach_departed') counts.set(squad, (counts.get(squad) ?? 0) + 1)
      }
      return counts
    },
  })
  if (!coachSquad.view) return null
  const size = (squad: string | null) => {
    if (!sizes.data) return undefined
    return players(squad ? sizes.data.get(squad) ?? 0 : [...sizes.data.values()].reduce((sum, n) => sum + n, 0))
  }
  const squads = [
    { id: ALL_SQUADS, name: 'All squads', plan: size(null), logo: <Users aria-hidden="true" style={{ width: '.5em', height: '.5em' }} /> },
    // The tile shows the age, "17"; the name says U17.
    ...coachSquad.squads.map(squad => ({ id: squad, name: squad, plan: size(squad),
      logo: <span aria-hidden="true" style={{ fontSize: '.42em', fontWeight: 500 }}>{squad.replace(/\D/g, '') || squad.slice(0, 1)}</span> })),
  ]
  return <TeamSwitcher className="arc" workspaces={squads} value={coachSquad.view} manage={false}
    onSwitch={async () => {}} onValueChange={coachSquad.pick} />
}
