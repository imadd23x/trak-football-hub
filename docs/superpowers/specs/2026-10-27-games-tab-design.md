# Games tab: technical design

TRAK-282 is the product spec and wins on behaviour; its eight sub-issues (TRAK-283 to TRAK-290) are the build order.
This file says how it is built: tables, read rules, database functions, routes and screens. Draft for Imad's
approval, 27 Oct 2026. A slice that changes a decision here updates this file in the same PR.

## Objective

Each match becomes one loop in a new Games tab: logistics shared, game plan drafted, plan shared, locked at
kick-off, evaluation drafted, evaluation published. Every step closes the one before it, and Home's Needs you shows
each open step until it closes. Everything sits behind the `games` academy switch. With the switch off, Trak behaves
exactly as today, except that Squad › Games is removed for everyone.

## Decisions this rests on

- TRAK-282's decisions (Imad, 25 and 27 Oct), unchanged.
- **The result is saved at publish** (Imad, 27 Oct). Publishing an evaluation also writes the score, who played,
  goals and assists through the existing match log (`log_match_for_player` and its rules). Every screen that reads
  matches today keeps working unchanged. Families see the score when the coach publishes, not before.
- **Opponent strength, scouting and "how they scored" are coach-only for good** (TRAK-289). TRAK-282's privacy
  section says "until published"; the stricter rule wins.
- **Times are the academy's.** An event's date, start and end time are its academy's wall clock, and the database
  sets the instants `starts_at` and `ends_at` from them (TRAK-175). Lock, full time and the 09:00 nudge use those,
  never the device's zone.

## Privacy model: working rows and shared copies

Row rules (RLS) open or close whole rows; they can't hide a column. So:

1. **The coach's working tables are coach-only, always.** No player, guardian, other coach or academy admin ever
   reads them.
2. **Players and families read copies**, written only by two database functions: Share (the plan) and Publish (the
   evaluation). Each copy table holds exactly what its audience may read:
   - `game_for_family` and `game_review_for_family`: read by the player and their guardians.
   - `game_for_player` and `game_review_for_player`: read by the player only. They hold the coach's notes.

Copies are what make TRAK-282's "changes made after sharing are held back until the coach shares them" possible: if
players read the working rows, every edit would be live. They also meet TRAK-285 and TRAK-288's "the note lives in
its own table": the player's copy of every note sits in `game_for_player` or `game_review_for_player`, which no
guardian rule opens.

## Tables

Every new table: RLS on; nothing granted to `anon`; `authenticated` gets only the operations a rule below backs.
Each references `coach_calendar_events(id) ON DELETE CASCADE` and, per player, `squad_players(id) ON DELETE
CASCADE`. Every text field has a length limit, and every list a maximum length.

**Working tables (coach only):**

