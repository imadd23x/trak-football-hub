import { createContext, useContext } from 'react'
import { toast } from 'sonner'

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
