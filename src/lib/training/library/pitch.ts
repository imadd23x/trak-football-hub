import type { LibraryDrill } from './drills'
import { DETAILS, type Fitted, type Role } from './fit'

/* TRAK-386 (Drill Library 2/11): where everything goes in a drill's pitch picture, drawn to scale from the drill as
   fitted (./fit.ts). Ported from the 8 Nov mockup's pitch(). Only positions and roles here: the picture
   (components/coach/training/library/DrillPitch.tsx) picks the colours. The canvas is 640 × 420. */

export const CANVAS = { w: 640, h: 420 } as const

export type Box = { x: number; y: number; w: number; h: number }

export type Shape =
  /** The playing area: a faint fill and a white edge. */
  | ({ s: 'area' } & Box)
  /** A shaded zone: end zones (plain) or the middle (dashed edge). */
  | ({ s: 'zone'; edge: boolean } & Box)
  /** Marked lines (halfway, quarters, lanes, the goal line), faint, solid or dashed; `strong` draws them as bright as
   *  the area's edge (Change any practice's zones). */
  | { s: 'lines'; d: string; dashed: boolean; strong?: boolean }
  /** A goal (white) or a target line (yellow). */
  | ({ s: 'goal' | 'target' } & Box)
  | { s: 'cone'; x: number; y: number }
  | { s: 'player'; x: number; y: number; role: Role; r: number }
  /** A spare player: a yellow diamond. */
  | { s: 'spare'; x: number; y: number }
  | { s: 'ball'; x: number; y: number }
  /** The pass, dashed with a head. */
  | { s: 'arrow'; x1: number; y1: number; x2: number; y2: number }
  /** The size line under the picture ("15 m"); only the full picture shows it. */
  | { s: 'size'; x: number; y: number; text: string }

/** A small fixed random sequence, so a drill's players stand in the same places every time. */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const hash = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

export type Point = [number, number]

/** `count` points spread inside a box, kept `gap` apart from each other and from `taken` where they can be. */
export function scatter(R: () => number, x: number, y: number, w: number, h: number, count: number, taken: Point[], gap = 30): Point[] {
  const out: Point[] = []
  for (let i = 0; i < count; i++) {
    let px = 0, py = 0
    for (let tries = 0; tries < 60; tries++) {
      px = x + 16 + R() * (w - 32)
      py = y + 16 + R() * (h - 32)
      if ([...taken, ...out].every(p => Math.hypot(p[0] - px, p[1] - py) > gap)) break
    }
    out.push([px, py])
  }
  return out
}

const PLAYER_R = 11

