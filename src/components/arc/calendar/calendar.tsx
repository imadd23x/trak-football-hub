"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { animate, AnimatePresence, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from "motion/react";
import type { AnimationPlaybackControls, MotionValue, Variants } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import { useToday } from "../lib/use-today";
import styles from "./calendar.module.css";
import { useTranslation } from "@/lib/i18n";

export type CalendarDateMatcher = (date: Date) => boolean;

export type CalendarMark = string | { color: string; hollow?: boolean };

export interface CalendarProps {
  value?: Date;
  onChange?: (date: Date) => void;
  month?: Date;
  onMonthChange?: (month: Date) => void;
  minDate?: Date;
  maxDate?: Date;
  disabledDates?: CalendarDateMatcher;
  locale?: string;
  className?: string;
  /** Adds a Today button that slides back to the current month and selects today when it is available. */
  showToday?: boolean;
  /** Trak: event dots under a day; hollow marks distinguish cancellations without colour alone. */
  marks?: (date: Date) => CalendarMark[];
  /** Trak (TRAK-255): a day with something waiting for the user gets an amber corner, read as "needs you". */
  attention?: (date: Date) => boolean;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const sameDay = (a?: Date, b?: Date) => Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
const sameMonth = (a?: Date, b?: Date) => Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth());
const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const addMonths = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth() + amount, 1);
/** Moves by whole months and keeps the day, clamped to the shorter month: January 31 plus one month is February 28. */
const shiftMonths = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth() + amount, Math.min(date.getDate(), new Date(date.getFullYear(), date.getMonth() + amount + 1, 0).getDate()));
const isBefore = (a: Date, b?: Date) => Boolean(b && startOfDay(a).getTime() < startOfDay(b).getTime());
const isAfter = (a: Date, b?: Date) => Boolean(b && startOfDay(a).getTime() > startOfDay(b).getTime());
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** Trak: weeks start on Monday, as Schedule and the Home week strip do (TRAK-163). */
const weekday = (date: Date) => (date.getDay() + 6) % 7;
/** Every month shows six weeks, so the grid keeps one height and never jumps while months change. */
const makeWeeks = (month: Date) => {
  const start = addDays(month, -weekday(month));
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)));
};

const subscribeNothing = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
/** The viewer's local date (lib/use-today.ts, shared with date-range-picker). Re-exported so existing imports from calendar keep working. */
export { useToday } from "../lib/use-today";

const { spring, duration, ease } = motionTokens;
/** Months sit side by side on one strip. Rapid clicks retarget the same spring, so the strip never queues or stacks panes. */
const stripSpring = { type: "spring", visualDuration: 0.36, bounce: 0, restDelta: 0.002 } as const;
const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();
const fromIndex = (index: number) => new Date(Math.floor(index / 12), ((index % 12) + 12) % 12, 1);

/** The title crossfades in place: the old month leaves toward the side the strip travels to while the new one arrives from the other. */
const titleSlide: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 12 }),
  center: { opacity: 1, x: 0, transition: { duration: duration.standard, ease: ease.enter } },
  exit: (direction: number) => ({ opacity: 0, x: direction * -12, transition: { duration: 0.14, ease: ease.standard } }),
};
/** Reduced motion swaps the title in place, with no travel and no blank frame. */
const titleFade: Variants = { enter: { opacity: 1, x: 0 }, center: { opacity: 1, x: 0, transition: { duration: 0 } }, exit: { opacity: 0, transition: { duration: 0 } } };

/**
 * The selected disc of one month. It is positioned by week and weekday rather than measured, so it glides on a straight
 * line between any two days, keeps gliding while the strip slides, and retargets mid-flight on a new pick.
 * It only grows in or fades out when the selection enters or leaves this month.
 */
