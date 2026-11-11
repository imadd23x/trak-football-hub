// Arc Pro (uiarc.dev): adapted from the Settings page block; licensed source, not covered by this repository's licence. See src/components/arc/PRO.md.
"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { AnimatePresence, LayoutGroup, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { MotionValue } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { AnimatedCounter } from "../../animated-counter/animated-counter";
import { Button } from "../../button/button";
import { TextMorph } from "../../text-morph/text-morph";
import { motionTokens } from "../../lib/motion-tokens";
import styles from "./settings-page.module.css";
import { useTranslation } from "@/lib/i18n";

export interface SettingsSection {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  content: ReactNode;
  /** Unsaved changes in this section: a dot in the menu. */
  pending?: number;
}

export interface SaveBarProps {
  state: "edit" | "saving" | "saved" | null;
  count: number;
  onSave: () => void;
  onDiscard: () => void;
}

const blur = (px: number) => `blur(${px}px)`;
const enterEase = [...motionTokens.ease.enter] as [number, number, number, number];

/** The bar grows out of a small puck, then its width and height follow whatever it holds, so saving shrinks it into a confirmation. */
function SaveBar({ state, count, onDiscard, onSave, shake, barRef }: { state: "edit" | "saving" | "saved"; count: number; onDiscard: () => void; onSave: () => void; shake: MotionValue<number>; barRef: RefObject<HTMLDivElement> }) {
  // TRAK-406: the bar's words in the language showing.
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const content = useRef<HTMLDivElement>(null);
  const width = useMotionValue(52);
  const height = useMotionValue(52);
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    const measure = () => {
      const next = { width: node.offsetWidth + 2, height: node.offsetHeight + 2 };
      if (reduce) { width.jump(next.width); height.jump(next.height); return; }
      animate(width, next.width, motionTokens.spring.morph);
      animate(height, next.height, motionTokens.spring.morph);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [height, reduce, width]);
  const phase = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : { initial: { opacity: 0, scale: .96, filter: blur(motionTokens.blur.soft) }, animate: { opacity: 1, scale: 1, filter: blur(0) }, exit: { opacity: 0, scale: .96, filter: blur(motionTokens.blur.soft) } };
  const phaseTransition = { duration: reduce ? motionTokens.duration.instant : motionTokens.duration.standard, ease: enterEase };
  return <motion.div ref={barRef} className={styles.bar} role="group" aria-label={state === "saved" ? t("common:saveStatus") : t("common:unsavedChanges")} style={{ width, height, x: shake }}
    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 28, filter: blur(motionTokens.blur.soft) }} animate={{ opacity: 1, y: 0, filter: blur(0) }}
    exit={reduce ? { opacity: 0, transition: { duration: motionTokens.duration.instant } } : { opacity: 0, y: 20, width: 52, height: 52, filter: blur(motionTokens.blur.soft), transition: { width: motionTokens.spring.smooth, height: motionTokens.spring.smooth, y: { ...motionTokens.spring.smooth, delay: .06 }, opacity: { duration: motionTokens.duration.exit, delay: .1 }, filter: { duration: motionTokens.duration.exit, delay: .1 } } }}
    transition={reduce ? { duration: motionTokens.duration.instant } : { y: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast }, filter: { duration: motionTokens.duration.standard } }}>
    <div ref={content} className={styles.barContent}>
      <AnimatePresence mode="popLayout" initial={false}>
        {state === "saved"
          ? <motion.div key="saved" className={styles.barSaved} {...phase} transition={phaseTransition}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><motion.path d="M5 12.5 9.5 17 19 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduce ? 0 : .34, delay: reduce ? 0 : .08, ease: enterEase }} /></svg>
            <span>{t("common:changesSaved")}</span>
          </motion.div>
          : <motion.div key="edit" className={styles.barEdit} {...phase} transition={phaseTransition}>
            <span className={styles.barCount}><span className={styles.inherit}><AnimatedCounter value={count} /></span><span className={styles.unsaved}>{t("common:unsaved", { count }).replace(" ", "\u00a0")}</span>&nbsp;<TextMorph>{t("common:change", { count })}</TextMorph></span>
            <Button type="button" variant="ghost" size="sm" disabled={state === "saving"} onClick={onDiscard}>{t("common:discard")}</Button>
            <Button type="button" size="sm" loading={state === "saving"} onClick={onSave}>{state === "saving" ? t("common:saving") : <span>{t("common:save")}<span className={styles.long}>{t("common:saveLong").replace(" ", "\u00a0")}</span></span>}</Button>
          </motion.div>}
      </AnimatePresence>
    </div>
  </motion.div>;
}

