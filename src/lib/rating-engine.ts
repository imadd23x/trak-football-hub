import { bandConfig } from './types'
import type { MatchInput, BandType, BandConfig } from './types'

function getPositionModifiers(position: string, inputs: Record<string, string | number>): number {
  const get = (key: string): string => String(inputs[key] || '').toLowerCase()
  let mod = 0

  if (position === 'gk') {
    // Clean sheet
    if (get('clean_sheet') === 'yes') mod += 0.5

    // Saves
    const saves = get('saves')
    if (saves === '0') mod -= 0.1
    else if (saves === '1-2') mod += 0.1
    else if (saves === '3-4') mod += 0.25
    else if (saves === '5+') mod += 0.4

    // Distribution
    const dist = get('distribution')
    if (dist === 'excellent') mod += 0.2
    else if (dist === 'good') mod += 0.1
    else if (dist === 'poor') mod -= 0.2

    // Commanding
    const cmd = get('commanding')
    if (cmd === 'yes') mod += 0.15
    else if (cmd === 'mostly') mod += 0.05
    else if (cmd === 'no') mod -= 0.15

    // Errors
    const errors = get('errors')
    if (errors === '1') mod -= 0.3
    else if (errors === '2+') mod -= 0.55
  } else if (position === 'def') {
    // Duels
    const duels = get('duels')
    if (duels === 'most') mod += 0.3
    else if (duels === 'about_half') mod += 0.1
    else if (duels === 'few') mod -= 0.15
    else if (duels === 'none') mod -= 0.3

    // Clearances
    const cl = get('clearances')
    if (cl === 'several') mod += 0.2
    else if (cl === 'some') mod += 0.1
    else if (cl === 'none') mod -= 0.05

    // Aerial
    const aerial = get('aerial')
    if (aerial === 'won_most') mod += 0.2
    else if (aerial === 'lost_most') mod -= 0.2

    // Positioning
    const pos = get('positioning')
    if (pos === 'yes') mod += 0.15
    else if (pos === 'mostly') mod += 0.05
    else if (pos === 'no') mod -= 0.2

    // Goals conceded
    const gc = get('goals_conceded')
    if (gc === '0') mod += 0.2
    else if (gc === '2') mod -= 0.15
    else if (gc === '3+') mod -= 0.3

    // Assists
    const assists = get('assists')
    if (assists === '1') mod += 0.15
    else if (assists === '2+') mod += 0.25
  } else if (position === 'mid') {
    // Passes
    const passes = get('passes')
    if (passes === 'most') mod += 0.25
    else if (passes === 'about_half') mod += 0.05
    else if (passes === 'few') mod -= 0.2

    // Chances created
    const chances = get('chances_created')
    if (chances === '2+') mod += 0.3
    else if (chances === '1') mod += 0.15

    // Pressing
    const pressing = get('pressing')
    if (pressing === 'high') mod += 0.2
    else if (pressing === 'medium') mod += 0.05
    else if (pressing === 'low') mod -= 0.15

    // Assists
    const assists = get('assists')
    if (assists === '1') mod += 0.25
    else if (assists === '2+') mod += 0.4

    // Goals
    const goals = get('goals')
    if (goals === '1') mod += 0.3
    else if (goals === '2+') mod += 0.5

    // Tempo
    const tempo = get('tempo')
    if (tempo === 'yes') mod += 0.15
    else if (tempo === 'partly') mod += 0.05
    else if (tempo === 'no') mod -= 0.1
  } else if (position === 'att') {
    // Goals
    const goals = get('goals')
    if (goals === '1') mod += 0.35
    else if (goals === '2') mod += 0.55
    else if (goals === '3+') mod += 0.75

    // Assists
    const assists = get('assists')
    if (assists === '1') mod += 0.25
    else if (assists === '2+') mod += 0.4

    // Shots on target
    const shots = get('shots_on_target')
    if (shots === '0') mod -= 0.1
    else if (shots === '1-2') mod += 0.1
    else if (shots === '3-4') mod += 0.2
    else if (shots === '5+') mod += 0.35

    // Attacking threat
    const threat = get('attacking_threat')
    if (threat === 'quiet') mod -= 0.2
    else if (threat === 'dangerous') mod += 0.15
    else if (threat === 'dominant') mod += 0.3

    // Hold-up play
    const holdup = get('holdup_play')
    if (holdup === 'good') mod += 0.15
    else if (holdup === 'poor') mod -= 0.1

    // Pressing
    const pressing = get('pressing')
    if (pressing === 'high') mod += 0.1
    else if (pressing === 'low') mod -= 0.1
  }

  return mod
}

export function computeMatchScore(input: MatchInput): number {
  let modifiers = 0

  // Result modifier
  if (input.score_us > input.score_them) modifiers += 0.3
  else if (input.score_us < input.score_them) modifiers -= 0.2

  // Self-rating
  if (input.self_rating === 'excellent') modifiers += 0.4
  else if (input.self_rating === 'good') modifiers += 0.2
  else if (input.self_rating === 'poor') modifiers -= 0.3

  // Card
  if (input.card === 'yellow') modifiers -= 0.2
  else if (input.card === 'red') modifiers -= 0.6

  // Body condition
  if (input.body_condition === 'fresh') modifiers += 0.1
  else if (input.body_condition === 'tired') modifiers -= 0.05
  else if (input.body_condition === 'knock') modifiers -= 0.15

  // Minutes played
  if (input.minutes_played >= 75) modifiers += 0.1
  else if (input.minutes_played < 45) modifiers -= 0.1

  // Position-specific modifiers
  modifiers += getPositionModifiers(input.position, input.position_inputs)

  // Friendly discount: multiply ALL modifiers by 0.8
  if (input.is_friendly) {
    modifiers *= 0.8
  }

  let score = 6.5 + modifiers
  score = Math.max(4.0, Math.min(10.0, score))
  return Math.round(score * 100) / 100
}

export function scoreToBand(score: number): BandType {
  // 0..10 scale — 5 lands in the middle of "Mixed".
  if (score >= 9) return 'exceptional'
  if (score >= 8) return 'standout'
  if (score >= 7) return 'good'
  if (score >= 6) return 'steady'
  if (score >= 4) return 'mixed'
  if (score >= 2) return 'developing'
  return 'difficult'
}

// Score straight to colours, routed through scoreToBand so there is exactly one
// ladder. Deriving a band from BANDS.minScore instead would be a second ladder
// that agrees today and drifts the first time someone edits only one of them.
export function bandForScore(score: number): BandConfig {
  return bandConfig(scoreToBand(score))
}
