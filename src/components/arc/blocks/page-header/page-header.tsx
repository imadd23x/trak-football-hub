// Arc (uiarc.dev): the free Page header block (@uiarc/page-header), MIT, see ../../LICENSE; adapted for Trak below.
"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, ReactNode } from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion, type Transition } from "motion/react";
import { Ellipsis } from "lucide-react";
import { Button } from "../../button/button";
import { motionTokens } from "../../lib/motion-tokens";
import styles from "./page-header.module.css";

/* Trak (Imad, 6 Nov): the match page's header. Arc's block, with its sample project lifted into props:
   - The page keeps the window's scroll, so there is never a second scrollbar. Arc's block folds inside its own scroll
     box; in a window that scrolls, folding moves the page under the reader, and a short page flickers between folded
     and open. Here the top row and the tabs are pinned (`top`: below whatever is pinned above, a laptop's top bar),
     and the title and details scroll away under them. Once the title is gone, the top row trades the trail for the
     compact title, which goes back to the top.
   - Tabs switch without the sideways slide; the indicator still glides.
   - No toast: a failed action's `notice` is pinned under the tabs (role="alert") until the next change.
   - React 18: no boolean `inert` prop. */

/** Secondary actions fold into the overflow menu when the trail would get less room than this, and return with a little slack. */
const LEAD_MIN = 240;
const LEAD_RETURN = 272;

export type PageHeaderAction = { key: string; label: string; icon?: ReactNode; onSelect: () => void; loading?: boolean; disabled?: boolean };
export type PageHeaderTab = { value: string; label: string; extra?: ReactNode };
type MenuAction = PageHeaderAction & { separatorBefore?: boolean };

const still: Transition = { duration: 0 };
const blur = (px: number) => `blur(${px}px)`;
const inertUnless = (present: boolean) => (present ? {} : ({ inert: "" } as Record<string, string>));

/** The overflow button never scales: it anchors the menu. A shared highlight glides between items under the pointer. */
function OverflowMenu({ actions, reduce }: { actions: MenuAction[]; reduce: boolean }) {
  const [highlight, setHighlight] = useState<{ top: number; height: number; glide: boolean } | null>(null);
  const pointer = useRef(false);
  const clearTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(clearTimer.current), []);
  function onFocus(event: FocusEvent<HTMLDivElement>) {
    const item = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="menuitem"]') : null;
    window.clearTimeout(clearTimer.current);
    if (!item) { clearTimer.current = window.setTimeout(() => setHighlight(null), pointer.current ? 70 : 0); return; }
    const glide = pointer.current;
    setHighlight(current => ({ top: item.offsetTop, height: item.offsetHeight, glide: glide && current !== null }));
  }
  return <DropdownPrimitive.Root onOpenChange={open => { if (open) { window.clearTimeout(clearTimer.current); setHighlight(null); } }}>
    <DropdownPrimitive.Trigger asChild><Button variant="secondary" size="sm" className={styles.iconButton} aria-label="More actions"><Ellipsis size={17} strokeWidth={1.75} aria-hidden="true" /></Button></DropdownPrimitive.Trigger>
    <DropdownPrimitive.Portal>
      {/* Trak: the menu leaves the header's .arc scope in its portal, so it carries the theme itself. */}
      <DropdownPrimitive.Content className={`arc ${styles.menu}`} align="end" sideOffset={6} collisionPadding={12} loop onFocus={onFocus} onPointerMoveCapture={() => { pointer.current = true; }} onKeyDownCapture={() => { pointer.current = false; }}>
        <motion.span className={styles.highlight} aria-hidden="true" initial={false} animate={highlight ? { y: highlight.top, height: highlight.height, opacity: 1 } : { opacity: 0 }} transition={{ default: highlight?.glide && !reduce ? motionTokens.spring.snappy : still, opacity: { duration: reduce ? 0 : .08 } }} />
        {actions.map(action => <Fragment key={action.key}>
          {action.separatorBefore && <DropdownPrimitive.Separator className={styles.separator} />}
          <DropdownPrimitive.Item className={styles.item} disabled={action.disabled || action.loading} onSelect={action.onSelect}>{action.icon}{action.label}</DropdownPrimitive.Item>
        </Fragment>)}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  </DropdownPrimitive.Root>;
}

