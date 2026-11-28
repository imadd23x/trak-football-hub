import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import type { Database } from '@/integrations/supabase/types'

/* TRAK-603 (coach–player P17): the player's squads' live announcements from TRAK-602's my_announcements(), newest
   first. The database decides what a player reads: nothing withdrawn, none with the switch off, consent missing or the
   player off the roster. */
export type Announcement = Database['public']['Functions']['my_announcements']['Returns'][number]

export function useMyAnnouncements(userId: string) {
  return useQuery({
    queryKey: ['my-announcements', userId],
    queryFn: async (): Promise<Announcement[]> => {
      const { data, error } = await supabase.rpc('my_announcements')
      if (error) throw error
      return data ?? []
    },
  })
}
