// Arc Pro (uiarc.dev): licensed source, not covered by this repository's licence. See src/components/arc/PRO.md.
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { AnimationPlaybackControls } from "motion/react";
import styles from "./glass-segmented.module.css";

export interface GlassSegmentedOption {
  value: string;
  label: string;
  icon?: ReactNode;
  /** A small count or tag in the accent color, such as unread items. */
  badge?: string | number;
  disabled?: boolean;
}

/**
 * A glass segmented control. The indicator is a drop of liquid: its leading edge races ahead to the new segment and
 * the trailing edge catches up, so it stretches and thins as it travels. Grab the selected segment to drag the drop,
 * and fling it; release velocity decides where it lands.
 */
export interface GlassSegmentedProps {
  options: GlassSegmentedOption[];
  /** Controlled value. */
  value?: string;
  /** Initial value when uncontrolled. Defaults to the first enabled option. */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Accessible name of the group. */
  label: string;
  /** Control height. "md" is 44px, "sm" is 36px. */
  size?: "sm" | "md";
  /** Stretch to the container width with equal segments. */
  fullWidth?: boolean;
  className?: string;
  style?: CSSProperties;
}

type Seg = { left: number; width: number };
const PAD = 4;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const band = (over: number, dim = 40) => over * dim * .5 / (dim + .5 * Math.abs(over));
const lead = { type: "spring" as const, visualDuration: .26, bounce: 0 };
const trail = { type: "spring" as const, visualDuration: .5, bounce: 0 };

