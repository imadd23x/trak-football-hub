// Arc Pro (uiarc.dev): adapted from the Team switcher component; licensed source, not covered by this repository's licence. See src/components/arc/PRO.md.
"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, FormEvent, KeyboardEvent, ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { ArrowLeft, Check, ChevronsUpDown, CircleAlert, Link, LoaderCircle, Plus, Search } from "lucide-react";
import { motionTokens } from "../lib/motion-tokens";
import { Button } from "../button/button";
import { Input } from "../input/input";
import { Kbd } from "../kbd/kbd";
import { TextShimmer } from "../text-shimmer/text-shimmer";
import { sampleInvites, sampleWorkspaces } from "./team-switcher-data";
import type { Workspace } from "./team-switcher-data";
import styles from "./team-switcher.module.css";

export type { Workspace } from "./team-switcher-data";
export { sampleInvites, sampleWorkspaces } from "./team-switcher-data";

export interface TeamSwitcherProps {
  /** The workspaces you belong to. The first nine get Cmd/Ctrl+1 to 9. Defaults to six sample workspaces. */
  workspaces?: Workspace[];
  /** The active workspace id. Pair with onValueChange. */
  value?: string;
  defaultValue?: string;
  /** Called once a switch has finished loading. */
  onValueChange?: (id: string, workspace: Workspace) => void;
  /** Loads the workspace. The trigger shows a switching state until it resolves; a rejection reverts and shows an error. Simulated when left out. */
  onSwitch?: (workspace: Workspace, signal: AbortSignal) => Promise<void>;
  /** Creates a workspace from a name. Return the new workspace to switch to it. Simulated when left out. */
  onCreateWorkspace?: (name: string, signal: AbortSignal) => Promise<Workspace | void>;
  /** Joins a workspace from an invite link or code. Return the workspace to switch to it; throw an Error to show its message. Simulated when left out. */
  onJoinWorkspace?: (invite: string, signal: AbortSignal) => Promise<Workspace | void>;
  /** Controls the menu. Pair with onOpenChange. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Listens for Cmd/Ctrl+1 to 9 anywhere on the page, not only while the switcher has focus. Defaults to false. */
  globalShortcuts?: boolean;
  /** How long the simulated switch takes, in milliseconds. Defaults to 650. */
  simulatedDelay?: number;
  disabled?: boolean;
  className?: string;
  /** Trak (TRAK-324): false hides Create and Join, for a list the app owns, such as a coach's squads. Defaults to true. */
  manage?: boolean;
}

type Status = "idle" | "switching" | "error";
type View = "list" | "create" | "join";

const ROW = 48;
const VISIBLE_ROWS = 6;
const enter = [...motionTokens.ease.enter] as [number, number, number, number];
const glide = { type: "spring", visualDuration: .24, bounce: 0 } as const;
const fmt = new Intl.NumberFormat("en-US");
const memberLabel = (n: number) => `${fmt.format(n)} ${n === 1 ? "member" : "members"}`;
const metaOf = (ws: Workspace) => [ws.plan, ws.members != null ? memberLabel(ws.members) : null].filter(Boolean).join(" · ");
const slugOf = (name: string) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cx = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(id); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

/** The row's top within the listbox, ignoring transforms (the panel scales in) and accounting for the scrolled list. */
function offsetWithin(el: HTMLElement, root: HTMLElement) {
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    y += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    if (parent && parent !== root) y -= parent.scrollTop;
    node = parent;
  }
  return y;
}

/** The workspace avatar: the brand mark on its brand color, or the first letter. */
export function WorkspaceTile({ workspace, size = 28 }: { workspace: Workspace; size?: number }) {
  const style = { "--tile": `${size}px`, background: workspace.tile?.background, color: workspace.tile?.color } as CSSProperties;
  return (
    <span className={cx(styles.tile, !workspace.tile && styles.tileLetter)} style={style} aria-hidden="true">
      {workspace.logo ?? <span className={styles.initial}>{workspace.name.trim().charAt(0).toUpperCase() || "W"}</span>}
    </span>
  );
}

