import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/integrations/supabase/client'

/* TRAK-85: a parked screen shows as designed, with a small "Coming soon" pill.
   Its actions stay visible; when tapped they say "Coming soon" and send
   nothing. The backend writes stay closed regardless (G7, TRAK-47): this is
   the screen being honest, not the protection. ParkedScreen provides it. */

export const ParkedContext = createContext(false)

export const COMING_SOON = 'Coming soon'

/** In a parked screen: `if (parked) return comingSoon()` at the top of every
    handler that would write, call AI, share or download. */
export function useParked() {
  const parked = useContext(ParkedContext)
  return { parked, comingSoon: () => { toast(COMING_SOON, { description: 'This will be available in a future update.' }) } }
}

/* TRAK-124 (J8.1): a feature the operator switches on per academy, with no
   deploy (public.academy_features). The database enforces it; this only
   decides whether the screen shows the pill. Loading, a failed read or no
   feature all count as off. TRAK-283: Games is switched on the same way, and
   TRAK-294 Training, and TRAK-350 the season plan. TRAK-441: family_look is
   the family app in the coach's look, read for a player or parent through
   family_feature_on (feature_on knows only a coach's academy). */
export type Feature = 'events' | 'games' | 'training' | 'season_plan' | 'family_look'

export function useFeature(feature?: Feature): boolean {
  return useFeatureState(feature).on
}

/** TRAK-350: also whether the switch has answered, for a screen that must not treat "not known yet" as off. A failed
 *  read counts as known, and off. */
export function useFeatureState(feature?: Feature): { on: boolean; known: boolean } {
  const { user } = useAuth()
  const { data, isSuccess, isError } = useQuery({
    queryKey: ['feature', user?.id, feature],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(feature === 'family_look' ? 'family_feature_on' : 'feature_on', { p_feature: feature! })
      if (error) throw error
      return data === true
    },
    enabled: !!feature && !!user,
  })
  return { on: data === true, known: isSuccess || isError }
}
