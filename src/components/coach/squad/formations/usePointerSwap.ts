import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Spot } from '@/lib/squad/formation-board'

/* TRAK-357 (Season plan 9/18), from Tarek's parked My Formations build (31 Oct): drag a player onto a place or another
   player to swap. Pointer events, so a finger, a pen and a mouse all drag (the browser's own drag and drop doesn't
   work on a phone). A press that doesn't move is a tap, which the board turns into select-then-swap, as Enter and
   Space do. Held near the top or bottom of the screen, a drag scrolls the page, so a bench under the pitch on a phone
   still reaches the back line. */

const spotAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-spot]')?.dataset.spot ?? null) as Spot | null

export type Dragging = { from: Spot; name: string; x: number; y: number; over: Spot | null }

export function usePointerSwap(onDrop: (from: Spot, to: Spot) => void) {
  const [drag, setDrag] = useState<Dragging | null>(null)
  const press = useRef<{ from: Spot; name: string; x: number; y: number; pointer: number; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const frame = useRef(0)

  const scroll = () => {
    const at = pointer.current
    if (!at || !press.current?.moved) return
    const edge = 64
    const by = at.y < edge ? -(edge - at.y) / 4 : at.y > window.innerHeight - edge ? (at.y - window.innerHeight + edge) / 4 : 0
    if (by) {
      window.scrollBy(0, by)
      const over = spotAt(at.x, at.y)
      setDrag(current => current && { ...current, over: over === current.from ? null : over })
    }
    frame.current = requestAnimationFrame(scroll)
  }
  const end = () => { press.current = null; pointer.current = null; cancelAnimationFrame(frame.current); setDrag(null) }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const bind = (from: Spot, name: string) => ({
    'data-spot': from,
    style: { touchAction: 'none' as const },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !event.isPrimary) return
      press.current = { from, name, x: event.clientX, y: event.clientY, pointer: event.pointerId, moved: false }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const held = press.current
      if (!held || held.pointer !== event.pointerId) return
      if (!held.moved) {
        if (Math.hypot(event.clientX - held.x, event.clientY - held.y) < 6) return
        held.moved = true
        event.currentTarget.setPointerCapture?.(event.pointerId)
        frame.current = requestAnimationFrame(scroll)
      }
      pointer.current = { x: event.clientX, y: event.clientY }
      const over = spotAt(event.clientX, event.clientY)
      setDrag({ from: held.from, name: held.name, x: event.clientX, y: event.clientY, over: over === held.from ? null : over })
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const held = press.current
      end()
      if (!held?.moved) return
      // The click that follows a drag isn't a tap.
      dragged.current = true
      setTimeout(() => { dragged.current = false }, 0)
      const over = spotAt(event.clientX, event.clientY)
      if (over && over !== held.from) onDrop(held.from, over)
    },
    onPointerCancel: end,
  })
  return { drag, bind, wasDrag: () => dragged.current }
}
