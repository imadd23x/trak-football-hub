// Arc Pro (uiarc.dev): adapted from the Sidebar rail block; licensed source, not covered by this repository's licence. See src/components/arc/PRO.md.
"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { AnimatePresence, LayoutGroup, motion, useMotionValue, useReducedMotion, useTransform, type Transition, type Variants } from "motion/react";
import { ChevronRight, X, type LucideIcon } from "lucide-react";
import { motionTokens } from "../../lib/motion-tokens";
import styles from "./sidebar-rail.module.css";

const FULL = 240;
const RAIL = 64;
/** Below this shell width the opened sidebar floats over the page from the rail instead of squeezing it, the way a tablet drawer does. */
const FLOAT = 640;
/** Below this shell width the sidebar starts as the icon rail, so the page keeps room to read. It can still be opened. */
const ROOMY = 760;
/** How long a picked row's highlight gets to land before a floating panel or sheet slides away. */
const SETTLE_MS = 200;

export type RailEntry = { id: string; label: string; icon?: LucideIcon; count?: number; children?: RailEntry[] };

/**
 * Trak's app frame on a laptop: the sidebar folds into an icon rail with `[`, a top bar carries the trail and the
 * page's actions, and the page scrolls beside it. On a phone (`narrow`) only the page renders, and the same sidebar
 * slides in as a sheet that the page opens (the coach's avatar).
 */
export interface SidebarRailProps {
  /** Accessible name of the frame and its navigation, such as the club. */
  label: string;
  brand: { name: string; detail?: string; logo: ReactNode };
  items: RailEntry[];
  /** The row pinned above the profile, such as Settings. */
  footerItem: RailEntry;
  profile: { name: string; detail?: string; avatar: ReactNode };
  /** Id of the current row; a child's id lights its group. */
  active: string;
  onSelect: (id: string) => void;
  /** The current page's name, after the brand in the top bar's trail. */
  title: string;
  /** Right side of the top bar, such as the bell and Create. */
  actions?: ReactNode;
  /** Trak (TRAK-324): under the brand in the open sidebar, such as the coach's squad switcher. Folded to a rail, it hides. */
  afterBrand?: ReactNode;
  /** Phone and small tablet: no rail or top bar; the sidebar opens as a sheet. */
  narrow?: boolean;
  sheetOpen?: boolean;
  onSheetOpenChange?: (open: boolean) => void;
  /** Groups open at first, by id. */
  defaultOpen?: Record<string, boolean>;
  /** The width the sidebar takes from the page (240 open, 64 folded), for fixed bars that centre on the page. */
  onWidthChange?: (width: number) => void;
  children: ReactNode;
}

const curve = (points: readonly number[]) => [...points] as [number, number, number, number];
const instant: Transition = { duration: 0 };
/** Trak (React 18): no boolean `inert` prop; it renders the attribute from an empty string, as in arc/calendar. */
const inertUnless = (present: boolean) => (present ? {} : ({ inert: "" } as Record<string, string>));

/** Labels leave quickly so they are gone a beat before the rail settles, and return a beat after the width starts opening. */
function labelTiming(collapsed: boolean, reduce: boolean): Transition {
  if (reduce) return instant;
  return collapsed ? { duration: .14, ease: curve(motionTokens.ease.standard) } : { duration: .24, delay: .1, ease: curve(motionTokens.ease.enter) };
}

/** Rail-only marks (unread dots) arrive once the labels have cleared, and leave first when the rail opens. */
function markTiming(collapsed: boolean, reduce: boolean): Transition {
  if (reduce) return instant;
  return collapsed ? { duration: .2, delay: .16, ease: curve(motionTokens.ease.enter) } : { duration: .1, ease: curve(motionTokens.ease.standard) };
}

const rise: Variants = {
  hidden: { opacity: 0, y: 8, filter: `blur(${motionTokens.blur.soft}px)` },
  shown: { opacity: 1, y: 0, filter: "blur(0px)" },
};

