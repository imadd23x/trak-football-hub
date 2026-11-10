import { LIBRARY, type LibraryDrill } from './drills'
import { fit } from './fit'
import { drillOrder, kindInfo, type DrillTypeName } from './kinds'

/* TRAK-385 (Drill Library 1/11): smart search (Kostas, 7 Nov: the same drill has many names, so plain search fails).
   A drill is found by its name, its type and kind, the other names coaches use for its type ("piggy in the middle"
   finds Rondos), its topics, and the rest of its text, including its numbers as fitted to the squad ("4 v 4" = "4v4").
   One spelling slip is allowed in words of 5+ letters, two in 10+; the first letter must match. The name lists are
   Claude's: Steve and the pilot academy's coaches should add their own, Greek ones too. */

/** Other names for each drill type. The coach never sees this list; the first three show as "Also called" on the
 *  drill page. */
export const ALSO_CALLED: Record<DrillTypeName, readonly string[]> = {
  'Dry warm-up': ['warm-up', 'activation', 'tag game', 'warmup', 'warm up', 'movement prep', 'dynamic warm-up', 'tig'],
  'Passing': ['passing drill', 'passing pattern', 'pass and move', 'passing square', 'y passing', 'diamond passing', 'combination play', 'one-two', 'wall pass'],
  'Cool-down': ['cool down', 'warm down', 'stretching', 'recovery', 'warmdown'],
  'Pressing movement': ['pressing cones', 'shadow play', 'shadow pressing', 'pressing drill', 'team shape', 'shifting', 'unopposed defending'],
  'Follow and copy': ['truck and trailer', 'follow the leader', 'mirror', 'copycat', 'shadow dribbling'],
  'Repetition': ['technical repetition', 'technique', 'unopposed', 'ball mastery', 'drill'],
  'Rondos': ['piggy in the middle', 'keep ball', 'toro', 'monkey in the middle', 'keep away', 'possession square', 'rondo'],
  'Attack in turns': ['waves', 'wave practice', 'overload practice', 'wave drill', '2v1', '3v2'],
  'Win it and get out': ['break out game', 'transition game', 'double rondo', 'breakout', 'regain and transfer', 'win and transfer'],
  'Possession': ['possession game', 'keep ball', 'positional play', 'keep away', 'possession practice'],
  'Whole squad': ['squad practice', 'three-team game', '3 team possession', 'ball each'],
  'Small-sided games': ['SSG', 'conditioned game', 'scrimmage', 'small sided game', '4v4', '5v5', '7v7', 'match'],
  'Position practice': ['functional practice', 'unit practice', 'positional practice', 'functional'],
  'Attack v defence': ['phase of play', 'attack vs defence', 'AvD', 'attack and defend'],
  '11 v 11': ['full game', '11-a-side', 'match play'],
}

/** The other names shown on a drill page: the first three. */
export const alsoCalled = (d: Pick<LibraryDrill, 'type'>) => ALSO_CALLED[d.type].slice(0, 3)

/** Lower case, curly quotes made straight, and "4 v 4", "4vs4", "4 on 4" all become "4v4". */
export const norm = (text: string) => text.toLowerCase()
  .replace(/(\d+)\s*(?:v|vs|versus|on)\.?\s*(\d+)/g, '$1v$2')
  .replace(/[‘’]/g, "'")

const words = (text: string) => norm(text).split(/[^a-z0-9']+/).filter(Boolean)

/** How many letters differ between two words (edit distance), so "posession" still finds "possession". Words more
 *  than two letters apart in length count as far apart. */
export function slips(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/** A searched word is in a list of words: as the start of one, or with the slips allowed. */
const wordHit = (w: string, list: string[]) =>
  list.some(t => t.startsWith(w) || (w.length >= 5 && t[0] === w[0] && slips(w, t) <= (w.length >= 10 ? 2 : 1)))

/** The squad the search fits drills to, so a search for "12v3" finds what the coach would see. */
export type Squad = { players: number; level: number }

function findText(d: LibraryDrill, squad: Squad) {
  const f = fit(d, squad.players, squad.level)
  return {
    main: norm([d.name, d.type, kindInfo(d.kind).name].join(' ')),
    also: ALSO_CALLED[d.type].map(norm),
    topics: norm(d.topics),
    rest: norm([d.why, ...d.how, ...d.watch, f.details.numbers, f.details.targets].join(' ')),
  }
}

/** How well a drill matches: 4 = its name, type or kind; 3 = another name for its type; 2 = a topic; 1 = anywhere in
 *  it; 0 = no match. An empty search matches everything (1). */
export function score(d: LibraryDrill, query: string, squad: Squad): number {
  const q = norm(query).trim()
  if (!q) return 1
  const x = findText(d, squad), qs = words(q)
  const has = (text: string) => text.includes(q) || (qs.length > 0 && qs.every(w => wordHit(w, words(text))))
  if (has(x.main)) return 4
  if (x.also.some(has)) return 3
  if (has(x.topics)) return 2
  if (has([x.main, ...x.also, x.topics, x.rest].join(' '))) return 1
  return 0
}

/** When a drill was found by another name, which one ("Also called piggy in the middle"), so coaches learn Trak's
 *  plain name. Empty otherwise. */
export function foundAs(d: LibraryDrill, query: string, squad: Squad): string {
  const q = norm(query).trim(), qs = words(q)
  if (!q || score(d, query, squad) !== 3) return ''
  const name = ALSO_CALLED[d.type].find(a => norm(a).includes(q) || qs.every(w => wordHit(w, words(a))))
  return name ? `Also called ${name}` : ''
}

/** The drills that match, best first, then in Library order. `keep` narrows the pool (a kind, a drill type…). */
export function searchDrills(query: string, squad: Squad, keep: (d: LibraryDrill) => boolean = () => true, drills: readonly LibraryDrill[] = LIBRARY): LibraryDrill[] {
  return drills.filter(keep)
    .map(d => ({ d, s: score(d, query, squad) }))
    .filter(r => r.s > 0)
    .sort((a, b) => b.s - a.s || drillOrder(a.d) - drillOrder(b.d))
    .map(r => r.d)
}
