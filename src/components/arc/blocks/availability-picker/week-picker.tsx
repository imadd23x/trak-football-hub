// Arc Pro (uiarc.dev): adapted from the Availability picker block; licensed source, not covered by this repository's licence. See src/components/arc/PRO.md.
"use client";

import { useId, useState, type ReactElement, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "../../badge/badge";
import { Button } from "../../button/button";
import { motionTokens } from "../../lib/motion-tokens";
import { CANCELLED_COLOR, EVENT_COLOR } from "@/lib/coach-events";
import type { WeekState } from "@/lib/coach-week";
import { useTranslation } from "@/lib/i18n";
import { useSideMenuScreen } from "@/lib/side-menu-screen";
import styles from "./week-picker.module.css";

export interface WeekEvent {
  id: string;
  kind: "training" | "match" | "tournament" | "other";
  title: string;
  /** "18:00", or null for none to show. */
  time: string | null;
  state: WeekState;
  /** One quiet line: "Published", "Take the register". */
  note: string;
}

export interface WeekDay {
  /** ISO date. */
  id: string;
  short: string;
  date: string;
  full: string;
  today?: boolean;
  events: WeekEvent[];
}

/* Trak (TRAK-407): each state's word in the language showing. */
const STATE_WORD = { draft: "coachHome:stateDraft", clash: "coachHome:stateClash", published: "coachHome:notePublished", "needs-you": "coachHome:needsYouTitle", logged: "coachHome:logged", cancelled: "coachHome:noteCancelled" } as const satisfies Record<WeekState, string>;
const color = (event: WeekEvent) => event.state === "cancelled" ? CANCELLED_COLOR : EVENT_COLOR[event.kind];
const firstEvent = (day: WeekDay) => day.events.find(event => event.state !== "cancelled") ?? day.events[0];

/** Times slide in from the side of the day you moved toward; the old list leaves the other way. */
const slideVariants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 16 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -16, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] as [number, number, number, number] } }),
};
const fadeVariants = { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0 } } };

/**
 * The coach's week (Trak, TRAK-262): seven days with a dot per event and an amber corner on a day that waits for the
 * coach, the chosen day's events in the colour key, and a footer naming the chosen event with its one next step
 * beside Details. The caller renders both buttons: `renderDetails` wraps its trigger in the event sheet.
 */