function RailTip({ enabled, label, note, children }: { enabled: boolean; label: string; note?: string; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  // Closing the rail while a tip is open should not leave it armed for the next collapse.
  if (!enabled && open) setOpen(false);
  return <TooltipPrimitive.Root open={enabled && open} onOpenChange={next => setOpen(next && enabled)}>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content className={`arc ${styles.tip}`} side="right" sideOffset={14} collisionPadding={8}>{label}{note && <span className={styles.tipNote}>{note}</span>}</TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>;
}

type RowProps = { entry: RailEntry; nested?: boolean; current: boolean; lit: boolean; expanded?: boolean; turned?: boolean; controls?: string; collapsed: boolean; tips: boolean; layoutId: string; reduce: boolean; onClick: () => void };

function NavRow({ entry, nested, current, lit, expanded, turned, controls, collapsed, tips, layoutId, reduce, onClick }: RowProps) {
  const Icon = entry.icon;
  const fade = labelTiming(collapsed, reduce);
  const mark = markTiming(collapsed, reduce);
  return <RailTip enabled={tips} label={entry.label} note={entry.count ? `${entry.count} need you` : undefined}>
    <button type="button" className={[styles.item, nested ? styles.nested : "", lit ? styles.lit : ""].join(" ")} aria-current={current ? "page" : undefined} aria-expanded={expanded} aria-controls={controls} onClick={onClick}>
      {lit && <motion.span layoutId={layoutId} className={styles.highlight} style={{ borderRadius: 8 }} transition={reduce ? instant : motionTokens.spring.morph} />}
      {Icon && <Icon className={styles.icon} size={16} strokeWidth={1.75} aria-hidden="true" />}
      <motion.span className={styles.label} initial={false} animate={{ opacity: collapsed ? 0 : 1, x: collapsed ? -6 : 0 }} transition={fade}>{entry.label}{entry.count ? <span className={styles.srOnly}>, {entry.count} need you</span> : null}</motion.span>
      {entry.count ? <>
        <motion.span className={styles.count} aria-hidden="true" initial={false} animate={{ opacity: collapsed ? 0 : 1 }} transition={fade}>{entry.count}</motion.span>
        <motion.span className={styles.dot} aria-hidden="true" initial={false} animate={{ opacity: collapsed ? 1 : 0, scale: collapsed ? 1 : .3 }} transition={collapsed && !reduce ? { ...motionTokens.spring.snappy, delay: .16 } : mark} />
      </> : null}
      {turned !== undefined && <motion.span className={styles.chevron} aria-hidden="true" initial={false} animate={{ opacity: collapsed ? 0 : 1, rotate: turned ? 90 : 0 }} transition={{ opacity: fade, rotate: reduce ? instant : motionTokens.spring.snappy }}><ChevronRight size={14} strokeWidth={1.75} /></motion.span>}
    </button>
  </RailTip>;
}

type NavProps = { variant: "side" | "sheet"; label: string; baseId: string; items: RailEntry[]; footerItem: RailEntry; collapsed: boolean; active: string; open: Record<string, boolean>; reduce: boolean; onSelect: (id: string) => void; onGroup: (id: string) => void };

function Navigation({ variant, label, baseId, items, footerItem, collapsed, active, open, reduce, onSelect, onGroup }: NavProps) {
  const tips = variant === "side" && collapsed;
  const layoutId = `${variant}-active`;
  const height = reduce ? instant : motionTokens.spring.smooth;
  const shared = { collapsed, tips, layoutId, reduce };
  return <motion.nav className={styles.nav} aria-label={label} layoutScroll>
    <ul className={styles.list} role="list">
      {items.map(entry => {
        if (!entry.children) return <li key={entry.id}><NavRow entry={entry} current={active === entry.id} lit={active === entry.id} onClick={() => onSelect(entry.id)} {...shared} /></li>;
        const listId = `${baseId}-${variant}-${entry.id}-list`;
        const shown = !!open[entry.id] && !collapsed;
        const holdsActive = entry.children.some(child => child.id === active);
        return <li key={entry.id}>
          <NavRow entry={entry} current={false} lit={holdsActive && !shown} expanded={shown} turned={!!open[entry.id]} controls={listId} onClick={() => onGroup(entry.id)} {...shared} />
          <motion.ul id={listId} className={styles.children} role="list" {...inertUnless(shown)} initial={false} animate={shown ? { height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } } : { height: 0, opacity: 0, overflow: "hidden" }} transition={{ height, opacity: reduce ? instant : { duration: shown ? .24 : .14, delay: shown ? .06 : 0, ease: curve(motionTokens.ease.standard) } }}>
            {entry.children.map(child => <li key={child.id}><NavRow entry={child} nested current={active === child.id} lit={shown && active === child.id} onClick={() => onSelect(child.id)} {...shared} /></li>)}
          </motion.ul>
        </li>;
      })}
    </ul>
    <ul className={`${styles.list} ${styles.footerList}`} role="list"><li><NavRow entry={footerItem} current={active === footerItem.id} lit={active === footerItem.id} onClick={() => onSelect(footerItem.id)} {...shared} /></li></ul>
  </motion.nav>;
}

function Identity({ className, mark, name, detail, collapsed, reduce }: { className: string; mark: ReactNode; name: string; detail?: string; collapsed: boolean; reduce: boolean }) {
  return <div className={className}>
    <span className={styles.mark}>{mark}</span>
    <motion.span className={styles.stack} initial={false} animate={{ opacity: collapsed ? 0 : 1, x: collapsed ? -6 : 0 }} transition={labelTiming(collapsed, reduce)}><strong>{name}</strong>{detail && <span>{detail}</span>}</motion.span>
  </div>;
}