/** One crossfade: the old content leaves in 100ms while the new one arrives in 160ms, stacked in one grid cell so nothing resizes. */
function Swap({ k, children, className, reduced }: { k: string; children: ReactNode; className?: string; reduced: boolean }) {
  return (
    <span className={cx(styles.swap, className)}>
      <AnimatePresence initial={false}>
        <motion.span key={k} className={styles.swapItem}
          initial={{ opacity: 0, y: reduced ? 0 : 2 }}
          animate={{ opacity: 1, y: 0, transition: { duration: reduced ? .1 : .16, delay: reduced ? 0 : .04, ease: enter } }}
          exit={{ opacity: 0, y: reduced ? 0 : -2, transition: { duration: .1, ease: "easeOut" } }}>
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * A workspace switcher for an app header or sidebar top, like Linear, Vercel or Slack. The trigger shows the current workspace
 * with its logo and plan; the menu searches workspaces, shows your role and a Cmd/Ctrl+number shortcut for each, and creates
 * or joins a workspace inline. A highlight glides between rows, and switching crossfades the trigger through a short loading state.
 */
export function TeamSwitcher({
  workspaces: workspacesProp, value, defaultValue, onValueChange, onSwitch, onCreateWorkspace, onJoinWorkspace,
  open: openProp, defaultOpen = false, onOpenChange, globalShortcuts = false, simulatedDelay = 650, disabled = false, className,
  manage = true,
}: TeamSwitcherProps) {
  const reduced = useReducedMotion() ?? false;
  const uid = useId();
  const panelId = `${uid}-panel`;
  const listboxId = `${uid}-listbox`;

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const switchAbort = useRef<AbortController | null>(null);
  const formAbort = useRef<AbortController | null>(null);

  // Workspaces: the given list plus any created or joined here that the parent has not added yet.
  const [added, setAdded] = useState<Workspace[]>([]);
  const workspaces = useMemo(() => {
    const base = workspacesProp ?? sampleWorkspaces;
    return [...base, ...added.filter(a => !base.some(b => b.id === a.id))];
  }, [workspacesProp, added]);
  const byId = useCallback((id: string | undefined) => workspaces.find(w => w.id === id), [workspaces]);

  const [ownValue, setOwnValue] = useState(defaultValue ?? (workspacesProp ?? sampleWorkspaces)[0]?.id);
  const currentId = value ?? ownValue;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");
  const shown = byId(pendingId ?? currentId) ?? workspaces[0];

  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = openProp ?? ownOpen;
  const [view, setView] = useState<View>("list");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(open ? `ws:${currentId}` : null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [live, setLive] = useState("");

  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  // Closing returns focus to the trigger. After a pointer pick it skips the keyboard ring (the search field had focus-visible, which carries over).
  const setOpen = useCallback((next: boolean, focusTrigger = false, viaPointer = false) => {
    if (openProp === undefined) setOwnOpen(next);
    onOpenChange?.(next);
    if (!next && focusTrigger) triggerRef.current?.focus({ preventScroll: true, focusVisible: !viaPointer } as FocusOptions);
  }, [openProp, onOpenChange]);

  // Each opening starts on the list with the current workspace highlighted.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setView("list"); setQuery(""); setActive(`ws:${currentId}`); setFormError(undefined); setBusy(false); }
  }
  useEffect(() => { if (!open) formAbort.current?.abort(); }, [open]);
  // Opening moves focus into the search field. A menu that starts open (defaultOpen) leaves focus where it is, so the page never jumps.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current) searchRef.current?.focus({ preventScroll: true });
    prevOpen.current = open;
  }, [open]);
  useEffect(() => () => { switchAbort.current?.abort(); formAbort.current?.abort(); }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => q ? workspaces.filter(w => [w.name, w.plan, w.role].some(t => t?.toLowerCase().includes(q))) : workspaces, [workspaces, q]);
  const keys = useMemo(() => [...filtered.map(w => `ws:${w.id}`), ...(manage ? ["create", "join"] : [])], [filtered, manage]);

  // Errors settle back to the plan after a moment.
  useEffect(() => {
    if (status !== "error") return;
    const id = window.setTimeout(() => setStatus("idle"), 3200);
    return () => window.clearTimeout(id);
  }, [status]);

  // Takes the workspace object, so a workspace created a moment ago can switch before it shows up in the list.
  const switchTo = useCallback(async (target: Workspace, prefix = "") => {
    if (target.id === currentId && status !== "switching") return;
    switchAbort.current?.abort();
    if (target.id === currentId) { setPendingId(null); setStatus("idle"); return; }
    const controller = new AbortController();
    switchAbort.current = controller;
    setPendingId(target.id);
    setStatus("switching");
    setLive(`${prefix}Switching to ${target.name}`);
    try {
      if (onSwitch) await onSwitch(target, controller.signal);
      else await wait(simulatedDelay, controller.signal);
      if (controller.signal.aborted) return;
      if (value === undefined) setOwnValue(target.id);
      onValueChange?.(target.id, target);
      setPendingId(null);
      setStatus("idle");
      setLive(`${prefix}Switched to ${target.name}.${onSwitch ? "" : " Simulated, nothing was loaded."}`);
    } catch (error) {
      if (controller.signal.aborted) return;
      setPendingId(null);
      setStatus("error");
      setErrorText(error instanceof Error && error.message ? error.message : "Couldn't switch, try again");
      setLive(`Couldn't switch to ${target.name}.`);
    }
  }, [currentId, status, onSwitch, simulatedDelay, value, onValueChange]);

  const choose = useCallback((id: string, viaPointer = false) => {
    setOpen(false, true, viaPointer);
    const target = byId(id);
    if (target) void switchTo(target);
  }, [setOpen, byId, switchTo]);

  const goTo = useCallback((next: View) => {
    formAbort.current?.abort();
    setBusy(false);
    setFormError(undefined);
    if (next === "create") setName(query.trim() && !filtered.length ? query.trim() : "");
    if (next === "join") setInvite("");
    setView(next);
    if (next === "list") window.requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
  }, [query, filtered.length]);

  const activate = useCallback((key: string) => {
    if (key === "create" || key === "join") goTo(key);
    else choose(key.slice(3));
  }, [goTo, choose]);

  // Cmd/Ctrl+1..9 picks a workspace by its place in the full list. The row flashes pressed for a beat when the menu is open.
  const runShortcut = useCallback((event: globalThis.KeyboardEvent | KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
    const match = /^Digit([1-9])$/.exec(event.code) ?? /^([1-9])$/.exec(event.key);
    if (!match) return false;
    const target = workspaces[Number(match[1]) - 1];
    if (!target || disabled) return false;
    event.preventDefault();
    if (open && view === "list") {
      setActive(`ws:${target.id}`);
      setPressed(`ws:${target.id}`);
      window.setTimeout(() => { setPressed(null); choose(target.id); }, reduced ? 0 : 140);
    } else {
      void switchTo(target);
    }
    return true;
  }, [workspaces, disabled, open, view, reduced, choose, switchTo]);

  useEffect(() => {
    if (!globalShortcuts) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      runShortcut(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [globalShortcuts, runShortcut]);

  // Clicks outside close the menu without moving focus.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, setOpen]);

  const onRootBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !rootRef.current?.contains(next)) setOpen(false);
  };

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (runShortcut(event)) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      if (view !== "list") goTo("list");
      else if (query) setQuery("");
      else setOpen(false, true);
    }
  };

  const keyboardMove = useRef(false);
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const index = active ? keys.indexOf(active) : -1;
    const move = (next: number) => { event.preventDefault(); keyboardMove.current = true; setActive(keys[(next + keys.length) % keys.length]); };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? keys.length - 1 : index - 1);
    else if (event.key === "Home" && !query) move(0);
    else if (event.key === "End" && !query) move(keys.length - 1);
    else if (event.key === "Enter" && active) { event.preventDefault(); activate(active); }
  };

  const onQuery = (next: string) => {
    setQuery(next);
    const nq = next.trim().toLowerCase();
    const first = workspaces.find(w => !nq || [w.name, w.plan, w.role].some(t => t?.toLowerCase().includes(nq)));
    setActive(first ? `ws:${first.id}` : "create");
  };

  // The highlight: one element that glides to the active row with a bounce-free spring. It appears in place, never from the top.
  const hlY = useMotionValue(0);
  const hlH = useMotionValue(ROW);
  const [hlClip, setHlClip] = useState("none");
  const hlVisible = useRef(false);
  const placeHighlight = useCallback((instant: boolean) => {
    const root = listboxRef.current;
    const el = active ? itemRefs.current.get(active) : undefined;
    if (!root || !el) { hlVisible.current = false; return false; }
    const y = offsetWithin(el, root);
    const h = el.offsetHeight;
    const body = bodyRef.current;
    if (body && body.contains(el)) {
      const top = body.offsetTop, bottom = top + body.clientHeight;
      setHlClip(y < top || y + h > bottom ? `inset(${Math.max(0, top - y)}px 0 ${Math.max(0, y + h - bottom)}px 0 round var(--row-radius))` : "none");
    } else setHlClip("none");
    if (instant || !hlVisible.current || reduced) { hlY.jump(y); hlH.jump(h); }
    else { animate(hlY, y, glide); animate(hlH, h, glide); }
    hlVisible.current = true;
    return true;
  }, [active, reduced, hlY, hlH]);

  // hlShown is true only while the list is open and the active row is mounted, so it also gates aria-activedescendant.
  const [hlShown, setHlShown] = useState(false);
  const listOpen = open && view === "list";
  if (!listOpen && hlShown) setHlShown(false);
  useLayoutEffect(() => {
    if (!listOpen) { hlVisible.current = false; return; }
    placeHighlight(false);
    const ok = hlVisible.current;
    setHlShown(ok);
    if (ok && keyboardMove.current && active) itemRefs.current.get(active)?.scrollIntoView({ block: "nearest" });
    keyboardMove.current = false;
  }, [listOpen, active, filtered, placeHighlight]);

  const onBodyScroll = () => placeHighlight(true);

  // Create and join. Both run the given handler or a short simulation, then switch to the new workspace.
  const runForm = async (kind: "create" | "join", event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const text = (kind === "create" ? name : invite).trim();
    if (!text) { setFormError(kind === "create" ? "Give the workspace a name" : "Paste an invite link or code"); return; }
    formAbort.current?.abort();
    const controller = new AbortController();
    formAbort.current = controller;
    setBusy(true);
    setFormError(undefined);
    try {
      let result: Workspace | void;
      if (kind === "create") {
        result = onCreateWorkspace ? await onCreateWorkspace(text, controller.signal) : (await wait(600, controller.signal), { id: `ws-${slugOf(text) || "new"}-${Date.now().toString(36)}`, name: text, plan: "Free", members: 1, role: "Owner" });
      } else if (onJoinWorkspace) {
        result = await onJoinWorkspace(text, controller.signal);
      } else {
        await wait(600, controller.signal);
        result = resolveInvite(text, workspaces);
      }
      if (controller.signal.aborted) return;
      setBusy(false);
      if (!result) { setOpen(false, true); return; }
      const ws = result;
      const handled = kind === "create" ? onCreateWorkspace : onJoinWorkspace;
      setAdded(list => list.some(w => w.id === ws.id) ? list : [...list, ws]);
      setOpen(false, true);
      void switchTo(ws, `${kind === "create" ? "Created" : "Joined"} ${ws.name}${handled ? "" : " (simulated, nothing was sent)"}. `);
    } catch (error) {
      if (controller.signal.aborted) return;
      setBusy(false);
      setFormError(error instanceof Error && error.message ? error.message : "Something went wrong, try again");
    }
  };

  const nextSampleInvite = sampleInvites.find(s => !workspaces.some(w => w.id === s.workspace.id));
  const invitePreview = useMemo(() => {
    const text = invite.trim();
    if (!text) return null;
    try { return resolveInvite(text, []); } catch { return null; }
  }, [invite]);

  const triggerStatus = status === "switching" ? "switching" : status === "error" ? "error" : "idle";
  const draft: Workspace = { id: "draft", name: name.trim() || "Untitled workspace", plan: "Free", members: 1 };
  const panelMotion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: .12 } }, exit: { opacity: 0, transition: { duration: .1 } } }
    : { initial: { opacity: 0, y: -4, scale: .98 }, animate: { opacity: 1, y: 0, scale: 1, transition: { duration: .18, ease: enter } }, exit: { opacity: 0, y: -4, scale: .98, transition: { duration: .12, ease: "easeIn" as const } } };
  const viewMotion = (dir: 1 | -1) => ({
    initial: { opacity: 0, x: reduced ? 0 : 6 * dir },
    animate: { opacity: 1, x: 0, transition: { duration: .16, delay: .04, ease: enter } },
    exit: { opacity: 0, x: reduced ? 0 : -6 * dir, transition: { duration: .1, ease: "easeOut" as const } },
  });

  const activeId = active && hlShown ? `${uid}-${active}` : undefined;
  // Trak (TRAK-324): a short list the app owns (a coach's squads) gets a menu its own height, with no action rows.
  const rows = manage ? VISIBLE_ROWS : Math.max(1, Math.min(VISIBLE_ROWS, workspaces.length));
  const bodyStyle = { "--rows": rows, "--row": `${ROW}px` } as CSSProperties;
  const rootStyle = manage ? undefined : { "--panel-h": `${48 + rows * ROW + 8 + 1}px` } as CSSProperties;

  return (
    <div ref={rootRef} className={cx(styles.root, className)} style={rootStyle} data-manage={manage ? undefined : "false"} onKeyDown={onRootKeyDown} onBlur={onRootBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-busy={status === "switching" || undefined}
        aria-label={`Squad: ${shown?.name ?? "none"}. ${status === "switching" ? "Switching." : metaOf(shown ?? { id: "", name: "" })}`}
        disabled={disabled}
        data-open={open || undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={event => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); } }}
      >
        {shown && <Swap k={shown.id} reduced={reduced} className={styles.triggerTile}><WorkspaceTile workspace={shown} size={32} /></Swap>}
        <span className={styles.triggerText}>
          <Swap k={shown?.id ?? "none"} reduced={reduced} className={styles.triggerName}><span className={styles.truncate}>{shown?.name}</span></Swap>
          <Swap k={`${triggerStatus}:${shown?.id}`} reduced={reduced} className={styles.triggerMeta}>
            {triggerStatus === "switching" ? <TextShimmer className={styles.truncate}>Switching squad</TextShimmer>
              : triggerStatus === "error" ? <span className={styles.errorLine}><CircleAlert size={14} aria-hidden="true" /><span className={styles.truncate}>{errorText}</span></span>
              : <span className={styles.truncate}>{shown ? metaOf(shown) : ""}</span>}
          </Swap>
        </span>
        <Swap k={triggerStatus === "switching" ? "spin" : "chevron"} reduced={reduced} className={styles.triggerEnd}>
          {triggerStatus === "switching" ? <LoaderCircle size={16} className={styles.spin} aria-hidden="true" /> : <ChevronsUpDown size={16} aria-hidden="true" />}
        </Swap>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div key="panel" id={panelId} role="dialog" aria-label="Switch squad" className={styles.panel} data-frame-keep="" {...panelMotion}>
            <AnimatePresence initial={false}>
              {view === "list" ? (
                <motion.div key="list" className={styles.view} {...viewMotion(-1)}>
                  <div className={styles.searchRow}>
                    <Search size={16} className={styles.searchIcon} aria-hidden="true" />
                    <input
                      ref={searchRef}
                      className={styles.search}
                      value={query}
                      onChange={event => onQuery(event.target.value)}
                      onKeyDown={onSearchKeyDown}
                      placeholder="Find a squad"
                      aria-label="Find a squad"
                      role="combobox"
                      aria-expanded="true"
                      aria-controls={listboxId}
                      aria-autocomplete="list"
                      aria-activedescendant={activeId}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </div>
                  <div ref={listboxRef} id={listboxId} role="listbox" aria-label="Squads" className={styles.listbox}>
                    <motion.div
                      className={styles.highlight}
                      aria-hidden="true"
                      data-pressed={pressed ? true : undefined}
                      style={{ y: hlY, height: hlH, clipPath: hlClip }}
                      initial={false}
                      animate={{ opacity: hlShown ? 1 : 0 }}
                      transition={{ duration: .12 }}
                    />
                    <div ref={bodyRef} role="group" aria-label="Squads" className={styles.body} style={bodyStyle} onScroll={onBodyScroll}>
                      {filtered.map(ws => {
                        const key = `ws:${ws.id}`;
                        const index = workspaces.indexOf(ws);
                        const current = ws.id === currentId;
                        return (
                          <div
                            key={ws.id}
                            id={`${uid}-${key}`}
                            ref={node => { if (node) itemRefs.current.set(key, node); else itemRefs.current.delete(key); }}
                            role="option"
                            aria-selected={current}
                            data-active={active === key || undefined}
                            className={styles.row}
                            onPointerMove={() => { if (active !== key) setActive(key); }}
                            onPointerDown={event => { event.preventDefault(); setPressed(key); }}
                            onPointerUp={() => setPressed(null)}
                            onPointerLeave={() => setPressed(p => p === key ? null : p)}
                            onClick={() => choose(ws.id, true)}
                          >
                            <WorkspaceTile workspace={ws} size={28} />
                            <span className={styles.rowText}>
                              <span className={cx(styles.rowName, styles.truncate)}>{ws.name}</span>
                              <span className={cx(styles.rowMeta, styles.truncate)}>{metaOf(ws)}</span>
                            </span>
                            {ws.role && <span className={styles.role}>{ws.role}</span>}
                            <span className={styles.slot}>
                              {current ? <Check size={16} className={styles.check} aria-label="Current squad" />
                                : manage && index < 9 ? <Kbd keys={`mod+${index + 1}`} size="sm" pressed={pressed === key} aria-hidden="true" /> : null}
                            </span>
                          </div>
                        );
                      })}
                      {!filtered.length && (
                        <div className={styles.empty} role="presentation">
                          <span className={styles.emptyTitle}>No squads match “{query.trim()}”</span>
                          {manage && <span className={styles.emptyHint}>Press Enter to create it</span>}
                        </div>
                      )}
                    </div>
                    {manage && <div role="group" aria-label="Actions" className={styles.footer}>
                      {([["create", "Create workspace", Plus], ["join", "Join with invite", Link]] as const).map(([key, label, Icon]) => (
                        <div
                          key={key}
                          id={`${uid}-${key}`}
                          ref={node => { if (node) itemRefs.current.set(key, node); else itemRefs.current.delete(key); }}
                          role="option"
                          aria-selected={false}
                          data-active={active === key || undefined}
                          className={styles.action}
                          onPointerMove={() => { if (active !== key) setActive(key); }}
                          onPointerDown={event => { event.preventDefault(); setPressed(key); }}
                          onPointerUp={() => setPressed(null)}
                          onPointerLeave={() => setPressed(p => p === key ? null : p)}
                          onClick={() => goTo(key)}
                        >
                          <span className={styles.actionIcon}><Icon size={16} aria-hidden="true" /></span>
                          <span className={styles.truncate}>{label}</span>
                        </div>
                      ))}
                    </div>}
                  </div>
                </motion.div>
              ) : (
                <motion.form key={view} className={styles.view} onSubmit={event => runForm(view, event)} noValidate {...viewMotion(1)}>
                  <div className={styles.formHead}>
                    <Button type="button" variant="ghost" size="sm" className={styles.back} onClick={() => goTo("list")} aria-label="Back to workspaces"><ArrowLeft size={16} aria-hidden="true" /></Button>
                    <span className={styles.formTitle}>{view === "create" ? "Create workspace" : "Join with invite"}</span>
                  </div>
                  <div className={styles.formBody}>
                    {view === "create" ? (
                      <>
                        <div className={styles.preview}>
                          <Swap k={draft.name.charAt(0).toUpperCase()} reduced={reduced}><WorkspaceTile workspace={draft} size={40} /></Swap>
                          <span className={styles.rowText}>
                            <span className={cx(styles.rowName, styles.truncate, !name.trim() && styles.placeholderName)}>{draft.name}</span>
                            <span className={cx(styles.rowMeta, styles.truncate)}>{name.trim() ? `/${slugOf(name) || "workspace"}` : "Free plan"} · You are the owner</span>
                          </span>
                        </div>
                        <Input label="Workspace name" autoFocus value={name} maxLength={48} placeholder="Northwind Labs" autoComplete="off" error={formError}
                          onChange={event => { setName(event.target.value); if (formError) setFormError(undefined); }} />
                      </>
                    ) : (
                      <>
                        <div className={styles.preview}>
                          {invitePreview
                            ? <Swap k={invitePreview.id} reduced={reduced}><WorkspaceTile workspace={invitePreview} size={40} /></Swap>
                            : <span className={styles.tileEmpty} aria-hidden="true" />}
                          <span className={styles.rowText}>
                            <Swap k={invitePreview?.id ?? "none"} reduced={reduced}>
                              <span className={cx(styles.rowName, styles.truncate, !invitePreview && styles.placeholderName)}>{invitePreview?.name ?? "No invite yet"}</span>
                            </Swap>
                            <Swap k={`m:${invitePreview?.id ?? "none"}`} reduced={reduced}>
                              <span className={cx(styles.rowMeta, styles.truncate)}>{invitePreview ? `Invited as ${invitePreview.role ?? "Member"} · ${invitePreview.members != null ? memberLabel(invitePreview.members) : "Pending"}` : "Paste a link to preview the workspace"}</span>
                            </Swap>
                          </span>
                        </div>
                        <Input label="Invite link or code" autoFocus value={invite} placeholder="https://resend.com/invite/…" autoComplete="off" spellCheck={false} error={formError}
                          onChange={event => { setInvite(event.target.value); if (formError) setFormError(undefined); }} />
                        {!onJoinWorkspace && (
                          <button type="button" className={styles.sample} disabled={!nextSampleInvite}
                            onClick={() => { if (nextSampleInvite) { setInvite(nextSampleInvite.link); setFormError(undefined); } }}>
                            {nextSampleInvite ? "Use a sample invite" : "Sample invites used"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div className={styles.formFoot}>
                    <Button type="button" variant="ghost" size="sm" onClick={() => goTo("list")}>Cancel</Button>
                    <Button type="submit" variant="primary" size="sm" loading={busy}>
                      {view === "create" ? (busy ? "Creating" : "Create workspace") : (busy ? "Joining" : "Join workspace")}
                    </Button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <span className={styles.srOnly} role="status" aria-live="polite">{live}</span>
    </div>
  );
}

/** The simulated invite resolver: the sample links map to real workspaces, any other invite URL becomes a workspace named after its host. */
function resolveInvite(text: string, existing: Workspace[]): Workspace {
  const sample = sampleInvites.find(s => s.link.toLowerCase() === text.toLowerCase());
  let ws: Workspace | undefined = sample?.workspace;
  if (!ws) {
    let url: URL | null = null;
    try { url = new URL(text.includes("://") ? text : `https://${text}`); } catch { url = null; }
    if (!url || !/invite|join/i.test(url.pathname) || !url.hostname.includes(".")) throw new Error("That doesn't look like an invite link");
    const host = url.hostname.replace(/^www\./, "").split(".")[0] ?? "";
    const label = host.charAt(0).toUpperCase() + host.slice(1);
    ws = { id: `ws-${slugOf(label)}`, name: label, plan: "Team", role: "Member" };
  }
  if (existing.some(w => w.id === ws.id)) throw new Error(`You're already in ${ws.name}`);
  return ws;
}

export default TeamSwitcher;
