import { BANDS } from '@/lib/types'

export const CLUB = {
  name: 'Panetolikos FC',
  totalPlayers: 47,
  assessmentsThisWeek: 31,
  trend: [12, 18, 14, 22, 19, 26, 31],
}

export type AgeGroup = 'U19' | 'U17' | 'U15'
export type Band = 'Exceptional' | 'Standout' | 'Good' | 'Steady' | 'Mixed' | 'Developing' | 'Difficult'

// Derived from BANDS rather than restated. This file held a third copy of the
// band colours; a fourth, on PlayerProfilePage, had different thresholds too.
export const BAND_COLORS: Record<Band, string> =
  Object.fromEntries(BANDS.map(b => [b.word, b.color])) as Record<Band, string>

export interface SquadSummary {
  ageGroup: AgeGroup
  coach: string
  players: number
  assessments: number
  dist: { E: number; G: number; S: number }
}

export const SQUADS: SquadSummary[] = [
  { ageGroup: 'U19', coach: 'Dimitris Karras', players: 18, assessments: 14, dist: { E: 3, G: 9, S: 6 } },
  { ageGroup: 'U17', coach: 'Maria Petridou', players: 16, assessments: 11, dist: { E: 2, G: 8, S: 5 } },
  { ageGroup: 'U15', coach: 'Nikos Vlachos', players: 13, assessments: 6, dist: { E: 1, G: 6, S: 6 } },
]

export interface ClubPlayer {
  id: string
  name: string
  ageGroup: AgeGroup
  position: string
  matches: number
  band: Band
}

export const PLAYERS: ClubPlayer[] = [
  { id: '1', name: 'Andreas Kostas', ageGroup: 'U19', position: 'Midfielder', matches: 12, band: 'Standout' },
  { id: '2', name: 'Yannis Papadakis', ageGroup: 'U19', position: 'Forward', matches: 10, band: 'Good' },
  { id: '3', name: 'Petros Manolas', ageGroup: 'U19', position: 'Defender', matches: 11, band: 'Steady' },
  { id: '4', name: 'Kostas Mitroglou', ageGroup: 'U19', position: 'Forward', matches: 9, band: 'Exceptional' },
  { id: '5', name: 'Sofia Andreou', ageGroup: 'U17', position: 'Midfielder', matches: 8, band: 'Good' },
  { id: '6', name: 'Eleni Vasileiou', ageGroup: 'U17', position: 'Defender', matches: 9, band: 'Mixed' },
  { id: '7', name: 'Nikos Stamatis', ageGroup: 'U17', position: 'Goalkeeper', matches: 10, band: 'Steady' },
  { id: '8', name: 'Markos Lagos', ageGroup: 'U17', position: 'Forward', matches: 7, band: 'Developing' },
  { id: '9', name: 'Christos Pappas', ageGroup: 'U15', position: 'Midfielder', matches: 6, band: 'Good' },
  { id: '10', name: 'Alexandros Theo', ageGroup: 'U15', position: 'Defender', matches: 5, band: 'Mixed' },
  { id: '11', name: 'Giorgos Marinos', ageGroup: 'U15', position: 'Forward', matches: 6, band: 'Steady' },
]

export interface ClubCoach {
  id: string
  name: string
  role: string
  ageGroup: AgeGroup
  players: number
  assessments: number
}

export const COACHES: ClubCoach[] = [
  { id: 'c1', name: 'Dimitris Karras', role: 'Head Coach', ageGroup: 'U19', players: 18, assessments: 14 },
  { id: 'c2', name: 'Maria Petridou', role: 'Head Coach', ageGroup: 'U17', players: 16, assessments: 11 },
  { id: 'c3', name: 'Nikos Vlachos', role: 'Head Coach', ageGroup: 'U15', players: 13, assessments: 6 },
]

export function initials(name: string) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}