/** Everything in a drill's picture, in drawing order. */
export function layout(d: Pick<LibraryDrill, 'id' | 'overlay'>, f: Pick<Fitted, 'draw'>): Shape[] {
  const { w: W, h: H } = CANVAS, D = f.draw, R = rng(hash(d.id))
  const out: Shape[] = []
  const cone = (x: number, y: number) => out.push({ s: 'cone', x, y })
  const player = (x: number, y: number, role: Role, r = PLAYER_R) => out.push({ s: 'player', x, y, role, r })
  const ball = (x: number, y: number) => out.push({ s: 'ball', x, y })
  const arrow = (x1: number, y1: number, x2: number, y2: number) => out.push({ s: 'arrow', x1, y1, x2, y2 })

  if (D.type === 'square' || D.type === 'scatter') {
    const grids = D.type === 'scatter' ? [{ att: D.att, def: D.def }] : D.grids, gap = grids.length > 2 ? 24 : 44
    const m = D.type === 'scatter' ? 16 : Math.min(19, (H - 70) / D.side, (W - 40 - (grids.length - 1) * gap) / (grids.length * D.side))
    const s = D.side * m, total = grids.length * s + (grids.length - 1) * gap, y = (H - s) / 2 - 6
    grids.forEach((G, gi) => {
      const x = (W - total) / 2 + gi * (s + gap)
      out.push({ s: 'area', x, y, w: s, h: s })
      for (const [cx, cy] of [[x, y], [x + s, y], [x, y + s], [x + s, y + s]]) cone(cx, cy)
      if (d.overlay === 'quarters') out.push({ s: 'lines', d: `M${x + s / 2} ${y}V${y + s}M${x} ${y + s / 2}H${x + s}`, dashed: true })
      if (D.type === 'scatter') {
        // TRAK-388: gates to dribble through (Dribble through the gates).
        if (d.overlay === 'gates') for (const [gx, gy] of [[0.25, 0.3], [0.72, 0.25], [0.3, 0.72], [0.75, 0.7], [0.5, 0.5]]) { cone(x + gx * s - 12, y + gy * s); cone(x + gx * s + 12, y + gy * s) }
        const a = scatter(R, x, y, s, s, G.att, [], 26), b = scatter(R, x, y, s, s, G.def, a, 26)
        a.forEach(p => { player(p[0], p[1], 'main', 9); if (!D.noBall) ball(p[0] + 11, p[1] + 8) })
        b.forEach(p => player(p[0], p[1], 'other', 9))
        return
      }
      const pts: Point[] = []
      for (let i = 0; i < G.att; i++) {
        const t = (i + 0.5) / G.att * 4, e = Math.floor(t), u = t - e
        pts.push(e === 0 ? [x + u * s, y] : e === 1 ? [x + s, y + u * s] : e === 2 ? [x + s - u * s, y + s] : [x, y + s - u * s])
      }
      if (d.overlay === 'gates') {
        for (const [gx, gy] of [[0.32, 0.5], [0.68, 0.5]]) { cone(x + gx * s, y + gy * s - 11); cone(x + gx * s, y + gy * s + 11) }
      }
      const defs: Point[] = []
      for (let i = 0; i < G.def; i++) {
        const a = i / G.def * Math.PI * 2 + 0.6, r = G.def === 1 ? 0 : s * 0.2
        defs.push([x + s / 2 + Math.cos(a) * r, y + s / 2 + Math.sin(a) * r])
      }
      if (pts.length) {
        const from = pts[0], to = d.overlay === 'split' ? pts[Math.floor(G.att / 2)] : pts[Math.min(2, G.att - 1)]
        if (to !== from) arrow(from[0], from[1], to[0] + (from[0] < to[0] ? -14 : 14) * 0.4, to[1] - 10)
      }
      pts.forEach(p => player(p[0], p[1], 'main'))
      defs.forEach(p => player(p[0], p[1], 'other'))
      if (pts.length) ball(pts[0][0] + 10, pts[0][1] + 9)
    })
    out.push({ s: 'size', x: W / 2, y: y + s + 26, text: `${D.side} m` })
  } else if (D.type === 'game') {
    const m = 9.2, L = D.L * m, Wd = D.W * m, x = (W - L) / 2, y = (H - Wd) / 2 - 6
    out.push({ s: 'area', x, y, w: L, h: Wd })
    out.push({ s: 'lines', d: `M${x + L / 2} ${y}V${y + Wd}`, dashed: false })
    if (d.overlay === 'wide') out.push({ s: 'lines', d: `M${x} ${y + Wd * 0.2}H${x + L}M${x} ${y + Wd * 0.8}H${x + L}`, dashed: true })
    if (d.overlay === 'endzones') {
      out.push({ s: 'zone', edge: false, x, y, w: L * 0.14, h: Wd })
      out.push({ s: 'zone', edge: false, x: x + L * 0.86, y, w: L * 0.14, h: Wd })
    }
    if (d.overlay === 'middle') out.push({ s: 'zone', edge: true, x: x + L * 0.33, y: y + Wd * 0.22, w: L * 0.34, h: Wd * 0.56 })
    if (D.target) {
      out.push({ s: 'goal', x: x - 9, y: y + Wd / 2 - 24, w: 9, h: 48 })
      out.push({ s: 'target', x: x + L, y, w: 10, h: Wd })
    } else if (d.overlay !== 'endzones' && !D.noGoals) {
      if (!D.oneGoal) out.push({ s: 'goal', x: x - 9, y: y + Wd / 2 - 24, w: 9, h: 48 })
      out.push({ s: 'goal', x: x + L, y: y + Wd / 2 - 24, w: 9, h: 48 })
    }
    if (D.keeper) player(D.keeper === 'left' ? x + 15 : x + L - 15, y + Wd / 2, 'extra')
    const gap = Math.min(30, Math.sqrt(L * Wd / Math.max(1, D.s * 2 + D.j)) * 0.62)
    const a = scatter(R, x, y, L, Wd, D.s, [], gap), b = scatter(R, x, y, L, Wd, D.sb ?? D.s, a, gap)
    const j = scatter(R, x + L * 0.3, y, L * 0.4, Wd, D.j, [...a, ...b], gap)
    const near = a.length ? a.reduce((p, c) => c[0] < p[0] ? c : p, a[0]) : null
    const far = near && a.reduce((p, c) => c[0] > near[0] && c[0] < near[0] + L * 0.5 && c[0] > p[0] ? c : p, near)
    if (near && far && far !== near) arrow(near[0], near[1], far[0] - 8, far[1] + (far[1] > near[1] ? -8 : 8))
    a.forEach(p => player(p[0], p[1], 'main'))
    b.forEach(p => player(p[0], p[1], 'other'))
    j.forEach(p => out.push({ s: 'spare', x: p[0], y: p[1] }))
    if (near) ball(near[0] + 10, near[1] + 9)
    out.push({ s: 'size', x: W / 2, y: y + Wd + 26, text: `${D.L} x ${D.W} m` })
  } else if (D.type === 'pairs') {
    // TRAK-388: long gaps (20 to 40 m) are drawn shorter so they fit; the size line still says the real gap.
    const cols = D.pairs > 5 ? 2 : 1, rows = Math.ceil(D.pairs / cols), px = Math.min(D.gap * 15, cols === 2 ? 250 : 520)
    const rowH = Math.min(62, (H - 70) / rows), top = (H - rows * rowH) / 2 + rowH / 2 - 8
    for (let i = 0; i < D.pairs; i++) {
      const c = cols === 2 ? i % 2 : 0, r = cols === 2 ? Math.floor(i / 2) : i
      const cx = cols === 2 ? (c ? 472 : 168) : W / 2, y = top + r * rowH, x1 = cx - px / 2, x2 = cx + px / 2
      if (d.overlay === 'gate') { cone(cx, y - 13); cone(cx, y + 13) }
      arrow(x1 + 12, y, x2 - 14, y)
      player(x1, y, 'main')
      player(x2, y, 'main')
      ball(x1 + 11, y + 9)
      if (D.odd && i === D.pairs - 1) player(x2 + 20, y, 'main')
    }
    out.push({ s: 'size', x: W / 2, y: H - 14, text: `${D.gap} m between partners` })
  } else {
    const m = 19, py = 36 + D.dist * m, spots = D.g === 2 ? [176, 464] : [W / 2], per = Math.ceil(D.n / D.g)
    spots.forEach((cx, gi) => {
      const count = gi === D.g - 1 ? D.n - per * (D.g - 1) : per
      out.push({ s: 'goal', x: cx - 56, y: 18, w: 112, h: 9 })
      out.push({ s: 'lines', d: `M${cx - 96} 27H${cx + 96}`, dashed: false })
      player(cx, 44, 'extra')
      const sx = D.angle ? cx - 80 : cx, sy = D.angle ? py - 20 : py
      // The queue spreads both ways from the shooter; it narrows when it would run off the left edge.
      const queue = Math.max(0, count - 1), step = Math.min(22, 240 / Math.max(1, count), (sx - 14) / Math.max(1, Math.ceil(queue / 2)))
      arrow(sx, sy - 12, cx + (D.angle ? -16 : 18), 60)
      player(sx, sy, 'main')
      ball(sx + 10, sy - 9)
      for (let i = 0; i < queue; i++) {
        const left = i % 2 === 0, k = Math.floor(i / 2) + 1
        player(sx + (left ? -1 : 1) * k * step, sy + 6, 'main', 8)
      }
    })
    out.push({ s: 'size', x: W / 2, y: Math.min(H - 8, py + 34), text: `${D.dist} m from goal` })
  }
  return out
}

