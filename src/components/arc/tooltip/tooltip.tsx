"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent, PointerEvent, ReactElement, ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./tooltip.module.css";

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  /** Trak (TRAK-328): a tap or a click opens and closes it too, for a trigger that only explains: a phone has no hover. */
  openOnTap?: boolean;
}

const DELAY = 250;
const SKIP_WINDOW = 300;

/* Every Tooltip brings its own provider, so the skip window is shared here: while any tooltip is open, and briefly after the last one closes, the next opens without delay or travel. */
let warm = false;
let openCount = 0;
let coolTimer = 0;
const listeners = new Set<() => void>();
const warmth = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  get: () => warm,
  set(next: boolean) { if (warm === next) return; warm = next; listeners.forEach(listener => listener()); },
  opened() { openCount += 1; window.clearTimeout(coolTimer); warmth.set(true); },
  closed() { openCount = Math.max(0, openCount - 1); if (openCount) return; window.clearTimeout(coolTimer); coolTimer = window.setTimeout(() => warmth.set(false), SKIP_WINDOW); },
};

/** String content crossfades when it changes while open, and the bubble springs to the new text size. */
function TooltipText({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const measure = useRef<HTMLSpanElement>(null);
  const measured = useRef<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number; animate: boolean } | null>(null);
  useLayoutEffect(() => {
    const node = measure.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const box = entry.borderBoxSize?.[0];
      const current = node.textContent;
      const animate = measured.current !== null && measured.current !== current;
      measured.current = current;
      setSize({ width: Math.ceil(box?.inlineSize ?? node.offsetWidth), height: Math.ceil(box?.blockSize ?? node.offsetHeight), animate });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <motion.span className={styles.text} initial={false} animate={size ? { width: size.width, height: size.height } : undefined} transition={size?.animate && !reduced ? motionTokens.spring.morph : { duration: 0 }}>
    <span ref={measure} className={styles.measure} aria-hidden="true">{text}</span>
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={text} className={styles.line} initial={reduced ? false : { opacity: 0, y: "0.3em", filter: `blur(${motionTokens.blur.soft}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: "-0.3em", filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } }} transition={{ duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}>{text}</motion.span>
    </AnimatePresence>
  </motion.span>;
}

export function Tooltip({ content, children, side = "top", openOnTap = false }: TooltipProps) {
  const isWarm = useSyncExternalStore(warmth.subscribe, warmth.get, () => false);
  // Controlled so the instant flag lands in the same render that mounts the content (Radix reports uncontrolled changes a frame late).
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  useEffect(() => {
    if (!open) return;
    warmth.opened();
    return warmth.closed;
  }, [open]);
  const show = (next: boolean) => { if (next) setInstant(warmth.get()); setOpen(next); };
  // Trak (TRAK-328): Radix closes a tooltip when its trigger is pressed, and a tap never hovers, so a phone never saw one.
  // With openOnTap the press belongs to the trigger: a tap or a click opens it, and pressing the trigger doesn't count as
  // pressing outside. Open, the click is Radix's own, which closes it and drops a hover's pending open. Hover and keyboard
  // focus still open it; a press anywhere else or Escape closes it.
  const trigger = useRef<HTMLButtonElement>(null);
  const tap = openOnTap ? {
    onPointerDown: (event: PointerEvent) => event.preventDefault(),
    onClick: (event: MouseEvent) => { if (open) return; event.preventDefault(); show(true); },
  } : {};
  return <TooltipPrimitive.Provider delayDuration={DELAY} skipDelayDuration={0}>
    <TooltipPrimitive.Root open={open} delayDuration={isWarm ? 0 : DELAY} onOpenChange={show}>
      <TooltipPrimitive.Trigger asChild ref={trigger} {...tap}>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        {/* Trak: a portalled panel carries "arc" for Arc's tokens (arc-theme.css). */}
        <TooltipPrimitive.Content className={`arc ${styles.tooltip}`} data-instant={instant || undefined} side={side} sideOffset={8} collisionPadding={12}
          onPointerDownOutside={openOnTap ? event => { if (trigger.current?.contains(event.target as Node)) event.preventDefault(); } : undefined}>
          {typeof content === "string" || typeof content === "number" ? <TooltipText text={String(content)}/> : content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  </TooltipPrimitive.Provider>;
}

export default Tooltip;
