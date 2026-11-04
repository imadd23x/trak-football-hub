// Arc Pro (uiarc.dev): adapted from the Team directory block; licensed source, not covered by this repository's licence. See src/components/arc/PRO.md.
"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { PlayerFace } from "@/components/trak/PlayerFace";
import { GlassSegmented } from "../../glass-segmented/glass-segmented";
import { Sparkline } from "../../sparkline/sparkline";
import { motionTokens } from "../../lib/motion-tokens";
import { BANDS } from "@/lib/types";
import styles from "./squad-directory.module.css";

export type PositionGroup = "GK" | "DEF" | "MID" | "ATT";

export interface SquadPlayer {
  id: string;
  name: string;
  /** "Midfielder", or empty. */
  position: string;
  /** null: no position the filters know; the player shows under All only. */
  group: PositionGroup | null;
  shirt: number | null;
  /** Latest band word, or null before a first assessment. */
  band: string | null;
  /** Against the player's own previous assessment. */
  move: -1 | 0 | 1;
  /** Trak: waiting for consent, so nothing can be recorded about them yet. */
  waiting?: boolean;
  /** Trak (TRAK-266): what the coach still owes this player, as a badge in the colour key. */
  flag?: ReactNode;
  /** Trak (Imad, 23 Oct): overall ratings, oldest first, drawn as the row's sparkline. */
  trend?: number[];
}

const FILTERS = ["All", "GK", "DEF", "MID", "ATT"] as const;
type Filter = (typeof FILTERS)[number];

export function BandChip({ band, move = 0, waiting = false }: { band: string | null; move?: -1 | 0 | 1; waiting?: boolean }) {
  const config = BANDS.find(entry => entry.word === band);
  if (waiting) return <span className={styles.chip} data-empty="">Waiting for consent</span>;
  if (!config) return <span className={styles.chip} data-empty="">Not assessed</span>;
  return <span className={styles.chip} style={{ background: config.bg, borderColor: config.border, color: config.text }}>
    {config.word}
    {move === 1 && <ArrowUp size={12} strokeWidth={2.2} aria-label="up" />}
    {move === -1 && <ArrowDown size={12} strokeWidth={2.2} aria-label="down" />}
  </span>;
}

/**
 * The squad overview (Imad, 22 Oct: Arc's team directory). Filter by position, search by name or shirt number, and
 * pick a player to open their profile. Trak (TRAK-351, Tarek 3 Nov): the profile is the player's own full page, with
 * no list beside it, so a row hands the player to `onOpen`. The filter and search stay as left while the page is open.
 */
export function SquadDirectory({ title, players, summary, onOpen }: {
  title: string;
  players: SquadPlayer[];
  /** Above the list, such as the band spread. */
  summary?: ReactNode;
  onOpen: (player: SquadPlayer) => void;
}) {
  const uid = useId();
  const reduce = useReducedMotion();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");

  const needle = query.trim().toLowerCase();
  const visible = players.filter(player => (filter === "All" || player.group === filter) && `${player.name} ${player.position} ${player.shirt ?? ""}`.toLowerCase().includes(needle));

  function reset() {
    setQuery("");
    setFilter("All");
    searchRef.current?.focus();
  }

  const listTransition = reduce ? { duration: 0 } : motionTokens.spring.smooth;

  return <section className={`arc ${styles.directory}`} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}>
      <h2 id={`${uid}-title`}>{title} <span className={styles.count}>{players.length}</span></h2>
      <label className={styles.search}>
        <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className={styles.srOnly}>Search players</span>
        <input ref={searchRef} type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }} placeholder="Search name or number" />
        <span className={styles.clearSlot}>{query && <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Clear search"><X size={14} strokeWidth={1.75} aria-hidden="true" /></button>}</span>
      </label>
    </header>

    {/* Trak (TRAK-266, Imad, 22 Oct): the position filters as they were before #420, on Arc's glass segmented control. */}
    <div className={styles.filters}>
      <GlassSegmented label="Filter by position" size="sm" fullWidth value={filter} onValueChange={value => setFilter(value as Filter)}
        options={FILTERS.map(item => ({ value: item, label: item }))} />
    </div>
    {summary && <div className={styles.summary}>{summary}</div>}

    <div className={styles.body}>
      <div className={styles.listPane}>
        <ul className={styles.peopleList} aria-label="Players">
          <AnimatePresence mode="popLayout" initial={false}>
            {visible.map(player => {
              return <motion.li key={player.id} layout={reduce ? false : "position"} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: reduce ? 0 : motionTokens.duration.exit } }}
                transition={{ layout: listTransition, opacity: { duration: reduce ? 0 : motionTokens.duration.fast } }}>
                <button type="button" className={styles.personRow} onClick={() => onOpen(player)}>
                  <PlayerFace name={player.name} />
                  <span className={styles.personText}><span className={styles.personName}>{player.name}</span><span className={styles.personRole}>{player.position}{player.shirt != null ? ` · #${player.shirt}` : ""}</span></span>
                  {player.flag}
                  {/* Trak (Imad, 23 Oct): a sparkline of the player's ratings in place of the band chip; under two there's no line. */}
                  {player.waiting ? <BandChip band={null} waiting />
                    : player.trend && player.trend.length >= 2 ? <span className={styles.trend}>
                      <Sparkline data={player.trend} label={`${player.name}'s last ${player.trend.length} ratings`}
                        value={player.trend.map(score => score.toFixed(1)).join(", ")} width={64} height={24} area={false} interactive={false} />
                    </span> : null}
                </button>
              </motion.li>;
            })}
          </AnimatePresence>
        </ul>
        {visible.length === 0 && <div className={styles.empty}>
          <p>No one matches{needle ? ` “${query.trim()}”` : ""}</p>
          <button type="button" onClick={reset}>Clear filters</button>
        </div>}
      </div>
    </div>
  </section>;
}

export default SquadDirectory;