/** The box around everything drawn but the size line. */
export function bounds(shapes: Shape[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (ax: number, ay: number, bx: number, by: number) => {
    x0 = Math.min(x0, ax); y0 = Math.min(y0, ay); x1 = Math.max(x1, bx); y1 = Math.max(y1, by)
  }
  for (const p of shapes) {
    switch (p.s) {
      case 'area': case 'zone': case 'goal': case 'target': add(p.x, p.y, p.x + p.w, p.y + p.h); break
      case 'cone': add(p.x - 5, p.y - 6, p.x + 5, p.y + 4); break
      case 'player': add(p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r); break
      case 'spare': add(p.x - 11.3, p.y - 11.3, p.x + 11.3, p.y + 11.3); break
      case 'ball': add(p.x - 4, p.y - 4, p.x + 4, p.y + 4); break
      case 'arrow': add(Math.min(p.x1, p.x2), Math.min(p.y1, p.y2), Math.max(p.x1, p.x2), Math.max(p.y1, p.y2)); break
      default: break // lines sit inside an area or a goal; the size line is left out
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** A card's view (Kostas, 6 Nov: zoomed to fill the card, so small grids don't look empty): the drawing's box with a
 *  margin, never narrower than 340, in the canvas's shape. The full picture keeps the whole canvas, to scale. */
export function cardView(shapes: Shape[]): Box {
  const b = bounds(shapes)
  if (!b) return { x: 0, y: 0, ...CANVAS }
  const w = Math.max(b.w + 36, (b.h + 36) * CANVAS.w / CANVAS.h, 340), h = w * CANVAS.h / CANVAS.w
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h }
}

/** How many of each are on the picture, for checking the drawing against the numbers. */
export function counts(shapes: Shape[]) {
  const c = { main: 0, other: 0, extra: 0, spare: 0 }
  for (const p of shapes) if (p.s === 'player') c[p.role]++; else if (p.s === 'spare') c.spare++
  return c
}

/** The one line a screen reader hears for the picture: "Keep the ball set-up. Area shape and size: 13x13 m. …". */
export const describePitch = (d: Pick<LibraryDrill, 'name'>, f: Pick<Fitted, 'details'>) =>
  `${d.name} set-up. ${DETAILS.filter(({ key }) => f.details[key]).map(({ key, name }) => `${name}: ${f.details[key]}`).join('. ')}.`