export function WeekPicker({ title, subtitle, days, onPrevWeek, onNextWeek, renderPrimary, renderDetails, family = false }: {
  /** A player or parent reads the week: nothing "needs you", and nothing to plan. */
  family?: boolean;
  title: string;
  subtitle: string;
  days: WeekDay[];
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  renderPrimary?: (eventId: string) => ReactNode;
  renderDetails?: (eventId: string, trigger: ReactElement) => ReactNode;
}) {
  const reduce = !!useReducedMotion();
  const { t } = useTranslation();
  const laptop = useSideMenuScreen(); // TRAK-432: a laptop has no "+", its button says Create.
  const id = useId();
  const [dayId, setDayId] = useState(days.find(day => day.today)?.id ?? days[0].id);
  const [direction, setDirection] = useState(1);
  const day = days.find(entry => entry.id === dayId) ?? days[0];
  const [eventId, setEventId] = useState(firstEvent(day)?.id ?? null);
  const event = day.events.find(entry => entry.id === eventId) ?? null;
  const summary = event ? `${event.title}${event.time ? ` · ${event.time}` : ""}` : t("coachHome:nothingPlannedOn", { day: day.full.split(" ")[0] });
  const selectionLabel = family ? "" : event ? event.note : t(laptop ? "coachHome:useCreate" : "coachHome:usePlus");

  function selectDay(index: number) {
    const next = days[index];
    if (next.id === dayId) return;
    setDirection(index > days.findIndex(entry => entry.id === dayId) ? 1 : -1);
    setDayId(next.id);
    setEventId(firstEvent(next)?.id ?? null);
  }

  const swap = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, y: 4, filter: `blur(${motionTokens.blur.subtle}px)` }, animate: { opacity: 1, y: 0, filter: "blur(0px)" }, exit: { opacity: 0, y: -4, filter: `blur(${motionTokens.blur.subtle}px)` } };
  const swapTransition = { duration: reduce ? motionTokens.duration.instant : motionTokens.duration.fast, ease: [...motionTokens.ease.standard] as [number, number, number, number] };

  return <section className={`arc ${styles.root}`} aria-labelledby={`${id}-title`}>
    <div className={styles.picker}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className={styles.weekNav}>
          <button type="button" className={styles.navButton} aria-label={t("coachHome:previousWeek")} onClick={onPrevWeek}><ChevronLeft size={18} strokeWidth={1.75} aria-hidden /></button>
          <button type="button" className={styles.navButton} aria-label={t("coachHome:nextWeekButton")} onClick={onNextWeek}><ChevronRight size={18} strokeWidth={1.75} aria-hidden /></button>
        </div>
      </header>

      <div className={styles.days} role="group" aria-label={subtitle}>
        {days.map((entry, index) => {
          const selected = dayId === entry.id;
          const waiting = entry.events.some(item => item.state === "needs-you");
          return <button key={entry.id} type="button" className={styles.day} data-selected={selected || undefined} data-today={entry.today || undefined}
            data-needs-you={waiting || undefined} aria-pressed={selected}
            aria-label={`${entry.full}${entry.today ? t("coachHome:dayToday") : ""}, ${entry.events.length ? t("coachHome:dayEvents", { count: entry.events.length }) : t("coachHome:dayNothing")}${waiting ? t("coachHome:dayNeedsYou") : ""}`}
            onClick={() => selectDay(index)}>
            {selected && <motion.span layoutId={`${id}-day`} className={styles.dayHighlight} transition={reduce ? { duration: 0 } : motionTokens.spring.snappy} />}
            <span className={styles.dayName}>{entry.short}</span>
            <span className={styles.dayDate}>{entry.date}</span>
            <span className={styles.dots} aria-hidden="true">{entry.events.slice(0, 3).map(item => <i key={item.id} data-hollow={item.state === "cancelled" || undefined} style={{ ["--dot" as string]: color(item) }} />)}</span>
          </button>;
        })}
      </div>

      <div className={styles.slotsHead}>
        <h3 className={styles.slotsTitle}>
          <span className={styles.swap}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={day.id} {...swap} transition={swapTransition}>{day.full}{day.today ? " · Today" : ""}</motion.span>
            </AnimatePresence>
          </span>
        </h3>
        <span className={styles.legend}><i style={{ ["--dot" as string]: EVENT_COLOR.training }} aria-hidden="true" />{t("coachHome:legendTraining")}<i style={{ ["--dot" as string]: EVENT_COLOR.match }} aria-hidden="true" />{t("coachHome:legendMatch")}{!family && <><i className={styles.needs} aria-hidden="true" />{t("coachHome:needsYouTitle")}</>}</span>
      </div>

      <div className={styles.slotsStage}>
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.ul key={day.id} className={styles.slots} aria-label={t("coachHome:eventsOn", { day: day.full })} custom={direction} variants={reduce ? fadeVariants : slideVariants}
            initial="enter" animate="center" exit="exit" transition={reduce ? { duration: motionTokens.duration.instant } : { x: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast } }}>
            {day.events.length === 0 && <li className={styles.empty}>{t("coachHome:nothingPlanned")}</li>}
            {day.events.map(entry => {
              const selected = event?.id === entry.id;
              return <li key={entry.id}>
                <button type="button" className={styles.slot} data-selected={selected || undefined} data-state={entry.state} aria-pressed={selected}
                  aria-label={[entry.title, entry.time ?? t("coachHome:noTimeSet"), family ? entry.note : t(STATE_WORD[entry.state])].filter(Boolean).join(", ")} onClick={() => setEventId(entry.id)} style={{ ["--dot" as string]: color(entry) }}>
                  <span className={styles.slotBar} aria-hidden="true" />
                  <span className={styles.slotTime}>{entry.time ?? (entry.state === "logged" ? t("coachHome:timeDone") : t("coachHome:timeTbc"))}</span>
                  <span className={styles.slotText}>
                    <span className={styles.slotTitle}>{entry.title}</span>
                    <span className={styles.slotMeta}>{entry.note}</span>
                  </span>
                  {/* Trak (TRAK-266): a badge in the colour key only where the coach is needed. */}
                  {entry.state === "needs-you" && <Badge tone="warning" size="sm">{t("coachHome:needsYouTitle")}</Badge>}
                  {entry.state === "clash" && <Badge tone="danger" size="sm">{t("coachHome:stateClash")}</Badge>}
                  <span className={styles.slotCheck} aria-hidden="true"><Check size={14} strokeWidth={2} /></span>
                </button>
              </li>;
            })}
          </motion.ul>
        </AnimatePresence>
      </div>

      {/* Trak (TRAK-441): a family's empty day says "Nothing planned" once, in the list. */}
      {(event || !family) && <footer className={styles.footer}>
        <div className={styles.selection}>
          <span className={styles.swap}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={selectionLabel} className={styles.selectionLabel} {...swap} transition={swapTransition}>{selectionLabel}</motion.span>
            </AnimatePresence>
          </span>
          <span className={styles.swap}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.strong key={summary} className={styles.selectionValue} {...swap} transition={swapTransition}>{summary}</motion.strong>
            </AnimatePresence>
          </span>
        </div>
        {event && <div className={styles.footerActions}>
          {renderDetails?.(event.id, <Button variant="ghost" size="sm">{t("coachHome:details")}</Button>)}
          {renderPrimary?.(event.id)}
        </div>}
      </footer>}
    </div>
  </section>;
}

export default WeekPicker;