/**
 * Trak's Settings on Arc's settings page (Imad, 22 Oct), for every role. Every section is on one page, so nothing is
 * hidden behind the menu: the menu jumps to a section and marks the one in view. The save bar appears only when
 * something changed.
 */
export function SettingsPage({ title, sections, bar }: { title: string; sections: SettingsSection[]; bar?: SaveBarProps }) {
  const { t } = useTranslation();
  const id = useId();
  const navGroup = useId();
  const reduce = useReducedMotion();
  const [current, setCurrent] = useState(sections[0]?.id);
  const navButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const barRef = useRef<HTMLDivElement>(null);
  const shake = useMotionValue(0);
  const sectionId = (section: string) => `${id}-${section}`;
  const keys = sections.map(section => section.id).join(",");

  // The section in view is the one under the top third of the window.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      const seen = entries.filter(entry => entry.isIntersecting).map(entry => entry.target.getAttribute("data-section"));
      if (seen[0]) setCurrent(seen[0]);
    }, { rootMargin: "-25% 0px -65% 0px" });
    for (const section of keys.split(",")) {
      const node = document.getElementById(sectionId(section));
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sectionId depends only on id
  }, [keys, id]);

  // When the bar's buttons leave (saved or discarded), keep keyboard focus in the page.
  useEffect(() => {
    if (bar?.state === "edit" || bar?.state === "saving") return;
    if (barRef.current?.contains(document.activeElement)) document.getElementById(`${id}-title`)?.focus({ preventScroll: true });
  }, [bar?.state, id]);

  function go(next: string) {
    setCurrent(next);
    const node = document.getElementById(sectionId(next));
    node?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
    node?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }

  function onNavKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const steps: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    const next = event.key in steps ? (index + steps[event.key] + sections.length) % sections.length : event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    navButtons.current[next]?.focus();
    setCurrent(sections[next].id);
  }

  return (
    <section className={`arc ${styles.root}`} aria-labelledby={`${id}-title`}
      onKeyDown={event => { if (bar?.state === "edit" && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); bar.onSave(); } }}>
      <div className={styles.settings}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHead}>
            <h1 id={`${id}-title`} tabIndex={-1}>{title}</h1>
          </div>
          <LayoutGroup id={navGroup}>
            <nav aria-label={t("common:settingsSections")}>
              <ul className={styles.navList}>
                {sections.map((item, index) => {
                  const Icon = item.icon, pending = item.pending ?? 0;
                  return <li key={item.id}>
                    <button ref={node => { navButtons.current[index] = node; }} type="button" className={styles.navItem} aria-current={current === item.id ? "true" : undefined}
                      onClick={() => go(item.id)} onKeyDown={event => onNavKey(event, index)}>
                      {current === item.id && <motion.span layoutId="settings-section" className={styles.highlight} transition={reduce ? { duration: 0 } : motionTokens.spring.morph} aria-hidden="true" />}
                      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                      <span className={styles.navLabel}>{item.label}</span>
                      <AnimatePresence initial={false}>{pending > 0 && <motion.span key="dot" className={styles.navDot} aria-hidden="true" initial={{ opacity: 0, scale: .2 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .2 }} transition={reduce ? { duration: 0 } : motionTokens.spring.snappy} />}</AnimatePresence>
                      {pending > 0 && <span className={styles.srOnly}>, {pending} unsaved</span>}
                    </button>
                  </li>;
                })}
              </ul>
            </nav>
          </LayoutGroup>
        </aside>

        <div className={styles.main}>
          {sections.map(item => <section key={item.id} id={sectionId(item.id)} data-section={item.id} className={styles.pane} aria-labelledby={`${sectionId(item.id)}-heading`}>
            <header className={styles.paneHead}>
              <h2 id={`${sectionId(item.id)}-heading`} tabIndex={-1}>{item.label}</h2>
              <p>{item.description}</p>
            </header>
            {item.content}
          </section>)}

          <div className={styles.dock}>
            <AnimatePresence>
              {bar?.state && <SaveBar key="bar" barRef={barRef} state={bar.state} count={bar.count} shake={shake} onDiscard={bar.onDiscard} onSave={bar.onSave} />}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A label and its value, one row of a section. */
export function SettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.row}><span className={styles.rowLabel}>{label}</span><span className={styles.rowValue}>{children}</span></div>;
}

/** Rows with a hairline between them. */
export function SettingsRows({ children }: { children: ReactNode }) {
  return <div className={styles.rows}>{children}</div>;
}

export default SettingsPage;