export function GlassSegmented({ options, value: valueProp, defaultValue, onValueChange, label, size = "md", fullWidth = false, className, style }: GlassSegmentedProps) {
  const reduced = !!useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const segRefs = useRef(new Map<string, HTMLButtonElement>());
  const segs = useRef(new Map<string, Seg>());
  const [innerValue, setInnerValue] = useState(defaultValue ?? options.find(option => !option.disabled)?.value ?? "");
  const value = valueProp ?? innerValue;
  const [over, setOver] = useState<string | null>(null);
  const [trackH, setTrackH] = useState(size === "sm" ? 36 : 44);
  const left = useMotionValue(0), right = useMotionValue(0), rest = useMotionValue(0);
  const controls = useRef<AnimationPlaybackControls[]>([]);
  const ready = useRef(false);
  const drag = useRef<null | { id: number; x0: number; grab: number; active: boolean; width: number; history: { x: number; t: number }[] }>(null);
  const live = useRef({ value, reduced, options });
  useEffect(() => { live.current = { value, reduced, options }; });
  // Options often arrive as a fresh array every render; only a change in what they hold should re-measure.
  const optionsKey = options.map(option => `${option.value}\u0000${option.label}\u0000${option.badge ?? ""}\u0000${option.disabled ? 1 : 0}`).join("\u0001");

  const setValue = useCallback((next: string) => {
    if (valueProp === undefined) setInnerValue(next);
    if (next !== live.current.value) onValueChange?.(next);
  }, [valueProp, onValueChange]);

  const stop = () => { controls.current.forEach(c => c.stop()); controls.current = []; };

  /** Moves the drop to a segment: the edge facing the travel leads, the other trails, so the drop stretches. */
  const glide = useCallback((seg: Seg, instant = false) => {
    stop();
    const toL = seg.left, toR = seg.left + seg.width;
    rest.set(seg.width);
    if (instant || live.current.reduced) { left.set(toL); right.set(toR); return; }
    const forward = toL > left.get();
    controls.current = [animate(left, toL, forward ? trail : lead), animate(right, toR, forward ? lead : trail)];
  }, [left, right, rest]);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setTrackH(track.clientHeight);
    segs.current.clear();
    for (const option of live.current.options) {
      const node = segRefs.current.get(option.value);
      if (node) segs.current.set(option.value, { left: node.offsetLeft, width: node.offsetWidth });
    }
  }, []);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const place = () => {
      measure();
      const seg = segs.current.get(live.current.value);
      if (seg && !drag.current) glide(seg, true);
      ready.current = true;
    };
    live.current.options = options;
    place();
    const ro = new ResizeObserver(place);
    ro.observe(track);
    return () => { ro.disconnect(); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure when the options' content changes, not their identity
  }, [measure, glide, optionsKey]);

  // Follow value changes from clicks, keys and the parent.
  useEffect(() => {
    if (!ready.current || drag.current?.active) return;
    const seg = segs.current.get(value);
    if (seg) glide(seg);
  }, [value, glide]);

  const nearest = (center: number) => {
    let best: string | null = null, bestD = Infinity;
    for (const option of options) {
      if (option.disabled) continue;
      const seg = segs.current.get(option.value);
      if (!seg) continue;
      const d = Math.abs(seg.left + seg.width / 2 - center);
      if (d < bestD) { bestD = d; best = option.value; }
    }
    return best;
  };

  /* Dragging starts on the selected segment only, so a tap anywhere else is a plain click. */
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current) return;
    const target = (event.target as HTMLElement).closest("button");
    if (!target || target.dataset.value !== value) return;
    const track = trackRef.current!.getBoundingClientRect();
    const x = event.clientX - track.left;
    const seg = segs.current.get(value);
    if (!seg) return;
    drag.current = { id: event.pointerId, x0: x, grab: x - (left.get() + right.get()) / 2, active: false, width: seg.width, history: [{ x, t: performance.now() }] };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const track = trackRef.current!;
    const x = event.clientX - track.getBoundingClientRect().left;
    if (!d.active) {
      if (Math.abs(x - d.x0) < 4) return;
      d.active = true;
      track.setPointerCapture(event.pointerId);
    }
    d.history.push({ x, t: performance.now() });
    if (d.history.length > 6) d.history.shift();
    const min = PAD + d.width / 2, max = track.clientWidth - PAD - d.width / 2;
    const raw = x - d.grab;
    const center = raw < min ? min + band(raw - min) : raw > max ? max + band(raw - max) : raw;
    const next = nearest(center);
    if (next !== over) setOver(next);
    const seg = next ? segs.current.get(next) : null;
    const width = seg ? seg.width : d.width;
    d.width += (width - d.width) * .35;
    const toL = center - d.width / 2, toR = center + d.width / 2;
    rest.set(d.width);
    if (live.current.reduced) { left.set(toL); right.set(toR); return; }
    const forward = toL > left.get();
    stop();
    controls.current = [animate(left, toL, forward ? { ...trail, visualDuration: .22 } : { ...lead, visualDuration: .12 }), animate(right, toR, forward ? { ...lead, visualDuration: .12 } : { ...trail, visualDuration: .22 })];
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    setOver(null);
    if (!d.active) return;
    const now = performance.now(), past = d.history.find(p => now - p.t < 100) ?? d.history[0], last = d.history.at(-1)!;
    const velocity = (last.x - past.x) / Math.max(.016, (last.t - past.t) / 1000);
    const center = (left.get() + right.get()) / 2 + clamp(velocity * .12, -160, 160);
    const next = nearest(center) ?? value;
    const seg = segs.current.get(next);
    if (seg) glide(seg);
    setValue(next);
    // A drag ends with a click on the segment under the pointer; swallow it so the fling decides.
    const swallow = (click: MouseEvent) => { click.stopPropagation(); click.preventDefault(); };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter(option => !option.disabled);
    const index = enabled.findIndex(option => option.value === value);
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % enabled.length
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index - 1 + enabled.length) % enabled.length
      : event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : null;
    if (next === null || !enabled.length) return;
    event.preventDefault();
    const option = enabled[next];
    setValue(option.value);
    segRefs.current.get(option.value)?.focus();
  };

  // The drop thins as it stretches, like liquid conserving its volume.
  // Trak (TRAK-368): a hidden control measures 0 tall, and a negative pill is an invalid SVG rect; never below 0.
  const pillH = Math.max(0, trackH - PAD * 2);
  const squash = useTransform(() => clamp((right.get() - left.get() - rest.get()) * .03, -1.5, pillH * .16));
  const x = useTransform(() => left.get());
  const width = useTransform(() => Math.max(pillH * .6, right.get() - left.get()));
  const y = useTransform(() => PAD + squash.get());
  const height = useTransform(() => Math.max(0, pillH - squash.get() * 2));
  const rx = useTransform(() => Math.max(0, pillH - squash.get() * 2) / 2);
  const shown = over ?? value;

  return <div
    ref={trackRef}
    role="radiogroup"
    aria-label={label}
    className={[styles.root, className].filter(Boolean).join(" ")}
    style={style}
    data-size={size}
    data-full={fullWidth ? "" : undefined}
    data-dragging={over ? "" : undefined}
    onKeyDown={onKeyDown}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerCancel={onPointerUp}
  >
    <svg className={styles.drop} aria-hidden>
      <motion.rect className={styles.dropFill} x={x} y={y} width={width} height={height} rx={rx} />
      <motion.rect className={styles.dropEdge} x={x} y={y} width={width} height={height} rx={rx} />
    </svg>
    {options.map(option => {
      const selected = option.value === value;
      return <button
        key={option.value}
        ref={node => { if (node) segRefs.current.set(option.value, node); else segRefs.current.delete(option.value); }}
        type="button"
        role="radio"
        aria-checked={selected}
        tabIndex={selected ? 0 : -1}
        disabled={option.disabled}
        data-value={option.value}
        data-on={shown === option.value ? "" : undefined}
        className={styles.segment}
        onClick={() => setValue(option.value)}
      >
        {option.icon && <span className={styles.icon} aria-hidden>{option.icon}</span>}
        <span className={styles.label}>{option.label}</span>
        {option.badge !== undefined && <span className={styles.badge}>{option.badge}</span>}
      </button>;
    })}
  </div>;
}

export default GlassSegmented;
