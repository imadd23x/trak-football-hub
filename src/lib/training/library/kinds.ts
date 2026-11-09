import type { PartType, Players } from '../shelf'
import type { LibraryDrill } from './drills'

/* TRAK-385 (Drill Library 1/11): Steve Rutter's three kinds of practice (Session Planning deck, 6 Nov), each with its
   drill types listed simple to complex, in the plain names Kostas chose on 6 Nov ("call each drill what it is"). Warm-ups
   sit before the three kinds as Get ready. */

export type Kind = 'warmup' | 'technical' | 'skill' | 'game'

export const KINDS = [
  { key: 'technical', name: 'Technical', long: 'Technical practices', note: 'Learn the movement. No opponents.',
    types: ['Passing', 'Pressing movement', 'Follow and copy', 'Repetition'] },
  { key: 'skill', name: 'Skill', long: 'Skill practices', note: 'Use it with opponents in the way.',
    types: ['Rondos', 'Attack in turns', 'Win it and get out', 'Possession', 'Whole squad'] },
  { key: 'game', name: 'Game related', long: 'Game related practices', note: 'Play it. Two teams, towards targets.',
    types: ['Small-sided games', 'Position practice', 'Attack v defence', '11 v 11'] },
] as const

/** TRAK-388 (Kostas, 9 Nov): Cool-down joins Get ready, so Plan session's Cool-down part has drills of its own. */
export const WARM_UP = { key: 'warmup', name: 'Get ready', types: ['Dry warm-up', 'Cool-down'] } as const

export type DrillTypeName = (typeof KINDS)[number]['types'][number] | (typeof WARM_UP)['types'][number]

/** Get ready first, then the three kinds. */
export const KIND_ORDER: readonly Kind[] = ['warmup', 'technical', 'skill', 'game']

export const kindInfo = (kind: Kind) => kind === 'warmup' ? WARM_UP : KINDS.find(k => k.key === kind)!

/** The drill types of a kind, simple to complex. */
export const typesOf = (kind: Kind): readonly DrillTypeName[] => kindInfo(kind).types

/** A drill's place in the Library: by kind, then drill type, team drills before individual and keeper ones. */
export const drillOrder = (d: Pick<LibraryDrill, 'kind' | 'type' | 'focus'>) =>
  KIND_ORDER.indexOf(d.kind) * 100 + typesOf(d.kind).indexOf(d.type) * 2 + (d.focus === 'team' ? 0 : 1)

/** The session part a drill fits (Kostas, 8 Nov: keep Trak's 5-part session and make the drills fit its parts):
 *  Get ready → Dry warm-up (its Cool-down drills → Cool-down), Technical → Passing & movement, Skill → Rondo, a small-sided game → Game, and the rest of
 *  Game related → Functional drills. */
export function partFor(d: Pick<LibraryDrill, 'kind' | 'type'>): PartType {
  if (d.kind === 'warmup') return d.type === 'Cool-down' ? 'cooldown' : 'warmup'
  if (d.kind === 'technical') return 'passing'
  if (d.kind === 'skill') return 'rondo'
  return d.type === 'Small-sided games' ? 'game' : 'functional'
}

/** How a drill takes its players, in Who's here's terms (../turnout.ts), until Who's here refits Library drills itself
 *  (TRAK-393). Rough on purpose: a square or a group at goal works with any number from its minimum. */
export function playersFor(d: Pick<LibraryDrill, 'template'>): Players {
  switch (d.template) {
    case 'warm': return { kind: 'any', min: 1 }
    case 'free':
    case 'pairs': return { kind: 'pairs' }
    case 'groups': return { kind: 'groups', g: 5, lo: 3, hi: 7, unit: 'square' }
    case 'square': return { kind: 'any', min: 4 }
    case 'func': return { kind: 'any', min: 4 }
    case 'funcm':
    case 'game': return { kind: 'teams', min: 6 }
    case 'shoot': return { kind: 'any', min: 2 }
  }
}