/** The divider in the panel icon slides with the sidebar, so the control shows what it is about to do. */
function PanelGlyph({ collapsed, reduce }: { collapsed: boolean; reduce: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="3.5" />
    <motion.path d="M8.25 4.25v11.5" initial={false} animate={{ x: collapsed ? -2.5 : 0 }} transition={reduce ? instant : motionTokens.spring.smooth} />
  </svg>;
}

export function SidebarRail({ label, brand, items, footerItem, profile, active, onSelect, title, actions, afterBrand, narrow = false, sheetOpen = false, onSheetOpenChange, defaultOpen = {}, onWidthChange, children }: SidebarRailProps) {
  const baseId = useId();
  const prefersReduced = !!useReducedMotion();
  // The first measurement settles the layout before paint, so it never animates.
  const [settling, setSettling] = useState(true);
  const reduce = prefersReduced || settling;
  const [collapsed, setCollapsed] = useState(false);
  const [floating, setFloating] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>(defaultOpen);
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState("");
  const sheet = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const closeTimer = useRef(0);
  const sidebarId = `${baseId}-sidebar`;
  const setSheet = (next: boolean) => onSheetOpenChange?.(next);

  // The [ shortcut toggles the rail, or the sheet on a phone. It stays out of text fields.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "[" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      if (narrow) { onSheetOpenChange?.(!sheetOpen); return; }
      setCollapsed(value => !value);
      setStatus(collapsed ? "Sidebar expanded" : "Sidebar collapsed");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrow, collapsed, sheetOpen, onSheetOpenChange]);

  // A mid-width shell starts on the rail; crossing the threshold later folds or opens it once.
  const roomy = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    if (!frame) return;
    const fit = () => {
      const width = frame.clientWidth;
      const floats = width < FLOAT;
      setFloating(floats);
      const next = width >= ROOMY;
      if (roomy.current !== next) { roomy.current = next; setCollapsed(!next); }
      // A panel left open while the shell narrows would cover the page, so it folds back to the rail.
      else if (floats) setCollapsed(true);
    };
    fit();
    const settle = requestAnimationFrame(() => setSettling(false));
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => { observer.disconnect(); cancelAnimationFrame(settle); };
  }, [frame]);
  useEffect(() => { if (narrow) { const settle = requestAnimationFrame(() => setSettling(false)); return () => cancelAnimationFrame(settle); } }, [narrow]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  function toggleRail() {
    setCollapsed(!collapsed);
    setStatus(collapsed ? "Sidebar expanded" : "Sidebar collapsed");
  }

  const overlaid = floating && !collapsed;
  const slotWidth = floating || collapsed ? RAIL : FULL;
  useEffect(() => { if (!narrow) onWidthChange?.(slotWidth); }, [narrow, slotWidth, onWidthChange]);

  function fold() {
    setCollapsed(true);
    setStatus("Sidebar collapsed");
  }

  function select(id: string, fromSheet = false) {
    if (fromSheet && dragging.current) return;
    onSelect(id);
    if (!fromSheet && !overlaid) return;
    // Let the highlight arrive before the sheet or the floating panel slides away.
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => (fromSheet ? setSheet(false) : setCollapsed(true)), reduce ? 0 : SETTLE_MS);
  }

  function toggleGroup(id: string, fromSheet = false) {
    if (fromSheet && dragging.current) return;
    // In the rail a group has nowhere to open, so the sidebar widens to reveal it.
    if (collapsed && !fromSheet) {
      setCollapsed(false);
      setOpen(current => ({ ...current, [id]: true }));
      setStatus("Sidebar expanded");
      return;
    }
    setOpen(current => ({ ...current, [id]: !current[id] }));
  }

  // The scrim follows the sheet, so a drag to dismiss lightens the page under the finger instead of waiting for release.
  const sheetX = useMotionValue<number | string>("-100%");
  const scrimOpacity = useTransform(sheetX, value => {
    const width = sheet.current?.offsetWidth || 288;
    const shift = typeof value === "number" ? value / width : value.endsWith("%") ? parseFloat(value) / 100 : parseFloat(value) / width;
    return Math.min(1, Math.max(0, 1 + (Number.isFinite(shift) ? shift : -1)));
  });

  const swap = reduce ? instant : { duration: motionTokens.duration.standard, ease: curve(motionTokens.ease.enter) };
  const navShared = { label, baseId, items, footerItem, active, open, reduce };

  const sheetUi = <Dialog.Root open={sheetOpen} onOpenChange={setSheet}>
    <AnimatePresence>
      {sheetOpen && <Dialog.Portal forceMount>
        <div className={`arc ${styles.sheetLayer}`}>
          <Dialog.Overlay asChild forceMount><motion.div className={styles.scrim} style={{ opacity: scrimOpacity }} /></Dialog.Overlay>
          <Dialog.Content asChild forceMount aria-describedby={undefined} onOpenAutoFocus={event => { const current = sheet.current?.querySelector<HTMLElement>("[aria-current='page']"); if (current && !current.closest("[inert]")) { event.preventDefault(); current.focus(); } }}>
            <motion.div ref={sheet} className={styles.sheet} style={{ x: sheetX }} initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={reduce ? instant : motionTokens.spring.smooth}
              drag={prefersReduced ? false : "x"} dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: .9, right: .04 }} dragMomentum={false}
              onDragStart={() => { dragging.current = true; sheet.current?.setAttribute("data-dragging", ""); }}
              onDragEnd={(_, info) => { sheet.current?.removeAttribute("data-dragging"); window.setTimeout(() => { dragging.current = false; }, 0); if (info.offset.x < -72 || info.velocity.x < -480) setSheet(false); }}>
              <Dialog.Title className={styles.srOnly}>Menu</Dialog.Title>
              <div className={styles.sheetHead}>
                <Identity className={styles.brand} mark={brand.logo} name={brand.name} detail={brand.detail} collapsed={false} reduce={reduce} />
                <Dialog.Close asChild><button type="button" className={styles.iconButton} aria-label="Close menu"><X size={18} strokeWidth={1.75} aria-hidden="true" /></button></Dialog.Close>
              </div>
              <Navigation variant="sheet" collapsed={false} onSelect={id => select(id, true)} onGroup={id => toggleGroup(id, true)} {...navShared} />
              <Identity className={styles.profile} mark={profile.avatar} name={profile.name} detail={profile.detail} collapsed={false} reduce={reduce} />
            </motion.div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>}
    </AnimatePresence>
  </Dialog.Root>;

  if (narrow) return <LayoutGroup id={baseId}>{children}{sheetUi}</LayoutGroup>;

  return <LayoutGroup id={baseId}>
    <TooltipPrimitive.Provider delayDuration={250} skipDelayDuration={300}>
      <section ref={setFrame} className={`arc ${styles.shell}`} aria-label={label} onKeyDown={event => { if (event.key === "Escape" && overlaid && !event.defaultPrevented) { event.preventDefault(); fold(); } }}>
        {/* The slot holds the sidebar's place in the row. On a floating shell it keeps the rail's width and the panel opens over the page. */}
        <motion.div className={styles.slot} initial={false} animate={{ width: slotWidth }} transition={reduce ? instant : motionTokens.spring.smooth}>
          <motion.div id={sidebarId} className={styles.sidebar} initial={false} animate={{ width: collapsed ? RAIL : FULL }} transition={reduce ? instant : motionTokens.spring.smooth} data-collapsed={collapsed || undefined} data-floating={overlaid || undefined}>
            <Identity className={styles.brand} mark={brand.logo} name={brand.name} detail={brand.detail} collapsed={collapsed} reduce={reduce} />
            {afterBrand && !collapsed && <div className={styles.afterBrand}>{afterBrand}</div>}
            <Navigation variant="side" collapsed={collapsed} onSelect={id => select(id)} onGroup={id => toggleGroup(id)} {...navShared} />
            <Identity className={styles.profile} mark={profile.avatar} name={profile.name} detail={profile.detail} collapsed={collapsed} reduce={reduce} />
          </motion.div>
        </motion.div>
        <AnimatePresence>
          {overlaid && <motion.div key="float-scrim" className={`${styles.scrim} ${styles.floatScrim}`} aria-hidden="true" onClick={fold} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduce ? instant : { duration: motionTokens.duration.standard, ease: curve(motionTokens.ease.standard) }} />}
        </AnimatePresence>

        <div className={styles.main}>
          <header className={styles.topbar}>
            <button type="button" className={styles.iconButton} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar  [" : "Collapse sidebar  ["} aria-expanded={!collapsed} aria-controls={sidebarId} aria-keyshortcuts="[" onClick={toggleRail}><PanelGlyph collapsed={collapsed} reduce={reduce} /></button>
            <nav className={styles.crumbs} aria-label="Breadcrumb">
              <ol>
                <li className={styles.crumbRoot}>{brand.name}</li>
                {/* Trak: the new title rises in; the old one leaves at once. A lazy page's suspense interrupted the exit, so old titles stayed. */}
                <li className={styles.crumbCurrent} aria-current="page"><motion.span key={title} variants={rise} initial="hidden" animate="shown" transition={swap}>{title}</motion.span></li>
              </ol>
            </nav>
            {actions && <div className={styles.actions}>{actions}</div>}
          </header>
          <div className={styles.content}>{children}</div>
          <p className={styles.srOnly} role="status" aria-live="polite">{status}</p>
        </div>
      </section>
    </TooltipPrimitive.Provider>
  </LayoutGroup>;
}

export default SidebarRail;
