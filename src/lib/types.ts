export type Role = 'player' | 'coach' | 'parent' | 'club'
export type Position = 'gk' | 'def' | 'mid' | 'att'
export type Competition = 'league' | 'cup' | 'tournament' | 'friendly'
export type Venue = 'home' | 'away'
export type CardType = 'none' | 'yellow' | 'red'
export type BodyCondition = 'fresh' | 'good' | 'tired' | 'knock'
export type SelfRating = 'poor' | 'average' | 'good' | 'excellent'
export type BandType = 'exceptional' | 'standout' | 'good' | 'steady' | 'mixed' | 'developing' | 'difficult'
export type MedalType = 'first_match' | 'on_a_roll' | 'first_star' | 'ten_down' | 'most_improved' | 'self_aware'
export type GoalCategory = 'performance' | 'consistency' | 'development' | 'personal'
export type ProgressLevel = 'just_started' | 'making_progress' | 'nearly_there' | 'achieved'
export type Appearance = 'started' | 'sub' | 'training'
export type SelfRatingFlag = 'fair' | 'generous' | 'way off'

export interface BandConfig {
  word: string
  color: string
  bg: string
  border: string
  minScore: number
}

// Bands span the full 0..10 slider range. 5 sits squarely in "Mixed" (the neutral middle).
// Edges:  0–2 Difficult · 2–4 Developing · 4–6 Mixed · 6–7 Steady · 7–8 Good · 8–9 Standout · 9–10 Exceptional
export const BANDS: BandConfig[] = [
  { word: 'Exceptional', color: '#C8F25A', bg: 'rgba(200,242,90,0.15)', border: 'rgba(200,242,90,0.3)', minScore: 9 },
  { word: 'Standout',    color: '#86efac', bg: 'rgba(134,239,172,0.13)', border: 'rgba(134,239,172,0.26)', minScore: 8 },
  { word: 'Good',        color: '#4ade80', bg: 'rgba(74,222,128,0.13)',  border: 'rgba(74,222,128,0.24)',  minScore: 7 },
  { word: 'Steady',      color: '#60a5fa', bg: 'rgba(96,165,250,0.13)',  border: 'rgba(96,165,250,0.24)',  minScore: 6 },
  { word: 'Mixed',       color: '#fb923c', bg: 'rgba(251,146,60,0.13)',  border: 'rgba(251,146,60,0.24)',  minScore: 4 },
  { word: 'Developing',  color: '#a78bfa', bg: 'rgba(167,139,250,0.13)', border: 'rgba(167,139,250,0.24)', minScore: 2 },
  { word: 'Difficult',   color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.1)', minScore: 0 },
]

// The one way to turn a band into its colours. Before this existed, seven call
// sites each wrote `BANDS.find(b => b.word.toLowerCase() === band)` with their
// own fallback, and four files gave up and kept a private copy of the map. One
// of those copies had different THRESHOLDS, so a score of 5 read "Mixed" on the
// player's home screen and "Steady" on their profile — same child, same number,
// two answers. Use this; do not re-derive it.
export function bandConfig(band: BandType): BandConfig {
  return BANDS.find(b => b.word.toLowerCase() === band) ?? BANDS[BANDS.length - 1]
}

export interface MatchInput {
  position: Position
  competition: Competition
  venue: Venue
  opponent: string
  score_us: number
  score_them: number
  minutes_played: number
  card: CardType
  body_condition: BodyCondition
  self_rating: SelfRating
  position_inputs: Record<string, string | number>
  is_friendly: boolean
}

export interface Match extends MatchInput {
  id: string
  player_id: string
  computed_score: number
  band: BandType
  logged_at: string
}

export interface Assessment {
  id: string
  coach_id: string
  player_id: string
  match_id: string | null
  appearance: Appearance
  work_rate: number
  tactical: number
  attitude: number
  technical: number
  physical: number
  coachability: number
  overall_band: BandType
  self_rating_flag: SelfRatingFlag | null
  note: string | null
  assessed_at: string
}

export interface Goal {
  id: string
  player_id: string
  title: string
  category: GoalCategory
  target_number: number | null
  current_number: number
  is_auto_tracked: boolean
  tracking_field: string | null
  progress_level: ProgressLevel | null
  progress_note: string | null
  target_date: string | null
  completed: boolean
  created_at: string
}

export interface Medal {
  id: string
  player_id: string
  medal_type: MedalType
  unlocked_at: string
}

export interface Profile {
  id: string
  role: Role
  first_name: string
  last_name: string
  nationality: string | null
  created_at: string
}

export interface Player {
  id: string
  profile_id: string
  position: Position
  club: string | null
  age_group: string | null
  shirt_number: number | null
  coach_invite_code: string | null
  parent_invite_code: string | null
  created_at: string
}

export interface Coach {
  id: string
  profile_id: string
  club: string | null
  age_group: string | null
  role: string | null
  invite_code: string
  created_at: string
}

export interface Parent {
  id: string
  profile_id: string
  created_at: string
}
