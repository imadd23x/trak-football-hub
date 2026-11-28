// Arc Pro (uiarc.dev): adapted from the Team directory block; licensed source, not covered by this repository's licence. See src/components/arc/PRO.md.
"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { PlayerFace } from "@/components/trak/PlayerFace";
import { GlassSegmented } from "../../glass-segmented/glass-segmented";
import { motionTokens } from "../../lib/motion-tokens";
import { BANDS } from "@/lib/types";
import styles from "./squad-directory.module.css";
import { useTranslation } from "@/lib/i18n";
import { bandWord } from "@/lib/band-words";
import { SECTION_LABEL } from "@/components/trak/standard";

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
}

/** Design standard step 3 (Dimos, 24 Nov): the lines from the front down, the list's groups and its filters alike. */
export const GROUP_ORDER = ["ATT", "MID", "DEF", "GK"] as const;
const GROUP_WORD = { ATT: "coachSquad:groupATT", MID: "coachSquad:groupMID", DEF: "coachSquad:groupDEF", GK: "coachSquad:groupGK" } as const;
const FILTERS = ["All", ...GROUP_ORDER] as const;
const FILTER_WORD = { All: "coachSquad:filterAll", GK: "coachSquad:filterGK", DEF: "coachSquad:filterDEF", MID: "coachSquad:filterMID", ATT: "coachSquad:filterATT" } as const;
type Filter = (typeof FILTERS)[number];

export function BandChip({ band, move = 0, waiting = false }: { band: string | null; move?: -1 | 0 | 1; waiting?: boolean }) {
  const { t } = useTranslation();
  const config = BANDS.find(entry => entry.word === band);
  if (waiting) return <span className={styles.chip} data-tone="needs">{t("coachSquad:waitingForConsent")}</span>;
  if (!config) return <span className={styles.chip} data-empty="" data-tone="neutral">{t("coachSquad:notAssessed")}</span>;
  return <span className={styles.chip} style={{ background: config.bg, borderColor: config.border, color: config.text }}>
    {bandWord(config.word)}
    {move === 1 && <ArrowUp size={12} strokeWidth={2.2} aria-label={t("coachSquad:up")} />}
    {move === -1 && <ArrowDown size={12} strokeWidth={2.2} aria-label={t("coachSquad:down")} />}
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
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");

  const needle = query.trim().toLowerCase();
  const visible = players.filter(player => (filter === "All" || player.group === filter) && `${player.name} ${player.position} ${player.shirt ?? ""}`.toLowerCase().includes(needle));
  // Design standard step 3: the visible players by line, Attackers first; no position yet last; empty lines left out.
  const byShirt = (a: SquadPlayer, b: SquadPlayer) => (a.shirt ?? 999) - (b.shirt ?? 999) || a.name.localeCompare(b.name);
  const groups = [...GROUP_ORDER, null].map(group => ({ group, players: visible.filter(player => player.group === group).sort(byShirt) }))
    .filter(entry => entry.players.length > 0);

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
        <span className={styles.srOnly}>{t("coachSquad:searchPlayers")}</span>
        <input ref={searchRef} type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }} placeholder={t("coachSquad:searchPlaceholder")} />
        <span className={styles.clearSlot}>{query && <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label={t("coachSquad:clearSearch")}><X size={14} strokeWidth={1.75} aria-hidden="true" /></button>}</span>
      </label>
    </header>

    {/* Trak (TRAK-266, Imad, 22 Oct): the position filters as they were before #420, on Arc's glass segmented control. */}
    <div className={styles.filters}>
      <GlassSegmented label={t("coachSquad:filterByPosition")} size="sm" fullWidth value={filter} onValueChange={value => setFilter(value as Filter)}
        options={FILTERS.map(item => ({ value: item, label: t(FILTER_WORD[item]) }))} />
    </div>
    {summary && <div className={styles.summary}>{summary}</div>}

    <div className={styles.body}>
      <div className={styles.listPane}>
        <ul className={styles.peopleList} aria-label={t("coachSquad:tabPlayers")}>
          <AnimatePresence mode="popLayout" initial={false}>
            {groups.flatMap(({ group, players: members }) => [
              // The line's label sits in the one list as a row of its own, so the list still holds one item per player.
              <motion.li key={`group-${group ?? "none"}`} role="presentation" className={styles.groupRow} layout={reduce ? false : "position"}
                initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: reduce ? 0 : motionTokens.duration.exit } }}
                transition={{ layout: listTransition, opacity: { duration: reduce ? 0 : motionTokens.duration.fast } }}>
                <h3 className={SECTION_LABEL}>{t(group ? GROUP_WORD[group] : "coachSquad:noPositionYet")} <span className="tabular-nums">{members.length}</span></h3>
              </motion.li>,
              ...members.map(player => <motion.li key={player.id} layout={reduce ? false : "position"} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: reduce ? 0 : motionTokens.duration.exit } }}
                transition={{ layout: listTransition, opacity: { duration: reduce ? 0 : motionTokens.duration.fast } }}>
                <button type="button" className={styles.personRow} onClick={() => onOpen(player)}>
                  <PlayerFace name={player.name} playerId={player.id} />
                  <span className={styles.personText}><span className={styles.personName}>{player.name}</span><span className={styles.personRole}>{player.position}{player.shirt != null ? ` · #${player.shirt}` : ""}</span></span>
                  {player.flag}
                  {/* Design standard step 3 (Dimos, 24 Nov): no ratings graph beside a player; a waiting player still says so. */}
                  {player.waiting && <BandChip band={null} waiting />}
                </button>
              </motion.li>),
            ])}
          </AnimatePresence>
        </ul>
        {visible.length === 0 && <div className={styles.empty}>
          <p>{needle ? t("coachSquad:noOneMatchesQuery", { query: query.trim() }) : t("coachSquad:noOneMatches")}</p>
          <button type="button" onClick={reset}>{t("coachSquad:clearFilters")}</button>
        </div>}
      </div>
    </div>
  </section>;
}

export default SquadDirectory;