function SelectionDisc({ cell, reduced }: { cell: number; reduced: boolean }) {
  const visible = cell >= 0;
  const col = useMotionValue(visible ? cell % 7 : 0);
  const row = useMotionValue(visible ? Math.floor(cell / 7) : 0);
  const opacity = useMotionValue(visible ? 1 : 0);
  const scale = useMotionValue(visible ? 1 : 0.6);
  // Each step is one cell plus the 4px gap; percentages resolve against the disc's own size, which matches a cell.
  const transform = useTransform(() => `translate(calc(${col.get()} * (100% + 4px)), calc(${row.get()} * (100% + 4px))) scale(${scale.get()})`);
  const hidden = useRef(!visible);
  useLayoutEffect(() => {
    if (!visible) {
      hidden.current = true;
      const fade = reduced ? { duration: 0 } : { duration: 0.14, ease: ease.standard };
      const controls = [animate(opacity, 0, fade), animate(scale, 0.6, fade)];
      return () => controls.forEach((control) => control.stop());
    }
    const nextCol = cell % 7, nextRow = Math.floor(cell / 7);
    const controls: AnimationPlaybackControls[] = [];
    if (hidden.current || reduced) { col.jump(nextCol); row.jump(nextRow); }
    else controls.push(animate(col, nextCol, spring.morph), animate(row, nextRow, spring.morph));
    hidden.current = false;
    controls.push(animate(opacity, 1, reduced ? { duration: 0 } : { duration: duration.fast, ease: ease.enter }), animate(scale, 1, reduced ? { duration: 0 } : spring.snappy));
    return () => controls.forEach((control) => control.stop());
  }, [cell, visible, reduced, col, row, opacity, scale]);
  return <motion.span className={styles.highlight} style={{ transform, opacity }} aria-hidden="true"><span className={styles.highlightFill} /></motion.span>;
}

/** Trak (TRAK-157): React 18 has no boolean `inert` prop; it renders the attribute from an empty string. */
const inertUnless = (present: boolean) => (present ? {} : ({ inert: "" } as Record<string, string>));

/** One month on the strip. Only the month being navigated to is focusable and exposed; the one sliding past is inert. */
function MonthPane({ index, position, present, children }: { index: number; position: MotionValue<number>; present: boolean; children: ReactNode }) {
  const x = useTransform(position, (value) => `calc(${(index - value) * 100}% + ${(index - value) * 16}px)`);
  const opacity = useTransform(position, (value) => 1 - Math.min(1, Math.abs(index - value)) * 0.6);
  return <motion.div className={styles.monthBody} style={{ x, opacity }} data-present={present || undefined} aria-hidden={present ? undefined : true} {...inertUnless(present)}>{children}</motion.div>;
}

