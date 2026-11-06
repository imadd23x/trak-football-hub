// Arc Pro (uiarc.dev): adapted from the Account health block; licensed source, not covered by this repository's licence. See src/components/arc/PRO.md.
"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "../../button/button";
import { Countdown } from "../../countdown/countdown";
import { motionTokens } from "../../lib/motion-tokens";
import styles from "./plan-review.module.css";

/* Trak (TRAK-332, Imad 2 Nov): Review & share. Account health's card (a gauge, a countdown, signal rows, one next step)
   reads a game plan instead of a customer: the gauge counts the parts that are ready, the countdown runs to kick-off,
   each row is a part of the plan with its own Edit, and the footer holds what shares it. No time ranges, no sparklines
   and no AI summary: Trak has no history to draw and no AI writing it. TRAK-344 (Imad, 3 Nov): each part's status is
   its icon, a word only for screen readers. TRAK-369 (Imad, 4 Nov): the top row is two halves, the gauge with what's
   left under it, and Arc's countdown. TRAK-373 (Imad, 5 Nov): after kick-off, `aside` takes the countdown's half (the
   match clock, then "Locked"). TRAK-375: with neither, the gauge has the row to itself (Evaluation review). */

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
  /** The card's name: "Game plan review". */
  title: string;
  rows: ReviewRow[];
  /** The gauge's word: "Ready to share", "3 incomplete". */
  band: { status: ReviewStatus; label: string };
  /** The countdown: its label ("Kick-off in"), kick-off, and what it says once kick-off has passed. */
  countdown?: { label: string; end: Date | string; completeLabel: string };
  /** In the countdown's half instead, such as the match clock. */
  aside?: ReactNode;
  /** Read only: the rows have no Edit. */
  readOnly?: boolean;
  /** What shares the plan, under the rows. */
  children?: ReactNode;
  /** Trak (match header, 6 Nov): the footer's id, so the header's Review button can bring it into view. */
  footerId?: string;
}

const ease = [...motionTokens.ease.enter] as [number, number, number, number];
const STATUS: Record<ReviewStatus, { label: string; Icon: typeof CircleCheck }> = {
  good: { label: "Ready", Icon: CircleCheck },
  watch: { label: "Incomplete", Icon: CircleAlert },
  risk: { label: "Needed", Icon: TriangleAlert },
};

/** A status as its icon. `spoken`: screen readers hear the status's word, as a row shows none. */
function StatusIcon({ status, spoken = false }: { status: ReviewStatus; spoken?: boolean }) {
  const { Icon, label } = STATUS[status];
  return <Icon className={styles.statusIcon} data-status={status} size={14} strokeWidth={2}
    {...(spoken ? { role: "img", "aria-label": label } : { "aria-hidden": true })} />;
}

export function PlanReview({ title, rows, band, countdown, aside, readOnly = false, children, footerId }: PlanReviewProps) {
  const reduced = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLElement>(null);
  const titleId = useId();
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

  return (
    <section ref={rootRef} className={styles.root} aria-labelledby={titleId}>
      <div className={styles.top}>
        <h3 id={titleId} className={styles.name}>{title}</h3>
        <div className={styles.overview} data-single={aside || countdown ? undefined : ""}>
          <div className={styles.cell}>
            <div className={styles.gauge} role="img" aria-label={`${ready} of ${rows.length} parts ready, ${band.label.toLowerCase()}`}>
              <svg viewBox="0 0 112 60" width="112" height="60" aria-hidden="true">
                <path className={styles.gaugeTrack} d="M8 56a48 48 0 0 1 96 0" />
                <motion.path className={styles.gaugeValue} data-status={band.status} d="M8 56a48 48 0 0 1 96 0" style={{ pathLength: arc, opacity: arcOpacity }} />
              </svg>
              <span className={styles.scoreNumber} aria-hidden="true">{ready}/{rows.length}</span>
            </div>
            <span className={styles.band} data-status={band.status}>
              <StatusIcon status={band.status} />
              <span>{band.label}</span>
            </span>
          </div>
          {aside ? <div className={`${styles.cell} ${styles.countdownCell}`}>{aside}</div>
            : countdown ? <div className={`${styles.cell} ${styles.countdownCell}`}>
            {/* The timer is named by the same words, so they're said once. */}
            <p className={styles.countdownLabel} aria-hidden="true">{countdown.label}</p>
            <Countdown className={styles.countdown} target={countdown.end} units={["days", "hours", "minutes"]}
              label={countdown.label} completeLabel={countdown.completeLabel} />
          </div> : null}
        </div>
      </div>

      <ul className={styles.rows} aria-label="The plan">
        {rows.map(row => <li key={row.id} className={styles.row} data-read-only={readOnly || undefined}>
          <StatusIcon status={row.status} spoken />
          <span className={styles.rowText}>
            <span className={styles.rowLabel}>{row.label}</span>
            {row.detail ? <span className={styles.rowDetail}>{row.detail}</span> : null}
          </span>
          {!readOnly && row.onEdit ? <Button variant="ghost" size="sm" aria-label={`Edit ${row.label.toLowerCase()}`} onClick={row.onEdit}>Edit</Button> : null}
        </li>)}
      </ul>

      {children ? <div id={footerId} className={styles.footer}>{children}</div> : null}
    </section>
  );
}

export default PlanReview;