| Table | Key | Holds | Slice |
|---|---|---|---|
| `game_plans` | `event_id` | `strength` (weaker, similar or stronger), `their_formation` (a shape such as 4-4-2), `key_players` (shirt number 1 to 99 or blank, position, note; at most 11; no names, because they are other clubs' children), `scouting`, `goals` (title, what it looks like; at most 3). The two lists are JSON the database checks (`trak_private.valid_key_players`, `valid_game_goals`). No one deletes a plan: it goes with its match. Then format (11, 9, 7 or 5 a side; default 11) and formation (285). A plan is shared once `game_shares` has a row for it (286). | 284 |
| `game_plan_players` | `event_id, squad_player_id` | `role` (starter, bench or not selected; bench by default, Imad 28 Oct), `slot` (starters only: 1 is the keeper, then each line from the back, left to right; one player per slot, checked at the end of each statement so two starters can swap), `job`, `note`, `context` (the five tags, never a diagnosis), `expectation` (stretch, usual or lead; usual by default). A player left out keeps only the note. Written only for a consented child on the coach's current roster in the match's squad (`trak_private.game_plan_player_ok`). No one deletes a row. `game_plans` gains `format` (11, 9, 7 or 5; default 11) and a `formation` that must fit it. | 285 |
| `game_shares` | `id` | One row per share (`event_id`, `shared_at`), with how many children's copies it wrote, changed or took back. Only the match's coach reads it; only Share writes it. A share that changes nothing isn't logged. Feeds the timeline ("Changes shared to 3"). | 286 |
| `game_evaluations` | `event_id` | Our score, their score, our goals (scorer and optional assist each, players who played; no more than our score; nobody assists their own goal), how they scored, "Did the plan work?" (one answer per plan goal: didnt, partly or worked), `saved_at`, `published_at`. | 288 |
| `game_evaluation_players` | `event_id, squad_player_id` | One row per player listed: played (a starter not unticked, or a bench player who came on; no minutes, Imad 29 Oct), did the job (yes, partly or not yet; default yes), against expectation (below, met or above; default met). Someone who didn't play keeps the defaults. Only for a consented child on the coach's roster in the match's squad (`trak_private.game_plan_player_ok`). | 288 |
| `game_evaluation_notes` | `event_id, squad_player_id` | The coach's note to a player who played, in its own table so only that player can be let read it (289). | 288 |

**Copies players and families read (written only by Share and Publish):**

| Table | Key | Read by | Holds |
|---|---|---|---|
| `game_for_family` | `event_id, squad_player_id` | That player and their guardians | `role` (starter, bench or not selected), `job`, `has_note`, `coach_name` (TRAK-300: a player can't read their coach's profile, so Share copies the name; a new name refreshes on the next share without marking anyone Updated), `shared_at`, `changed_at` (drives "Updated" until kick-off). |
| `game_for_player` | `event_id, squad_player_id` | That player only | The goals, the plan note, `shared_at`, `changed_at`. |
| `game_review_for_family` | `event_id, squad_player_id` | That player and their guardians | Written by Publish (289) for each child who played: the score, their job, the expectation and context as the plan locked, did the job, against expectation, `has_note`, `coach_name`, `published_at`, and `session_id` (the match session Publish made, so the child's match history can tell a Games match without reading the coach's sessions). |
| `game_review_for_player` | `event_id, squad_player_id` | That player only | The coach's note to them (289). It goes with its family row. |

Publish writes the review in its own tables, so nothing a family read before the game changes, and no review row
exists before it's published.

**Who gets copies (286):** every child the line-up may hold (`game_plan_player_ok`'s rules) who can come, placed or on
the bench by default, and a starter who said they can't make it (their slot is flagged until the coach moves them).
Someone not on the pitch who can't make it gets none, as the coach's line-up lists them apart. A child left out gets
the goals too: TRAK-286 says a player reads the goals with no exception, where this design had said "when called up";
the issue wins (Imad told, 28 Oct). Updated is per audience: the family's copy changes only when the role, job or
"has a note" changes, so new goals or a reworded note read as Updated for the player alone.

## Read and write rules

**The coach** reads and writes the working tables of their own match events (`coach_calendar_events.coach_user_id =
(select auth.uid())`), and reads the copies of their own events (for the change count and the timeline). Writes
also pass restrictive rules, as events do:

- the academy's `games` switch is on (`feature_on('games')`);
- the event is a match and isn't cancelled.

A per-player row can be written only for a child on the coach's current roster in the event's squad
(`squad_player_is_mine`, same `age_group`) whose guardian has consented (`NOT squad_player_consent_required`). These
are the match log's checks. "Can't make it" is read as who, never `reason`.

**A player** reads their own rows in both copy tables (`squad_players.linked_player_id = auth.uid()`).

**A guardian** reads their child's `game_for_family` rows (`player_parent_links`). No rule ever opens
`game_for_player` to a guardian.

**Every player and guardian read** goes through one helper, `trak_private.family_reads_game_copy(event, squad
player, guardian allowed)`. It is security definer, with `search_path = ''`, and makes the checks family event reads
make today (`family_reads_event_for`) for that one child:

- consent is in place (`NOT player_consent_required(child)`);
- the roster row is current (not `coach_departed`) and belongs to the event's coach, academy and squad;
- the event is published, a match and not cancelled;
- the academy's `games` switch is on, so the switch is also a kill switch for what families see;
- from 290, the share time has passed: `least(visible_from, starts_at) <= now()`, so a match moved earlier than a
  scheduled share still shows the plan at kick-off.

Players and guardians get no insert, update or delete grant on any Games table.

## Database functions and triggers

- **`share_game_plan(event_id, talked)`** (286; 290 adds a share time). Security definer. It refuses unless the
  caller is the event's coach, the switch is on, the event is a published, uncancelled match, kick-off hasn't
  passed and a plan is saved; the first share also needs `talked` (the face-to-face tick). It writes the copies
  (`trak_private.game_copies`), deletes copies nobody may read any more, sets `changed_at` only on copies whose
  words changed, and logs the share in `game_shares`. It returns how many children's copies changed.
- **`game_plan_changes(event_ids)`** (286). Security definer, because the coach never reads the copies: for the
  caller's own shared matches before kick-off, the children whose copies a share would change now
  (`trak_private.game_copy_changes`). It drives "Changes not shared · N" and the Share step's alert. A child who
  left or lost consent isn't a change: they read nothing already.
- **`trak_private.family_reads_game_copy(event, squad row, guardian)`** (286): the copies' read rule. A published,
  uncancelled match in an academy with the switch on; the child on the coach's current roster in the match's squad,
  with consent; the caller is the child or, for `game_for_family` only, a guardian.
- **Kick-off lock** (287, `20261028223000_games_locked_at_kick_off.sql`), a trigger on `game_plans` and
  `game_plan_players` (`trak_private.refuse_locked_plan_change`), the approach of
  `20261021030000_started_event_locked.sql`. For app users, any insert or update after the event's `starts_at` raises
  "This match has kicked off, so its plan is locked". It reads the event each time, so moving the match moves the lock.
  The operator can still correct a row. `share_game_plan` refuses after kick-off too, and `game_plan_changes` keeps
  counting what wasn't shared, for the lock's note. Imad, 28 Oct: the note sits in the lock's alert ("2 players didn't
  get your last changes", or "It wasn't shared, so only you saw it"); the History timeline comes with 289 and reads
  the same facts.
- **Evaluation window** (288). `save_game_evaluation` is the only write path: app roles hold SELECT only, so a save
  is one transaction and the rules across the three tables hold. It refuses before full time (the event's `ends_at`,
  or 90 minutes after kick-off, as `loop.ts` works it out), with the switch off, for a cancelled match, for a child
  who can't be recorded (42501), and once `published_at` is set. Published is final.
- **`publish_game_evaluation(event_id, competition, home_away)`** (289,
  `20261029170000_game_publish.sql`). Security definer, one transaction, the only way a review is written. It refuses
  unless the caller is the event's coach and the switch is on (42501), and the event is an uncancelled match past full
  time with a saved draft that isn't published, a score, an answer to "Did the plan work?" for every plan goal, and a
  competition and home or away (from the event, or passed in and saved on it; that change emails nobody, as the event
  notice fires only on date, time, venue or cancel). It also refuses a match already logged the old way. It then:
  - sets `published_at`, which ends every later save;
  - creates the match's `coach_sessions` row and marks who played present;
  - writes the review copies for each child who played and can still be recorded (`game_plan_player_ok`);
  - calls `log_match_for_player` for each of them with an account: goals and assists from the evaluation, the
    competition and venue, position and age group, and no rating (open question 1).

  It returns how many reviews it wrote, how many matches it logged, and the children it skipped (no longer on the
  roster, or waiting for consent); the app says how many. `matches.computed_rating` becomes nullable for it, and every
  rating reader counts rated matches only. `edit_logged_match` is replaced with the same body plus one refusal: a
  match whose evaluation is published can't be edited. Published is final.

Every function: `search_path = ''`; `EXECUTE` revoked from `PUBLIC` and `anon`; explicit `auth.uid()` checks.
Security definer functions skip the tables' own rules, so they repeat every check those rules make. Errors name
nobody: the app swaps ids for names, as the match log does.

## Time

- **Countdown to kick-off:** `starts_at`. **Full time:** `ends_at`. Both are instants, so the device's zone doesn't
  matter.
- **Times on screen:** the phone's clock, with the academy's own time beside it when the two differ (Imad, 23 Oct:
  `phoneEventTime`, `academyClock`), as every event screen shows them. Logistics shows Schedule's Review rows, which
  are the academy's clock, as forms are.
- **The 09:00 nudge (290):** the first 09:00 after the draft's `saved_at`, in `organizations.time_zone`, worked out
  when the page is read. No timed job.
- **A moved match:** the lock reads `starts_at` live, so it moves with the match.

## Screens and routes

| Route | Page | Contents |
|---|---|---|
| `/coach/games` | `src/pages/coach/CoachGames.tsx` | Games home: next game, open drafts, your games (upcoming soonest first, then past, newest first, as the mockup orders them), `SquadPills`. |
| `/coach/games/:eventId?tab=` | `src/pages/coach/CoachGame.tsx` | Header with state badge and compact countdown; tabs Logistics · Game plan · Evaluation; the loop's timeline. |

Both routes sit inside `RouteGuard` (coach) and `ParkedScreen unless="games"`, as Schedule does. Games joins
`coach-places.ts` and `CoachFrame`, shown only when `useFeature('games')` is on:

- sidebar: Home · Schedule · Squad · Games · Library;
- phone tab bar: Home · Squad · Games · Library.

Where the academy's training switch is on (TRAK-294), Training takes Library's place.

Where the code goes:

- Screens: `src/components/coach/games/`, one file per step or part. Arc's tabs unmount a panel that isn't shown,
  so what a step holds as typed lives on the game page, above the tabs (TRAK-284). Keeping the panel mounted
  instead broke the tab keys.
- Logic with no screen, unit tested, in `src/lib/games/`:
  - `loop.ts`: a game's state, its next action and its Needs you card, from the event, plan, evaluation, change
    count and clock;
  - `formations.ts`: one small constant list per format, with slot positions;
  - `words.ts`: the words players and families read, and the coach's plain labels.
- Player and parent: `src/components/player/GamePlanSection.tsx` (286) and `GameReviewSection.tsx` (289, After the
  game). `PlayerEvent`, `ParentEvent` and the coach's Share and Publish previews render them, and the previews' words
  come from `previewOf` and `previewReview`, so a preview can't drift from the real page (tests compare them). The
  child's reads live in `src/lib/games/shared-plans.ts` and `reviews.ts`.

Arc: each step uses TRAK-282's picks. Before each slice, every component it adds is read with the Arc MCP
(`whenToUse`, `whenNotToUse`) and checked for React 19-only APIs. Fifteen free components and one Pro block are new to
Trak. The Pro block, `release-readiness`, is listed in `src/components/arc/PRO.md`. One pick changed (Imad, 28 Oct):
a key player's shirt number is an `input` with the number pad, not `number-field`, because it is a code and can be
blank. TRAK-285 (Imad, 28 Oct): Bench or Not selected is the player sheet's `radio-group`, not an inline one in the list
(Arc's radio-group only stacks). `chip-group` stays for context, though Arc says "checkbox in forms": the five tags read
as tags and must fit a phone sheet. React 18: chip-group's Chip, MoreChip and Swap, and progress's and badge's Swap,
take their ref through `forwardRef`. TRAK-286: `release-readiness` is adapted as `blocks/release-readiness/share-readiness`:
the coach ticks one check (face to face, Arc's `checkbox`); the other three are worked out from the plan and show a
mark; only the logistics and the tick hold Share now back (Imad, 28 Oct). No owners and no notify switch: sharing is
in the app only. Alert's Swap takes `forwardRef` too. The coach's note on the player's page is a tinted Trak panel
like its neighbours, not Arc's `card`, which is for browsable items and lifts on hover (Imad, 28 Oct).

## Existing code

**Reused:**

- the switch: `academy_features`, `feature_on()`, `useFeature`, `ParkedScreen unless=`;
- the squad filter: `SquadPills`, `useCoachSquad`;
- who can come: `useSquadRoster`, `splitAvailability`, `event_confirmations`, and `event_absences` (who only), read
  through `src/components/coach/squad/availability-reads.ts` under Squad › Availability's query keys (TRAK-285);
- Schedule's hand-over: `quickEvent` (Add a match) and the `?edit=<id>` link. A draft's logistics publish in place
  with `publishEvent`, as Home's event sheet does: Schedule's single-event `?publish=<id>` link re-publishes in a loop
  when reached by in-app navigation (found 27 Oct; nothing sends it today), so Games never sends it. And the
  `SAVE_FAILED` pattern;
- the checks: `squad_player_is_mine`, the consent helpers, `log_match_for_player`;
- the icon: `IconMatch`.

**Changed:**

- `CoachFrame`, `coach-places.ts`, `App.tsx` and `parked.ts` (`Feature` gains `'games'`).
- `EventSummary` moves out of `CoachSchedule.tsx` into its own file, so Games doesn't load the Schedule page's code.
- Schedule offers "Write the game plan" after a match is published (283). For Games academies, Evaluate replaces "Log
  match", and a match dated in the past is saved, published (families aren't emailed about a started event) and
  opened on its evaluation instead of "log it instead"; the "+" Log match opens New event with Match picked (288).
- `CoachSessionsChooser` hides Quick match log for Games academies (288).
- Needs you: `coach-week.ts`, `useOwedEvents`, `NeedsYou`.
- The player and parent event pages and cards: `PlayerEvent`, `ParentEvent`, `UpcomingEventCard`, `ParentEvents`.
- Match history (289): `MatchCard`, `PlayerMatches`, `PlayerMatchDetail` and `ParentMatches` show a Games match as
  "Coach's review" with no band and open its event page. The rating readers (`PlayerHome`, `PlayerProfile`,
  `PlayerProfilePage`, `PlayerEvolutionCard`, `records.ts`) count rated matches only. Schedule and Home's week offer
  View review for a published Games match, never the old match editor.
- `docs/rehearsal-script.html` (289), and AGENTS.md's Squad views row (283).

**Retired:** Squad › Games, for everyone: `GamesTab.tsx`, its tab and its test cases, with `useSeason.ts` and
`seasonSummary`, which only it used. `seasonWindow` stays in `src/lib/squad/season.ts`: the Players view counts its
averages over it.

**Not reusable:** `PitchDiagram.tsx` is a static drill drawing in the old dark palette, with nothing to tap. The
line-up gets a light pitch with slot buttons, as the mockup draws it.

## What each slice carries

One PR per issue, from fresh main, never stacked. Every migration is a new file, announced in
#coding-agents-at-work, and shown to Imad once before its PR merges.

| Slice | Migration | App |
|---|---|---|
| 283 | Allow `'games'` in `academy_features` | Nav, routes, Games home, game page with Logistics, "Write the game plan" after publishing, Squad › Games removed, the operator SQL for Rehearsal FC |
| 284 | `game_plans` with the coach, switch and cancelled rules | Plan step 1, Save draft, "Plan not shared" in Needs you, Open drafts |
| 285 | `game_plan_players` with the roster and consent rules; format and formation | Line-up and jobs, player sheet, progress |
| 286 | `game_for_family`, `game_for_player`, `game_shares`, `share_game_plan`, `unshared_game_changes` | Share step, the player and parent Game plan section, preview, Updated, badges |
| 287 | Kick-off lock triggers | Read-only plan, countdown flips to Locked |
| 288 | `game_evaluations`, `game_evaluation_players`, the evaluation window | Evaluation draft; the old match log's entry points retired for Games academies |
| 289 | `game_review_for_family`, `game_review_for_player`, `publish_game_evaluation`; `matches.computed_rating` nullable; `edit_logged_match` refuses a published match | Publish, After the game, match history, loop closed, timeline, rehearsal script |
| 290 | A share time on the copies and in `share_game_plan` | Share at…, the 09:00 nudge |

## Testing

**Database** (`supabase/tests/games_*.sql`): one suite per slice with `-- @trak-suite … in-all=true`, synthetic
fixtures, rolled back at the end. Test people are named after real footballers.

- Every read rule runs as player A, player B, A's guardian, another coach and a child without consent, before and
  after Share and Publish.
- Writes are refused for a cancelled match, with the switch off, for a child without consent or off the roster, and
  after kick-off. The lock is tested one second before and one second after kick-off; moving the match later reopens
  it.
- Strength, scouting and how they scored are never readable outside the coach.
- An unshared change stays invisible, and only changed rows get Updated.
- Publish writes the match log once, refuses scorers above the score, and is final.

**Logic** (Vitest): `loop.ts` with a fake clock covers every state, Needs you card, lock, full time, the 09:00
nudge, a cancelled match and a moved match.

**Screens** (Vitest and Testing Library): each issue's UI tests, for example nav hidden when off, only this squad's
matches, Squad has three views, a draft saves and reloads, no fourth goal, a failed save keeps the form.

**Browser** (`e2e/games.spec.ts`, added to `playwright.pilot.config.ts`): the production build against an
intercepted synthetic backend, like `coach-wide-layout.spec.ts`. Screenshots at 390 and 1440 px, keyboard-only
checks, no horizontal scroll.

**Live:** after each deploy, on Rehearsal FC with the switch on. TRAK-289 runs the whole loop and puts its
screenshots on the issue.

Commands, from the slice's worktree:

```sh
npm ci --legacy-peer-deps
npm run lint
npm run typecheck
npm test
npm run test:db
npm run build && npx playwright test --config playwright.pilot.config.ts
```

## Boundaries

**Always:**

- new migration files only;
- a SQL test for every read rule;
- consent and roster checks on every write and read;
- everything behind the `games` switch;
- in app only;
- sentence case and the light theme tokens;
- synthetic footballer names.

**Ask Imad first:**

- each migration, once, before its PR merges;
- any background job (none planned);
- any new dependency beyond what an Arc component brings;
- anything about emails.

**Never:**

- run SQL against production without Imad's go for that step (on 28 Oct he had the agent run the Rehearsal FC
  switch);
- edit an applied migration;
- read the reason behind "Can't make it";
- add a diagnosis field;
- send an email or a push for a plan or an evaluation;
- stack PRs;
- put a real academy's name or a private link in the repo.

## Rollback

- **Kill switch:** the operator deletes the academy's `games` row. Games disappears for its coaches, and the read
  rules close every copy to its families at once.
- **Frontend:** redeploy the previous build.
- **Database:** these migrations only add tables, functions and triggers, and widen one check, so a frontend
  rollback leaves them unused and harmless. Removing them would take a new migration, written only if needed. One
  exception (289): a published Games match is a `matches` row with no rating. A frontend from before 289 would read it
  with its old fallback, so after the first publish, fix forward rather than roll the frontend back.

## Open questions, each for the slice that needs it

1. **Match rating (288, 289). Decided (Imad, 28 Oct): no rating for a Games match.** Publish writes the result
   without one, so it stays out of bands, trends and averages; 289 checks every rating reader copes with none.
2. **Unplaced players (285). Decided (Imad, 28 Oct): Bench.** Leaving a child out is always a deliberate choice.
3. **Formations (285). Decided (Imad, 28 Oct):** 11 a side: 4-4-2, 4-3-3, 4-2-3-1, 4-1-4-1, 4-4-1-1, 3-5-2, 3-4-3,
   5-3-2, 5-4-1. 9 a side: 3-3-2, 3-2-3, 2-4-2, 3-4-1. 7 a side: 2-3-1, 3-2-1, 2-1-2-1, 3-1-2. 5 a side: 2-2, 1-2-1,
   3-1. The same list feeds "their formation" (`src/lib/games/formations.ts`).
4. **Competition. Decided (Imad, 28 Oct): New event asks it** for a match (League, Tournament or Friendly), and it
   lives on the event (`coach_calendar_events.competition`, 288); publish reads it from there. **Matches made before
   288 (Imad, 29 Oct): the Publish step asks it**, Publish stays off until it's picked, and publishing saves it on the
   match. The match log also needs home or away, which an older match may lack, so the Publish step asks that the same
   way.
5. **Data export.** `export_my_account` should include a child's Games rows (the review copies, as it includes their
   matches). A follow-up issue; the published result is already in their exported matches.

## Done when

Every sub-issue's acceptance passes the merge gate, and a full loop runs on Rehearsal FC with the switch on
(TRAK-289). Every academy with the switch off behaves as before, except that Squad › Games is gone.
