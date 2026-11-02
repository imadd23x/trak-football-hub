// Arc Pro (uiarc.dev): adapted from the Account health block; licensed source, not covered by this repository's licence. See src/components/arc/PRO.md.
"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "../../button/button";
import { motionTokens } from "../../lib/motion-tokens";
import styles from "./plan-review.module.css";

/* Trak (TRAK-332, Imad 2 Nov): Review & share. Account health's card (a gauge, a countdown, signal rows, one next step)
   reads a game plan instead of a customer: the gauge counts the parts that are ready, the countdown runs to kick-off,
   each row is a part of the plan with its own Edit, and the footer holds what shares it. No time ranges, no sparklines
   and no AI summary: Trak has no history to draw and no AI writing it. */

export type ReviewStatus = "good" | "watch" | "risk";
export type ReviewRow = {
  id: string;
  label: string;
  /** One short line: "11 of 11 placed · 7 on the bench". */
  detail?: string;
  status: ReviewStatus;
  /** Opens the part to change it. */
  onEdit?: () => void;
};
export interface PlanReviewProps {
  /** The match: "vs Mirdif Rangers". */
  title: string;
  /** When and where: "Sat 7 Nov · Kick-off 12:00 · Away". */
  meta?: string;
  rows: ReviewRow[];
  /** The gauge's word: "Ready to share", "2 to check", "Logistics first". */
  band: { status: ReviewStatus; label: string };
  /** The countdown: its label ("Kick-off Sat 7 Nov"), when the plan began and kick-off. */
  countdown: { label: string; start: Date | string; end: Date | string };
  /** Read only: the rows have no Edit. */
  readOnly?: boolean;
  /** What shares the plan, under the rows. */
  children?: ReactNode;
}

const HOUR = 3_600_000, DAY = 24 * HOUR;
const ease = [...motionTokens.ease.enter] as [number, number, number, number];
const STATUS: Record<ReviewStatus, { label: string; Icon: typeof CircleCheck }> = {
  good: { label: "Ready", Icon: CircleCheck },
  watch: { label: "Check", Icon: CircleAlert },
  risk: { label: "Needed", Icon: TriangleAlert },
};
const toDate = (value: Date | string) => value instanceof Date ? value : new Date(value);

function StatusIcon({ status }: { status: ReviewStatus }) {
  const { Icon } = STATUS[status];
  return <Icon className={styles.statusIcon} data-status={status} size={14} strokeWidth={2} aria-hidden="true" />;
}

export function PlanReview({ title, meta, rows, band, countdown, readOnly = false, children }: PlanReviewProps) {
  const reduced = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLElement>(null);
  const ready = rows.filter(row => row.status === "good").length;

  // The entrance starts when the card first scrolls into view, so a capture always opens on it.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const node = rootRef.current;
    if (!node || started) return;
    if (typeof IntersectionObserver === "undefined") { const id = requestAnimationFrame(() => setStarted(true)); return () => cancelAnimationFrame(id); }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setStarted(true); observer.disconnect(); }
    }, { threshold: .35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [started]);

  // One motion value drives the arc, so a part turning ready sweeps it on.
  const score = useMotionValue(0);
  const arc = useTransform(score, value => Math.max(0, Math.min(1, value)));
  const arcOpacity = useTransform(score, value => value <= 0 ? 0 : 1);
  const target = rows.length ? ready / rows.length : 0;
  useEffect(() => {
    if (!started) return;
    if (reduced) { score.jump(target); return; }
    const controls = animate(score, target, { duration: .56, ease });
    return () => controls.stop();
  }, [started, target, reduced, score]);

  // Trak: whole days and hours to go, as the match page's own countdown counts them (04d 19h), not calendar days.
  const end = toDate(countdown.end), start = toDate(countdown.start);
  const left = end.getTime() - Date.now();
  const daysLeft = Math.floor(left / DAY), hoursLeft = Math.floor(left / HOUR);
  const termDone = Math.min(1, Math.max(0, (Date.now() - start.getTime()) / Math.max(1, end.getTime() - start.getTime())));

  return (
    <section ref={rootRef} className={styles.root} aria-label="Review & share">
      <div className={styles.top}>
        <header className={styles.identity}>
          <h3 className={styles.name}>{title}</h3>
          {meta ? <p className={styles.meta}>{meta}</p> : null}
        </header>
        <div className={styles.overview}>
          <div className={styles.scoreCell}>
            <div className={styles.gauge} role="img" aria-label={`${ready} of ${rows.length} parts ready, ${band.label.toLowerCase()}`}>
              <svg viewBox="0 0 112 60" width="112" height="60" aria-hidden="true">
                <path className={styles.gaugeTrack} d="M8 56a48 48 0 0 1 96 0" />
                <motion.path className={styles.gaugeValue} data-status={band.status} d="M8 56a48 48 0 0 1 96 0" style={{ pathLength: arc, opacity: arcOpacity }} />
              </svg>
              <span className={styles.scoreNumber} aria-hidden="true">{ready}/{rows.length}</span>
            </div>
            <div className={styles.scoreText}>
              <span className={styles.band} data-status={band.status}>
                <StatusIcon status={band.status} />
                <span className={styles.truncate}>{band.label}</span>
              </span>
              <span className={styles.trend}>{ready} of {rows.length} ready</span>
            </div>
          </div>
          <div className={styles.countdownCell}>
            <p className={styles.countdownLabel}><span className={styles.truncate}>{countdown.label}</span></p>
            <span className={styles.term} aria-hidden="true">
              <motion.span className={styles.termFill} initial={{ scaleX: 0 }} animate={{ scaleX: started ? termDone : 0 }}
                transition={reduced ? { duration: 0 } : { duration: .56, ease }} />
            </span>
            <p className={styles.days}>
              {daysLeft > 0 ? <><span className={styles.bigNumber}>{daysLeft}</span><span className={styles.unit}>{daysLeft === 1 ? "day left" : "days left"}</span></>
                : hoursLeft > 0 ? <><span className={styles.bigNumber}>{hoursLeft}</span><span className={styles.unit}>{hoursLeft === 1 ? "hour left" : "hours left"}</span></>
                : <span className={styles.unit}>{left > 0 ? "Kick-off within the hour" : "Kicked off"}</span>}
            </p>
          </div>
        </div>
      </div>

      <ul className={styles.rows} aria-label="The plan">
        {rows.map(row => <li key={row.id} className={styles.row} data-read-only={readOnly || undefined}>
          <StatusIcon status={row.status} />
          <span className={styles.rowText}>
            <span className={styles.rowLabel}>{row.label}</span>
            {row.detail ? <span className={styles.rowDetail}>{row.detail}</span> : null}
          </span>
          <span className={styles.status} data-status={row.status}>{STATUS[row.status].label}</span>
          {!readOnly && row.onEdit ? <Button variant="ghost" size="sm" aria-label={`Edit ${row.label.toLowerCase()}`} onClick={row.onEdit}>Edit</Button> : null}
        </li>)}
      </ul>

      {children ? <div className={styles.footer}>{children}</div> : null}
    </section>
  );
}

export default PlanReview;