function ActionButton({ action, variant }: { action: PageHeaderAction; variant?: "secondary" }) {
  return <Button variant={variant} size="sm" loading={action.loading} disabled={action.disabled} onClick={action.onSelect}>{action.icon}{action.label}</Button>;
}

/** A tab's panel. The header's tabs switch it; it unmounts while another tab is shown, as Radix does. */
export function PageHeaderPanel({ value, children }: { value: string; children: ReactNode }) {
  return <TabsPrimitive.Content value={value} className={styles.panel}>{children}</TabsPrimitive.Content>;
}

export function PageHeader({ title, status, crumbs, details, primary, secondary = [], menu = [], onFold, tabs = [], tabsLabel, value, onValueChange, notice, top = "0px", className, children }: {
  title: string;
  /** The status badge, beside the title and in the compact row. */
  status?: ReactNode;
  /** The trail, in the top row until the header is compact. */
  crumbs?: ReactNode;
  /** The row of details under the title. */
  details?: ReactNode;
  primary?: PageHeaderAction;
  /** Fold into the overflow menu when the top row runs out of room. */
  secondary?: PageHeaderAction[];
  /** Always in the overflow menu. */
  menu?: PageHeaderAction[];
  /** Told when the secondary actions fold into the menu or come back, as a folded action's label can't be seen. */
  onFold?: (folded: boolean) => void;
  tabs?: PageHeaderTab[];
  tabsLabel?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  /** What went wrong with the last action, pinned under the tabs until it's cleared. */
  notice?: string | null;
  /** How far down the header pins: the height of whatever is pinned above it. */
  top?: string;
  className?: string;
  /** PageHeaderPanel for each tab, or the page itself when there are no tabs. */
  children: ReactNode;
}) {
  const id = useId();
  const reduce = useReducedMotion() ?? false;
  const bar = useRef<HTMLDivElement>(null);
  const folded = useRef<HTMLDivElement>(null);
  const trailing = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const titleRow = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [condensed, setCondensed] = useState(false);
  const [layout, setLayout] = useState({ measured: false, collapsed: false, animate: false });

  // Only the header width is observed. The first measurement applies at once; later width changes fold the actions with a spring.
  useEffect(() => {
    const row = bar.current, fold = folded.current, fixed = trailing.current;
    if (!row || !fold || !fixed || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const room = row.clientWidth - fold.offsetWidth - fixed.offsetWidth - 16;
      setLayout(current => {
        const collapsed = current.measured && current.collapsed ? room < LEAD_RETURN : room < LEAD_MIN;
        return current.measured && current.collapsed === collapsed ? current : { measured: true, collapsed, animate: current.measured };
      });
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  useEffect(() => onFold?.(layout.collapsed), [layout.collapsed, onFold]);

  // Trak: compact once the title has scrolled under the pinned top row.
  useEffect(() => {
    const row = bar.current, heading = titleRow.current;
    if (!row || !heading || typeof IntersectionObserver === "undefined") return;
    const under = Math.round(parseFloat(getComputedStyle(row).top) + row.offsetHeight);
    const observer = new IntersectionObserver(([entry]) => {
      setCondensed(!entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? under) + 1);
    }, { rootMargin: `-${under}px 0px 0px 0px` });
    observer.observe(heading);
    return () => observer.disconnect();
  }, [top]);

  /** Switching tabs while compact keeps the compact row and shows the top of the new tab. */
  function selectTab(next: string) {
    const row = bar.current, details = intro.current;
    if (condensed && row && details) {
      const at = window.scrollY + details.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom;
      if (window.scrollY > at) window.scrollTo({ top: at });
    }
    onValueChange?.(next);
  }

  function backToTop() {
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    titleRef.current?.focus({ preventScroll: true });
  }

  const menuActions: MenuAction[] = [
    ...(layout.collapsed ? secondary : []),
    ...menu.map((action, i) => ({ ...action, separatorBefore: i === 0 && layout.collapsed && secondary.length > 0 })),
  ];

  /** Leaving copy fades fast; arriving copy settles on the smooth spring with a short blur. */
  const swap = (entering: boolean): Transition => reduce ? still : { ...motionTokens.spring.smooth, opacity: { duration: entering ? motionTokens.duration.standard : motionTokens.duration.fast, ease: [...motionTokens.ease.standard], delay: entering ? .05 : 0 }, filter: { duration: entering ? motionTokens.duration.standard : motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } };
  const shown = { opacity: 1, y: 0, filter: blur(0) };

  return (
    <TabsPrimitive.Root asChild value={value} onValueChange={selectTab}>
      <section className={["arc", styles.frame, className].filter(Boolean).join(" ")} style={{ ["--ph-top" as string]: top }} aria-labelledby={`${id}-title`} data-measured={layout.measured || undefined}>
        <div ref={bar} className={styles.bar}>
          <div className={styles.lead}>
            <motion.div className={styles.crumbs} {...inertUnless(!condensed)} initial={false} animate={condensed ? { opacity: 0, y: -8, filter: blur(motionTokens.blur.subtle) } : shown} transition={swap(!condensed)}>{crumbs}</motion.div>
            {/* Trak: only while compact, so the title and its badge are never on the page twice. */}
            <AnimatePresence initial={false}>
              {condensed && <motion.button key="compact" type="button" className={styles.compact} aria-label={`${title}, back to top`} onClick={backToTop} initial={{ opacity: 0, y: 14, filter: blur(motionTokens.blur.soft) }} animate={shown} exit={{ opacity: 0, y: 14, filter: blur(motionTokens.blur.soft), transition: swap(false) }} transition={swap(true)}>
                <span className={styles.compactTitle}>{title}</span>
                {status && <span className={styles.compactBadge}>{status}</span>}
              </motion.button>}
            </AnimatePresence>
          </div>

          <div className={styles.actions}>
            <motion.div className={styles.secondary} {...inertUnless(!layout.collapsed)} initial={false} animate={layout.collapsed ? { width: 0, opacity: 0 } : { width: "auto", opacity: 1 }} transition={layout.animate && !reduce ? { width: motionTokens.spring.smooth, opacity: { duration: layout.collapsed ? motionTokens.duration.fast : motionTokens.duration.standard, ease: [...motionTokens.ease.standard], delay: layout.collapsed ? .04 : .08 } } : still}>
              <div ref={folded} className={styles.secondaryInner}>
                {secondary.map(action => <ActionButton key={action.key} action={action} variant="secondary" />)}
              </div>
            </motion.div>
            <div ref={trailing} className={styles.trailing}>
              {primary && <ActionButton action={primary} />}
              {menuActions.length > 0 && <OverflowMenu actions={menuActions} reduce={reduce} />}
            </div>
          </div>
        </div>

        <div ref={intro} className={styles.intro}>
          <div ref={titleRow} className={styles.titleRow}>
            <h1 ref={titleRef} id={`${id}-title`} className={styles.title} tabIndex={-1}>{title}</h1>
            {status}
          </div>
          {details && <div className={styles.meta}>{details}</div>}
        </div>

        {tabs.length > 0 && <LayoutGroup id={id}>
          <TabsPrimitive.List asChild aria-label={tabsLabel}>
            <motion.div layoutScroll className={styles.tabs}>
              {tabs.map(item => <TabsPrimitive.Trigger key={item.value} value={item.value} className={styles.tab}>
                <span className={styles.tabLabel}>{item.label}</span>
                {item.extra && <span className={styles.extra}>{item.extra}</span>}
                {value === item.value && <motion.span className={styles.indicator} layoutId="indicator" layoutDependency={value} transition={reduce ? still : motionTokens.spring.morph} aria-hidden="true" />}
              </TabsPrimitive.Trigger>)}
            </motion.div>
          </TabsPrimitive.List>
        </LayoutGroup>}
        {notice && <p role="alert" className={styles.notice}>{notice}</p>}

        {children}
      </section>
    </TabsPrimitive.Root>
  );
}
