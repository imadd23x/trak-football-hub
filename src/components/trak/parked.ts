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
   feature all count as off. */
export type Feature = 'events'

export function useFeature(feature?: Feature): boolean {
  const { user } = useAuth()
  const { data } = useQuery({
    queryKey: ['feature', user?.id, feature],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('feature_on', { p_feature: feature! })
      if (error) throw error
      return data === true
    },
    enabled: !!feature && !!user,
  })
  return data === true
}
