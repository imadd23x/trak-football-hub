// Arc Pro (uiarc.dev): adapted from the Release readiness block; licensed source, not covered by this repository's licence. See src/components/arc/PRO.md.
"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Circle, CircleCheck } from "lucide-react";
import { Button } from "../../button/button";
import { Checkbox } from "../../checkbox/checkbox";
import { SplitButton, type SplitButtonAction } from "../../split-button/split-button";
import { motionTokens } from "../../lib/motion-tokens";
import styles from "./share-readiness.module.css";

/* Trak (TRAK-286): the Game plan's Share step. Checks come from the caller: one the coach ticks (onCheckedChange), the
   rest worked out from the plan and shown as done or not. Only `required` checks hold the action back (Imad, 28 Oct);
   the bar turns green when every check is done. No owners and no notify switch: sharing is in the app only. TRAK-290:
   the action may offer alternatives behind a chevron (Arc's split-button: "Share now · Share at…"), and what an
   alternative opens sits under the footer. TRAK-318: with no action, the card only lists the checks; the Game plan's
   bottom bar then holds the action beside Save draft. */

export interface ReadinessCheck {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  /** Holds the action back until done. */
  required?: boolean;
  /** A check the coach ticks. Without it, the check shows what's done elsewhere. */
  onCheckedChange?: (done: boolean) => void;
}

export interface ShareReadinessProps {
  title: string;
  subtitle: string;
  checks: ReadinessCheck[];
  /** Without one, there's no footer: the caller places the action. */
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
  /** Why the action failed; shown under the footer. */
  error?: string | null;
  /** Close variants of the action, behind the chevron; the same checks hold them back. */
  alternatives?: SplitButtonAction[];
  /** What an alternative opens, under the footer. */
  children?: ReactNode;
}

export function ShareReadiness({ title, subtitle, checks, actionLabel, onAction, busy = false, error, alternatives, children }: ShareReadinessProps) {
  const id = useId();
  const reduce = !!useReducedMotion();
  const ready = checks.filter(check => check.done).length;
  const left = checks.filter(check => check.required && !check.done).length;

  return (
    <section className={styles.release} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </header>

      <div className={styles.progress}>
        <div className={styles.progressMeta}>
          <span aria-live="polite">{left ? `${left} ${left === 1 ? "check" : "checks"} before you can share` : "Ready to share"}</span>
          <span className={styles.count}>{ready} of {checks.length}</span>
        </div>
        <div className={styles.track} role="progressbar" aria-label="Readiness" aria-valuemin={0} aria-valuemax={checks.length} aria-valuenow={ready}>
          <span className={styles.fill} data-complete={ready === checks.length || undefined} style={{ transform: `translateX(${(ready / checks.length - 1) * 100}%)` }} />
        </div>
      </div>

      <ul className={styles.tasks} aria-label="Before you share">
        {checks.map(check => (
          <li key={check.id} className={styles.task} data-done={check.done || undefined}>
            {check.onCheckedChange
              ? <Checkbox id={`${id}-${check.id}`} checked={check.done} onCheckedChange={value => check.onCheckedChange?.(value === true)} aria-label={check.label} aria-describedby={`${id}-${check.id}-detail`} />
              : <span className={styles.status} data-done={check.done || undefined}>
                  {check.done ? <CircleCheck size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}
                </span>}
            {check.onCheckedChange
              ? <label htmlFor={`${id}-${check.id}`} className={styles.taskCopy}>
                  <span className={styles.taskLabel}>{check.label}</span>
                  <span id={`${id}-${check.id}-detail`} className={styles.taskDetail}>{check.detail}</span>
                </label>
              : <span className={styles.taskCopy}>
                  <span className={styles.taskLabel}>{check.label}<span className="sr-only">{check.done ? ": done" : ": not yet"}</span></span>
                  <span className={styles.taskDetail}>{check.detail}</span>
                </span>}
          </li>
        ))}
      </ul>

      {onAction && actionLabel && <footer className={styles.footer}>
        <div className={styles.footerActions}>
          {alternatives?.length
            ? <SplitButton label={busy ? "Sharing…" : actionLabel} onClick={onAction} disabled={left > 0 || busy}
                actions={alternatives.map(alternative => ({ ...alternative, disabled: alternative.disabled || left > 0 }))} />
            : <Button size="sm" disabled={left > 0} loading={busy} onClick={onAction}>{actionLabel}<ArrowRight size={16} aria-hidden="true" /></Button>}
        </div>
      </footer>}
      {children && <div className={styles.extra}>{children}</div>}

      {/* The message opens its own row: the card grows on a spring instead of snapping taller. */}
      <AnimatePresence initial={false}>
        {error && (
          <motion.div
            key="message"
            className={styles.message}
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } }}
          >
            <p className={styles.error} role="alert">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
