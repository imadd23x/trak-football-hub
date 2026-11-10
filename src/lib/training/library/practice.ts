import type { Role } from './fit'
import { CANVAS, hash, rng, scatter, type Point, type Shape } from './pitch'

/* TRAK-394 (Drill Library 9/11, parent TRAK-384): Change any practice, from the 8 Nov mockup. Steve's five things that
   shape every practice, each with his example: pick one of its set-ups and see the picture and what changes.
   Conditions has his three rules instead. The "what changes" answers are Trak's own; Steve checks them after the pilot
   (Kostas, 9 Nov), so the page no longer says they're a draft. Only words and positions here; the page (ChangePractice in pages/coach/training/DrillLibrary.tsx) draws them with the drill
   picture's colours. */

export type CharacteristicKey = 'area' | 'numbers' | 'targets' | 'direction' | 'conditions'

export interface Characteristic {
  key: CharacteristicKey
  name: string
  /** Steve's example, as a question. */
  question: string
  /** The set-ups to compare, each with what changes. Conditions has none. */
  examples?: { label: string; answer: string }[]
  /** Conditions only: Steve's three rules. */
  rules?: { title: string; text: string }[]
}

export const CHARACTERISTICS: Characteristic[] = [
  {
    key: 'area', name: 'Area shape and size',
    question: 'Passing between the other team’s lines. Same square metres, same players. What changes?',
    examples: [
      { label: '20 wide, 40 long', answer: 'Lines sit further apart, so passes are longer. Players stand closer together across the pitch, so the gaps are small. This is harder.' },
      { label: '40 wide, 20 long', answer: 'Lines sit closer, so passes are shorter. Players are spread further apart, so the gaps are bigger. This is easier.' },
    ],
  },
  {
    key: 'numbers', name: 'Numbers',
    question: '15 players and 2 keepers. Spare players attack both ways. Where you put them changes the practice.',
    examples: [
      { label: '3 spare players in the middle', answer: 'The middle is a free pass. Both end zones are 3v3, so the work is getting the ball to the spare players and back out.' },
      { label: '1 spare player in the middle', answer: 'The middle is now a fight, with one spare player to find. The end zones drop to 2v2, so players have more room to go 1v1.' },
    ],
  },
  {
    key: 'targets', name: 'Targets',
    question: 'Playing out from the goalkeeper. What are they aiming at?',
    examples: [
      { label: 'To a goal', answer: 'One small target. Defenders can protect the middle, so play gets squeezed inside.' },
      { label: 'To a full-width target', answer: 'Anywhere along the line counts. Defenders must cover the whole width, so the team learns to spread and play through.' },
    ],
  },
  {
    key: 'direction', name: 'Direction',
    question: 'The same 12 v 2. “Possession is 360 degrees. Defending is directional!”',
    examples: [
      { label: '10 passes, 30x30', answer: 'No direction. The ball can go anywhere, including backwards, so it’s easy to keep. The two defenders have nothing to protect.' },
      { label: 'End line, 30x30', answer: 'Now there’s a way to go. Defenders can stand in front of the line, and attackers have to get past them.' },
      { label: 'End line, 60x15', answer: 'Two defenders can nearly cover the width. Attackers have a long way to go and very little room to go round.' },
    ],
  },
  {
    key: 'conditions', name: 'Conditions',
    question: 'Rules change what players practise, so use them with care.',
    rules: [
      { title: 'Justify it', text: 'If you place a condition on the practice, you must be able to justify it in the real game, and say how it helps players learn.' },
      { title: 'Start points are not conditions', text: 'Controlled start points and scenarios just put players in the situation you want to work on.' },
      { title: 'Apply it', text: 'Once the session is live, hold the rule. 2 touch means 2 touch. Only 1 player in the area means only 1 player. Control the session.' },
    ],
  },
]

export const characteristic = (key: string | null | undefined) => CHARACTERISTICS.find(c => c.key === key)

/** What each colour means in an example's picture. */
export function practiceKey(key: CharacteristicKey, example: number): [Role, string][] {
  const teams: [Role, string][] = [['main', 'Team A'], ['other', 'Team B']]
  switch (key) {
    case 'area': return teams
    case 'numbers': return [...teams, ['extra', 'Keepers and spare players']]
    case 'targets': return [...teams, ['extra', example === 0 ? 'Keepers' : 'Keeper and target']]
    case 'direction': return [['main', '12 attackers'], ['other', '2 defenders'], ...(example > 0 ? [['extra', 'End line'] as [Role, string]] : [])]
    default: return []
  }
}

/** An example's picture, in drawing order, on the drill picture's 640 × 420 canvas. Ported from the mockup's
 *  howPitch(); the players stand in the same places every time. */
