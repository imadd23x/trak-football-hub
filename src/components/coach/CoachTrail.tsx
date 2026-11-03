import { createContext, useContext, useEffect, useMemo, useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom'
import { Breadcrumb } from '@/components/arc/breadcrumb/breadcrumb'
import { ArcProvider, type ArcLinkProps } from '@/components/arc/lib/arc-provider'
import { placeOf, tabOf } from '@/lib/coach-places'

/* TRAK-334 (Imad, 2 Nov, Matches round 2 item 1): "anything I click … is easy to go back to where I was before
   clicking". A coach page reached by clicking into something shows a trail at its top, where its back link was, on a
   phone and a laptop alike (Imad's choice): the pages the coach came through, then this one. "Home › vs Mirdif Rangers"
   from Needs you, "Matches › vs Mirdif Rangers" from Matches. Opened from a link or after a refresh, it starts at the
   page's own nav row. The frame remembers each history entry's trail, and each page's name, for as long as the visit
   lasts; a page's own tabs and steps (?tab=, ?step=) are the same page. A crumb for a page this visit came through goes
   back to it, as Back did, so it opens as the coach left it (its filters, where they were on it). TRAK-347 (Imad, 3 Nov):
   on a laptop the frame's top bar is the trail ("Matches / vs Mirdif Rangers"), so the page shows none of its own. */

/** `at`: the crumb's place in the browser's history, when this visit came through it. */
export type Crumb = { label: string; href: string; at?: number }
/** A page's trail for the laptop's top bar: the crumbs before it, then its own name. */
export type Trail = { crumbs: Crumb[]; current: string }

/** Where the current entry sits in the browser's history (React Router keeps it there). */
const historyIndex = () => (window.history.state as { idx?: number } | null)?.idx

interface Trails {
  /** What led to a history entry; undefined when nothing this visit did (a link from outside, a refresh). */
  behind: (key: string) => Crumb[] | undefined
  /** A page's own name, and the trail it showed, for the trails of the pages it opens. */
  name: (key: string, label: string, shown: Crumb[]) => void
  /** On a laptop, hands a page's trail to the frame's top bar (null when it leaves); null on a phone, where the page
   *  shows its trail itself. */
  topBar: ((trail: Trail | null) => void) | null
}
const TrailContext = createContext<Trails | null>(null)

/** In the coach's frame: follows every move between pages, so each page knows the way it came. `tabs` are the nav
 *  rows' paths; a nav row starts a fresh trail. */
export function CoachTrailProvider({ tabs, topBar = null, children }: { tabs: string[]; topBar?: Trails['topBar']; children: ReactNode }) {
  const location = useLocation()
  const type = useNavigationType()
  const memory = useRef({ trails: new Map<string, Crumb[] | undefined>(), names: new Map<string, string>(), at: new Map<string, number | undefined>(), last: null as Location | null })
  const { trails, names, at } = memory.current

  const follow = (from: Location | null, to: Location): Crumb[] | undefined => {
    if (tabs.includes(to.pathname)) return []
    // The first page of the visit, or back and forward to an entry this visit never saw: the page's own nav row.
    if (!from || type === 'POP') return undefined
    const before = trails.get(from.key)
    // The same page on another tab or step, or a redirect standing in for the page before: the same trail.
    if (from.pathname === to.pathname || type === 'REPLACE') return before
    const crumbs = [...(before ?? (tabs.includes(from.pathname) ? [] : [tabOf(from.pathname)])),
      { label: names.get(from.key) ?? placeOf(from.pathname).title, href: from.pathname + from.search, at: at.get(from.key) }]
    // Back to a page already on the trail: the trail ends before it.
    const again = crumbs.findIndex(crumb => crumb.href.split('?')[0] === to.pathname)
    return again < 0 ? crumbs : crumbs.slice(0, again)
  }
  // Worked out once per entry, as it's first shown; a render React repeats changes nothing.
  if (memory.current.last?.key !== location.key) {
    if (!trails.has(location.key)) trails.set(location.key, follow(memory.current.last, location))
    at.set(location.key, historyIndex())
    memory.current.last = location
  }

  const value = useMemo<Trails>(() => ({
    behind: key => memory.current.trails.get(key),
    name: (key, label, shown) => {
      memory.current.names.set(key, label)
      // A page that started its own trail (a link, a refresh) passes on the one it showed, its parents with it.
      if (memory.current.trails.get(key) === undefined) memory.current.trails.set(key, shown)
    },
    topBar,
  }), [topBar])
  return <TrailContext.Provider value={value}>{children}</TrailContext.Provider>
}

/** Arc's link, as a React Router link: a crumb moves within the app. */
function RouterLink({ href, ...props }: ArcLinkProps) {
  return <Link to={href} {...props} />
}

/** A crumb's click: back through the history to a page this visit came through. A crumb it didn't come through (a nav
 *  row, a page it sits under), or a click that opens a new tab, follows the link. */
function useTrailBack() {
  const navigate = useNavigate()
  return (crumb: Crumb) => (event: MouseEvent<HTMLElement>) => {
    const here = historyIndex()
    const steps = crumb.at === undefined || here === undefined ? 0 : here - crumb.at
    if (steps <= 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(-steps)
  }
}

/** A crumb as a link, for a laptop's top bar (TRAK-347): it goes back the way the page's own trail does. */
export function TrailLink({ crumb }: { crumb: Crumb }) {
  const back = useTrailBack()
  return <Link to={crumb.href} onClick={back(crumb)}>{crumb.label}</Link>
}

/** The trail at the top of a page: where the coach came from, then `current`, this page's name. `parents` are the pages
 *  it sits under, after its nav row, for when nothing came before it (a link, a refresh). `style` can set Arc's text
 *  tokens, for a trail on a coloured header. On a laptop it shows in the frame's top bar instead (TRAK-347). */
export function CoachTrail({ current, parents = [], className, style }: { current: string; parents?: Crumb[]; className?: string; style?: CSSProperties }) {
  const location = useLocation()
  const trails = useContext(TrailContext)
  const back = useTrailBack()
  const behind = trails?.behind(location.key) ?? [tabOf(location.pathname), ...parents]
  // By what it says, not by the array: `parents` is written in place, so it is new on every render.
  const shown = JSON.stringify(behind)
  useEffect(() => { trails?.name(location.key, current, JSON.parse(shown) as Crumb[]) }, [trails, location.key, current, shown])
  const topBar = trails?.topBar ?? null
  useEffect(() => {
    if (!topBar) return
    topBar({ crumbs: JSON.parse(shown) as Crumb[], current })
    return () => topBar(null)
  }, [topBar, shown, current])
  if (topBar) return null
  return (
    <div className={['arc', className].filter(Boolean).join(' ')} style={style}>
      <ArcProvider link={RouterLink}>
        <Breadcrumb ariaLabel="Breadcrumb trail" items={[...behind.map(crumb => ({ label: crumb.label, href: crumb.href, onClick: back(crumb) })), { label: current }]} />
      </ArcProvider>
    </div>
  )
}
