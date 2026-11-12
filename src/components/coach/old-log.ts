import { useFeatureState } from '@/components/trak/parked'

/* TRAK-426 (Kostas, 12 Nov). Where Training and Matches are both on, a training is recorded Training's way (its
   register and notes on its own page) and a match Matches' way (its evaluation), so the old log's pages retire: the
   Log page ("What are you logging?"), Full session, Sessions history and Edit session. Nothing is deleted; old logs
   stay in the database. Their addresses still land somewhere sensible: the Log page and Full session open New event as
   a training (what they were for), Sessions history and Edit session open Training › Past trainings. Where either
   switch is off, the old pages stay, since they still record what that academy has no new way for. */

export const PAST_TRAININGS_PATH = '/coach/training/past'

/** Whether the old log's pages are retired: Training and Matches both on. `known` once both switches have answered. */
export function useOldLogRetired(): { retired: boolean; known: boolean } {
  const training = useFeatureState('training'), games = useFeatureState('games')
  return { retired: training.on && games.on, known: training.known && games.known }
}