export function Calendar({
  value,
  onChange,
  month: controlledMonth,
  onMonthChange,
  minDate,
  maxDate,
  disabledDates,
  locale = "en-US",
  className,
  showToday = false,
  marks,
  attention,
}: CalendarProps) {
  const titleId = useId();
  const today = useToday();
  const { t } = useTranslation();
  // Motion preference only counts after hydration, so server and client markup agree.
  const hydrated = useSyncExternalStore(subscribeNothing, clientSnapshot, serverSnapshot);
  const reducedMotion = (useReducedMotion() ?? false) && hydrated;
  const [internalMonth, setInternalMonth] = useState(() => (value ? monthStart(value) : undefined));
  const [focusedDate, setFocusedDate] = useState(value);
  /** Trak (TRAK-157): the title opens twelve months at a time, so March next year is two taps, not five.
   *  TRAK-256: they start five months before the shown one, so recent months are there too. */
  const [picking, setPicking] = useState<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const focusRequest = useRef<string | null>(null);
  // Without a value or month the calendar waits for the client's today, then settles on that month once.
  const fallback = value ?? today;
  const month = controlledMonth ? monthStart(controlledMonth) : internalMonth ?? (fallback && monthStart(fallback));
  if (!controlledMonth && !internalMonth && month) setInternalMonth(month);
  const monthTime = month?.getTime();
  const monthKey = month ? dateKey(month) : "pending";
  // Direction is read from the month itself, so arrows, keys, Today, and a controlled month all travel the same way.
  const [shownMonth, setShownMonth] = useState(monthTime);
  const [direction, setDirection] = useState(0);
  if (shownMonth !== monthTime) {
    setShownMonth(monthTime);
    setDirection(shownMonth === undefined || monthTime === undefined ? 0 : monthTime > shownMonth ? 1 : -1);
  }
  const weeks = useMemo(() => (monthTime === undefined ? [] : makeWeeks(new Date(monthTime))), [monthTime]);
  // The strip position is measured in months. The panes on either side of it render, plus the month being navigated to.
  const target = month ? monthIndex(month) : 0;
  const position = useMotionValue(target);
  const [span, setSpan] = useState<[number, number]>([target, target]);
  useMotionValueEvent(position, "change", (value) => {
    const next: [number, number] = [Math.floor(value + 1e-3), Math.ceil(value - 1e-3)];
    setSpan((current) => (current[0] === next[0] && current[1] === next[1] ? current : next));
  });
  const ready = month !== undefined;
  const placed = useRef(ready);
  useLayoutEffect(() => {
    if (!ready) return;
    const from = position.get();
    if (from === target) return;
    // The first month and reduced motion land in place; everything else slides on the strip.
    if (!placed.current || reducedMotion) { placed.current = true; position.jump(target); return; }
    // Long jumps (Today, a year with Shift) start one month away, so the strip never scrolls through the months between.
    if (Math.abs(target - from) > 2) position.jump(target - Math.sign(target - from));
    const controls = animate(position, target, stripSpring);
    return () => controls.stop();
  }, [ready, target, reducedMotion, position]);
  const paneIndexes = Array.from(new Set([span[0], span[1], target])).sort((a, b) => a - b);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }), [locale]);
  const weekdayFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short" }), [locale]);
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, index) => weekdayFormatter.format(new Date(2024, 0, 8 + index))), [weekdayFormatter]);
  const monthLabel = month ? formatter.format(month) : "";
  // The selected disc glides between days, so each number flips color as the disc actually passes it:
  // the day it leaves waits longer on short hops, the day it lands on waits longer on long ones.
  const valueKey = value ? dateKey(value) : "";
  const [last, setLast] = useState({ key: valueKey, date: value });
  const [handoff, setHandoff] = useState({ from: "", to: "", distance: 0 });
  if (last.key !== valueKey) {
    const days = last.date && value ? Math.round((startOfDay(value).getTime() - startOfDay(last.date).getTime()) / 864e5) : 0;
    const columns = last.date && value ? weekday(value) - weekday(last.date) : 0;
    setLast({ key: valueKey, date: value });
    setHandoff({ from: last.key, to: valueKey, distance: Math.hypot(columns, (days - columns) / 7) });
  }
  const numberDelay = (key: string): CSSProperties | undefined => {
    if (!handoff.distance || reducedMotion || (key !== handoff.to && key !== handoff.from)) return undefined;
    const delay = key === handoff.to ? Math.min(260, 95 + 85 * Math.log(handoff.distance)) : Math.max(20, 130 / handoff.distance);
    return { "--number-delay": `${Math.round(delay)}ms` } as CSSProperties;
  };

  const isDisabled = (date: Date) => isBefore(date, minDate) || isAfter(date, maxDate) || Boolean(disabledDates?.(date));
  const previousMonth = month && addMonths(month, -1);
  const nextMonth = month && addMonths(month, 1);
  // While the month is still unknown the controls keep their resting look, so hydration does not flash them dim.
  const previousDisabled = Boolean(previousMonth && minDate && previousMonth.getTime() < monthStart(minDate).getTime());
  const nextDisabled = Boolean(nextMonth && maxDate && nextMonth.getTime() > monthStart(maxDate).getTime());
  const todaySelectable = Boolean(today && !isDisabled(today) && onChange);
  const todayIdle = Boolean(today && sameMonth(month, today) && (!todaySelectable || sameDay(value, today)));
  // Roving tab stop: the day last focused, else the selection, else today, else the first open day of the month.
  const tabbableKey = (() => {
    const open = (date?: Date) => (date && sameMonth(date, month) && !isDisabled(date) ? dateKey(date) : "");
    return open(focusedDate) || open(value) || open(today) || dateKey(weeks.flat().find((date) => sameMonth(date, month) && !isDisabled(date)) ?? new Date(0));
  })();

  const changeMonth = (target: Date) => {
    const normalized = monthStart(target);
    if (!controlledMonth) setInternalMonth(normalized);
    onMonthChange?.(normalized);
  };

  /** Keyboard focus lands on the new day in the same frame the month starts to slide. */
  useLayoutEffect(() => {
    const key = focusRequest.current;
    if (!key) return;
    const button = viewportRef.current?.querySelector<HTMLButtonElement>(`[data-present] [data-date="${key}"]`);
    if (button) { focusRequest.current = null; button.focus({ preventScroll: true }); }
  });

  /** Clamps a keyboard move to the allowed range and steps past blocked days in the direction of travel. */
  const moveFocus = (from: Date, target: Date, step: number) => {
    let next = isBefore(target, minDate) && minDate ? startOfDay(minDate) : isAfter(target, maxDate) && maxDate ? startOfDay(maxDate) : target;
    for (let tries = 0; tries < 42 && isDisabled(next); tries += 1) next = addDays(next, step);
    if (isDisabled(next) || sameDay(next, from)) return;
    setFocusedDate(next);
    focusRequest.current = dateKey(next);
    if (!sameMonth(next, month)) changeMonth(next);
  };

  const onDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isDisabled(date)) onChange?.(date);
      return;
    }
    const moves: Record<string, [Date, number]> = {
      ArrowLeft: [addDays(date, -1), -1],
      ArrowRight: [addDays(date, 1), 1],
      ArrowUp: [addDays(date, -7), -1],
      ArrowDown: [addDays(date, 7), 1],
      Home: [addDays(date, -weekday(date)), 1],
      End: [addDays(date, 6 - weekday(date)), -1],
      PageUp: [shiftMonths(date, event.shiftKey ? -12 : -1), -1],
      PageDown: [shiftMonths(date, event.shiftKey ? 12 : 1), 1],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveFocus(date, move[0], move[1]);
  };

  const goToToday = () => {
    if (!today || !month || todayIdle) return;
    setFocusedDate(today);
    if (!sameMonth(today, month)) changeMonth(today);
    if (todaySelectable && !sameDay(value, today)) onChange?.(today);
  };

  const shortMonth = useMemo(() => new Intl.DateTimeFormat(locale, { month: "short" }), [locale]);
  const monthOutOfRange = (candidate: Date) =>
    Boolean((minDate && candidate.getTime() < monthStart(minDate).getTime()) || (maxDate && candidate.getTime() > monthStart(maxDate).getTime()));
  const pickMonth = (candidate: Date) => {
    if (monthOutOfRange(candidate)) return;
    setPicking(null);
    if (!sameMonth(candidate, month)) changeMonth(candidate);
  };

  const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");
  // Six fixed weeks per month, so a day's cell is its distance from the first day on the grid.
  const cellOf = (paneMonth: Date) => {
    if (!value) return -1;
    const first = addDays(paneMonth, -weekday(paneMonth));
    const index = Math.round((startOfDay(value).getTime() - first.getTime()) / 864e5);
    return index >= 0 && index < 42 ? index : -1;
  };

  const renderMonth = (paneMonth: Date, present: boolean) => {
    const firstShown = addDays(paneMonth, -weekday(paneMonth));
    return <>
    <SelectionDisc cell={cellOf(paneMonth)} reduced={reducedMotion} />
    <div className={styles.grid} role="grid" aria-label={formatter.format(paneMonth)}>
    {makeWeeks(paneMonth).map((week) => <div key={dateKey(week[0]!)} className={styles.week} role="row">
      {week.map((date) => {
        const key = dateKey(date);
        // Trak (TRAK-256): another month's days are marked, and its first shown day names the month.
        const outside = !sameMonth(date, paneMonth);
        const monthLabel = outside && (date.getDate() === 1 || sameDay(date, firstShown)) ? shortMonth.format(date) : null;
        const selected = sameDay(date, value);
        const isToday = sameDay(date, today);
        const dots = marks?.(date) ?? [];
        const needsYou = attention?.(date) ?? false;
        const label = date.toLocaleDateString(locale, { dateStyle: "full" });
        return <button
          key={key}
          type="button"
          role="gridcell"
          data-date={key}
          data-outside={outside || undefined}
          aria-label={(dots.length ? `${label}, ${dots.length} ${dots.length === 1 ? "event" : "events"}` : label) + (needsYou ? ", needs you" : "")}
          data-attention={needsYou || undefined}
          aria-selected={selected}
          aria-current={isToday ? "date" : undefined}
          tabIndex={present && key === tabbableKey ? 0 : -1}
          disabled={isDisabled(date)}
          style={present ? numberDelay(key) : undefined}
          className={cx(styles.day, outside && styles.outside, selected && styles.selected, isToday && styles.today)}
          onFocus={() => setFocusedDate(date)}
          onKeyDown={(event) => onDayKeyDown(event, date)}
          onClick={() => onChange?.(date)}
        >{monthLabel && <span className={styles.monthLabel} data-month-label aria-hidden="true">{monthLabel}</span>}
          {needsYou && <span className={styles.attention} aria-hidden="true" />}
          <span className={styles.dayNumber}>{date.getDate()}</span>
          {dots.length > 0 && <span className={styles.marks} aria-hidden="true">{dots.slice(0, 3).map((mark, i) => {
            const { color, hollow } = typeof mark === "string" ? { color: mark, hollow: false } : mark;
            return <span key={i} style={hollow
              ? { background: "transparent", border: `1.5px solid ${color}` }
              : { background: color }} />;
          })}</span>}
        </button>;
      })}
    </div>)}
    </div>
  </>;
  };

  return <section className={cx(styles.calendar, className)} aria-labelledby={titleId}>
      <div className={styles.header}>
        <h2 id={titleId} className={styles.heading}>
          <span className={styles.srOnly}>{monthLabel}</span>
          <button type="button" className={styles.titleButton} disabled={!month} aria-expanded={picking !== null}
            aria-label={`${monthLabel}, choose month and year`} onClick={() => setPicking(picking === null ? target - 5 : null)}>
            <span className={styles.title} aria-hidden="true">
              <AnimatePresence initial={false} custom={direction}>
                {month && <motion.span key={monthKey} className={styles.titleRow} custom={direction} variants={reducedMotion || !direction ? titleFade : titleSlide} initial="enter" animate="center" exit="exit">{monthLabel}</motion.span>}
              </AnimatePresence>
            </span>
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className={cx(styles.titleChevron, picking !== null && styles.titleChevronOpen)} />
          </button>
        </h2>
        <span className={styles.srOnly} aria-live="polite">{direction ? monthLabel : ""}</span>
        <div className={styles.navigation}>
          {showToday && <button type="button" className={styles.todayButton} aria-disabled={todayIdle || undefined} aria-label={today ? `${t("coachHome:today")}, ${today.toLocaleDateString(locale, { dateStyle: "full" })}` : t("coachHome:today")} onClick={goToToday}>{t("coachHome:today")}</button>}
          {picking !== null ? <>
            <button type="button" className={styles.navButton} aria-label="Earlier months" onClick={() => setPicking(picking - 12)}><ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" /></button>
            <button type="button" className={styles.navButton} aria-label="Later months" onClick={() => setPicking(picking + 12)}><ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" /></button>
          </> : <>
          <button type="button" className={styles.navButton} aria-label="Previous month" aria-disabled={previousDisabled || undefined} onClick={() => { if (!previousDisabled && previousMonth) changeMonth(previousMonth); }}><ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" /></button>
          <button type="button" className={styles.navButton} aria-label="Next month" aria-disabled={nextDisabled || undefined} onClick={() => { if (!nextDisabled && nextMonth) changeMonth(nextMonth); }}><ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" /></button>
          </>}
        </div>
      </div>
      {picking !== null && <div className={styles.monthPicker} role="group" aria-label="Choose a month">
        {Array.from({ length: 12 }, (_, i) => fromIndex(picking + i)).map((candidate) => <button key={dateKey(candidate)} type="button"
          className={cx(styles.monthChoice, sameMonth(candidate, month) && styles.monthChoiceCurrent)}
          aria-label={formatter.format(candidate)} aria-current={sameMonth(candidate, month) ? "true" : undefined}
          disabled={monthOutOfRange(candidate)} onClick={() => pickMonth(candidate)}>
          <span>{shortMonth.format(candidate)}</span><span className={styles.monthChoiceYear}>{candidate.getFullYear()}</span>
        </button>)}
      </div>}
      <div className={styles.weekdays} aria-hidden="true" hidden={picking !== null}>{weekdays.map((day, index) => <span key={`${day}-${index}`}>{day.slice(0, 2)}</span>)}</div>
      <div className={styles.monthViewport} ref={viewportRef} hidden={picking !== null}>
        {month ? paneIndexes.map((index) => <MonthPane key={index} index={index} position={position} present={index === target}>{renderMonth(fromIndex(index), index === target)}</MonthPane>)
          : <div className={styles.monthBody} aria-hidden="true"><div className={styles.grid}>{Array.from({ length: 6 }, (_, week) => <div key={week} className={styles.week}>{Array.from({ length: 7 }, (_, day) => <span key={day} className={styles.placeholderDay} />)}</div>)}</div></div>}
      </div>
    </section>;
}

export { addDays, addMonths, sameDay, startOfDay };