export function practiceLayout(key: CharacteristicKey, example: number): Shape[] {
  const { w: W, h: H } = CANVAS, R = rng(hash(key + example))
  const out: Shape[] = []
  const player = (p: Point, role: Role, r = 11) => out.push({ s: 'player', x: p[0], y: p[1], role, r })
  const goal = (x: number, y: number) => out.push({ s: 'goal', x, y: y - 24, w: 9, h: 48 })
  const size = (x: number, y: number, text: string) => out.push({ s: 'size', x, y, text })

  if (key === 'area') {
    // The same 16 players in four lines: long and thin, or wide and short.
    const [w, h] = example === 0 ? [180, 348] : [348, 180], x = (W - w) / 2, y = (H - h) / 2 - 10
    out.push({ s: 'area', x, y, w, h })
    out.push({ s: 'lines', d: [1, 2, 3].map(b => `M${x} ${y + h * b / 4}H${x + w}`).join(''), dashed: false, strong: true })
    const at = (b: number, c: number): Point => [x + w * (c + 0.5) / 4, y + h * (b + 0.5) / 4]
    const from = at(0, 1), to = at(2, 2)
    out.push({ s: 'arrow', x1: from[0], y1: from[1] + 10, x2: to[0] - 4, y2: to[1] - 14 })
    for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) player(at(b, c), b % 2 ? 'other' : 'main', 9)
    size(W / 2, y + h + 26, example === 0 ? '20 m wide, 40 m long' : '40 m wide, 20 m long')
  } else if (key === 'numbers') {
    // Three zones. 3 spare players in the middle and 3v3 at each end, or 1 spare player, 3v3 in the middle and 2v2.
    const x = 50, y = 50, w = 540, h = 300, z = w / 3
    out.push({ s: 'area', x, y, w, h })
    out.push({ s: 'lines', d: `M${x + z} ${y}V${y + h}M${x + z * 2} ${y}V${y + h}`, dashed: false, strong: true })
    goal(x - 9, y + h / 2); goal(x + w, y + h / 2)
    player([x + 16, y + h / 2], 'extra'); player([x + w - 16, y + h / 2], 'extra')
    const end = example === 0 ? 3 : 2, middle = example === 0 ? 0 : 3, spare = example === 0 ? 3 : 1
    const zones: [number, number, number][] = [[x + 34, z - 34, end], [x + z * 2, z - 34, end], [x + z, z, middle]]
    zones.forEach(([zx, zw, count], i) => {
      const a = scatter(R, zx, y, zw, h, count, [], 34), b = scatter(R, zx, y, zw, h, count, a, 34)
      a.forEach(p => player(p, 'main'))
      b.forEach(p => player(p, 'other'))
      if (i === 2) scatter(R, x + z + 20, y + 20, z - 40, h - 40, spare, [...a, ...b], 40).forEach(p => out.push({ s: 'spare', x: p[0], y: p[1] }))
    })
  } else if (key === 'targets') {
    // 8 v 7 playing out from the keeper, to a goal or to the whole far line.
    const x = 50, y = 50, w = 540, h = 300
    out.push({ s: 'area', x, y, w, h })
    out.push({ s: 'lines', d: `M${x + w / 2} ${y}V${y + h}`, dashed: false })
    goal(x - 9, y + h / 2)
    player([x + 16, y + h / 2], 'extra')
    if (example === 0) { goal(x + w, y + h / 2); player([x + w - 16, y + h / 2], 'extra') }
    else out.push({ s: 'target', x: x + w, y, w: 10, h })
    const a = scatter(R, x + 40, y, w - 80, h, 8, [], 40), b = scatter(R, x + 40, y, w - 80, h, 7, a, 40)
    a.forEach(p => player(p, 'main'))
    b.forEach(p => player(p, 'other'))
    size(W / 2, y + h + 28, example === 0 ? 'Attack a goal' : 'Attack the whole far line')
  } else if (key === 'direction') {
    // 12 v 2: keep it in a square, go to an end line, or go to an end line in a long thin strip.
    const long = example === 2, [wm, hm] = long ? [15, 60] : [30, 30], m = 6, w = wm * m, h = hm * m
    const x = (W - w) / 2, y = (H - h) / 2 - (long ? 6 : 10)
    out.push({ s: 'area', x, y, w, h })
    if (example > 0) {
      out.push({ s: 'target', x, y: y - 5, w, h: 9 })
      out.push({ s: 'arrow', x1: x + w + 28, y1: y + h - 10, x2: x + w + 28, y2: y + 18 })
    }
    const defenders: Point[] = example === 0 ? [[x + w * 0.4, y + h * 0.42], [x + w * 0.62, y + h * 0.6]] : [[x + w * 0.3, y + h * 0.3], [x + w * 0.7, y + h * 0.3]]
    const attackers = example === 0 ? scatter(R, x, y, w, h, 12, defenders, 24) : scatter(R, x, y + h * 0.4, w, h * 0.6, 12, defenders, long ? 20 : 24)
    attackers.forEach(p => player(p, 'main', 8))
    defenders.forEach(p => player(p, 'other', 8))
    if (long) size(x + w + 86, y + h / 2, '60 x 15 m'); else size(W / 2, y + h + 26, '30 x 30 m')
  }
  return out
}
