# Use Cases and state of the App — current build

Verified against the current source: `App.tsx` route table, `NavBar` navigation, 37 migration
files, and the existence or absence of every file cited. Items marked *verified live* were
additionally exercised in a running app against the database, signed in as that role.

**Status key** ✅ works · ⚠️ present, not behaviourally verified · 🔴 broken · ❌ not built ·
⬜ removed by design

---

## Persona: Coach

*(primary user)*

| | Use case | Status | Evidence |
|---|---|---|---|
| C1 | Sign up, onboard, pick club/team/role | ⬜ | Removed for the pilot (TRAK-12, 26 Sep): Trak creates coaches with `admit_staff_member`, which also generates their `invite_code`. See `docs/pilot-runbook.md` |
| C2 | Add a player to my squad manually | ✅ | `CoachAddPlayer` inserts `squad_players`; RLS correct |
| C3 | View my squad | ✅ | `CoachSquadPage` |
| C4 | Assess a player on 6 sliders → band | ✅ | `CoachAssess`; `coach_rating` is a generated column; RLS correct. **Quick Assess** walks the whole squad and, since `a282d34`, starts each slider at that player's previous assessment rather than the midpoint — the coach moves only what changed instead of ~108 drags per squad |
| C5 | View a player's assessment history | ✅ | `CoachPlayerProfilePage` |
| C6 | Log a training/match session | ✅ | `coach_sessions`; RLS correct |
| C7 | Log a match on behalf of a player | ✅ | `log_match_for_player` SECURITY DEFINER RPC, used by `CoachQuickMatchLog` and `CoachAddSession`. **This is now the only path a match enters the system** |
| C8 | Share my TRK-XXXX code to connect a player | ✅ | **Verified live**: the coach profile shows a real code (e.g. `TRK-ALEX`) read from `profiles.invite_code` and formatted by `formatCoachCode`. Both a direct lookup and `get_coach_id_by_invite_code` resolve it to the coach's `user_id` |
| C9 | Recognise / award a player | ✅ | Verified live: renders the real squad with band pills and week/month/season tabs. Awards flow through to the player's passport |
| C10 | Schedule | ✅ | Verified live: calendar renders, today highlighted, event-type legend, clear empty state, plus an AI "import from text or club website" entry point |
| C11 | AI assistant | ✅ | Verified live and **context-aware**: knew the coach's team (U15s, City FC Academy), named real squad players in its answer, and rendered a `PitchDiagram` with movement arrows |
| C12 | Coach progress dashboard | ⬜ | `components/coach/CoachProgress.tsx` exists but is referenced nowhere — dead tree |
| C13 | See a player's character progress | ❌ | Planned. No code exists |

> **Coach reality:** the coach product is complete and coherent. A coach can onboard, build a squad,
> assess on six dimensions, log sessions, log matches for their players, share a working invite code
> that genuinely links an athlete, and recognise behaviour. Everything the product asks of the coach,
> the coach can do today.

---

## Persona: Athlete

*(kids)*

| | Use case | Status | Evidence |
|---|---|---|---|
| A1 | Sign up and onboard as a player | ✅ | **Verified live on a fresh account**: 3-step form wrote `profiles` + `player_details` (DOB, position, club, age group, shirt) atomically |
| A2 | Connect to my coach via TRK code | ✅ | **Verified live** against the database. `link_player_to_coach` strips the `TRK-` prefix case-insensitively and trims, so `TRK-ALEX`, `ALEX`, `trk-alex` and `  TRK-ALEX  ` all resolve to the same squad row; `TRK-NOPE` is rejected with *Invalid coach code*. Idempotent — re-linking returns the existing row rather than duplicating |
| A3 | Browse my match history + detail | ✅ | `PlayerMatches`, `PlayerMatchDetail` — populated by the coach (C7) |
| A4 | See my band result | ✅ | Rating engine, well covered by tests |
| A5 | See my coach's assessment + private note | ✅ | `PlayerFeedback.tsx` (664 lines) reads `coach_assessments` + `coach_assessment_notes` at `/player/feedback/:assessmentId`; RLS policy `Players read own assessments` |
| A6 | Evolution Card | ✅ | `PlayerEvolutionCard.tsx` (960 lines) aggregating `matches`, `coach_assessments`, `recognition_awards`, `player_details`. A primary nav tab ("Card") — **this is the athlete's progression surface** |
| A7 | Passport | ✅ | Verified live — career totals, season history and recognition all render. The card is a fixed 390px so the exported PNG is identical on every device, which overflowed a 375px viewport; **fixed** (`866949a`) by scaling the card visually while `captureCard()` drops the transform for the html2canvas call, so exports keep full geometry. No overflow at 375px or 320px |
| A8 | Invite my parent | ✅ | **Built and verified live** (`5c91efe`). The invite and `invite_token` were always created correctly, but nothing delivered them. A "Parent access" card on the player profile now lists pending and accepted invites and shares a `/parent-invite?token=…` link via the native share sheet, clipboard, or revealed text if both fail. New `create_parent_invite` RPC allows adding a parent after signup; idempotent and case-insensitive. The link pre-fills the parent's email read-only, guaranteeing the match that links them to the child |
| A9 | Profile | ✅ | `PlayerProfilePage` |
| A10 | Self-log a match | ⬜ | **Removed by design.** `PlayerLogForm.tsx` no longer exists; no "Log" tab in the player nav. Matches come from the coach |
| A11 | Create / track goals | ⬜ | **Removed by design.** No goals files, routes, or nav entry. The Evolution Card serves this purpose |
| A12 | Earn / see medals | ⬜ | Removed. `MedalType` remains in `types.ts`; recognition is now the coach-driven path |
| A13 | Character: per-session moment (learn → apply → act) | ❌ | Planned. No code exists |
| A14 | Character: my growth, streaks, values | ❌ | Planned. Separate axis on the card — never merged into the performance band |

> **Athlete reality:** the athlete's experience is now coherent as a *receiving* one — matches, band,
> coach feedback, and an Evolution Card that carries progression. What the athlete has no reason to
> open the app for **between** matches is anything of their own. That is the deliberate gap the
> character feature is designed to fill, and it is the only place the product asks the child to work.

---

## Persona: Parent

| | Use case | Status | Evidence |
|---|---|---|---|
| P1 | Accept invite, create account, link to child | ✅ | **Verified live**: a parent signing up with the invited address was linked to the correct child in `player_parent_links`. Linking is idempotent — `link_parent_to_players_by_email` returned 0 because `provision_my_profile` had already created the link |
| P2 | See child's season band | ✅ | RLS policy `Parents can read linked child matches`: `user_id IN (SELECT player_user_id FROM player_parent_links WHERE parent_user_id = auth.uid())` |
| P3 | See child's match feed | ✅ | Same policy — the previously reported wall is gone |
| P4 | Alerts | ✅ | **Verified live and extended.** Was two of the specced types (match, assessment); recognition awards are now a third, using the parent read access added in `20260612000001` — the positive moment a parent most wants, previously only visible on the child's passport. Recognition carries a lime dot rather than amber so good news is distinguishable at a glance |
| P5 | See coach assessments + awards | ✅ | UI existed but returned 0 rows — no parent policy. Fixed by migration `20260612000001` (helper `squad_player_is_my_child`) granting parent SELECT on `coach_assessments` and `recognition_awards`. Applied to the database. The coach's private note stays player-only |
| P6 | Profile | ✅ | `ParentProfilePage` |
| P7 | See child's goals | ⬜ | Removed by design, with goals |

> **Parent reality:** the parent journey is now complete — sign up, link to the child, and see
> matches, season view, coach assessments and awards. Both previously reported walls (matches, then
> assessments) were missing RLS policies behind finished UI, not missing features.

---

## Persona: Club / Academy admin

| | Use case | Status | Evidence |
|---|---|---|---|
| K1 | Sign up, create the organization | ⬜ | Removed for the pilot (TRAK-12, 26 Sep): Trak creates the admin and their academy with `admit_staff_member`. See `docs/pilot-runbook.md` |
| K2 | Coaches join via academy code | ⬜ | Removed for the pilot (TRAK-12, 26 Sep): app roles can no longer execute either RPC, and only the operator sets `coach_details.organization_id` |
| K3 | View coaches in the organization | ✅ | `ClubCoaches`, org-scoped RLS |
| K4 | View squads across the org | ✅ | `ClubSquads` |
| K5 | Org dashboard, band distribution | ✅ | `ClubHome`. **Bug found and fixed** (`3bd1507`): the headline read "TOTAL PLAYERS 1" above squads summing to 29 — it counted linked accounts while the squads counted roster rows |
| K6 | Radar analytics | ✅ | Verified live: renders with its threshold rule stated (avg ≥ 7.5, 2+ assessments, last 60 days) and an empty state that explains *why* it is empty |
| K7 | Club profile, manage join code | ✅ | `ClubProfile` |

> **Club reality:** a working, org-scoped read layer. Visibility is opt-in — a club sees only coaches
> who joined with its code — and there is no direct player management, by design.

---

## Planned, not built

| | Item | Status | Note |
|---|---|---|---|
| N1 | Character feature — values, flashcards, scenarios, real-world challenges | ❌ | Additive. Coach stays primary; this is the athlete's active role |
| N2 | Character corner on the player card | ❌ | Separate axis. Must never feed the 0–10 performance band |
| N3 | Terms of service, privacy policy, parental consent | ❌ | No matches anywhere in source. Blocker for real users given minors' data |
| N4 | Billing / payments | ❌ | No Stripe/Paddle/checkout code. Cannot take money today |

## The honest summary

All four personas now work. The previous assessment's headline findings — "a teenager logs into a
void" and "the parent sees nothing, forever" — no longer hold: the athlete receives coach feedback
and carries an Evolution Card, and the parent's RLS wall has been fixed.

With self-logging and goals deliberately removed, **there is no longer a broken loop in the app.**
The coach logs, the athlete receives, the parent observes. What remains is not a defect list but a
build list:

1. **The character feature** — the athlete's only active role, and the reason for them to open the
   app between matches. Gated on the sports psychologist review.
2. **Legal and billing layers** — required before real users or revenue, independent of features.
   Gated on the lawyer conversation.
3. **Parent alerts (P4)** — the last feature never exercised live.

**There are no open defects.** Every fault found in this round was fixed and verified.

### Closed since the previous revision

- **P5** — parent access to assessments and awards (migration `20260612000001`, applied).
- **Housekeeping** — `MatchLog.tsx` and `CoachProgress.tsx` deleted (orphaned, unreferenced).
- **Verification sweep** — C9, C10, C11, A7 and K6 exercised live against the database. None was
  silently broken; the P5 pattern did not repeat. C11 proved stronger than documented: it is
  squad-aware and renders pitch diagrams.
- **K5 club dashboard** — "TOTAL PLAYERS 1" displayed above squads summing to 29. Fixed (`3bd1507`).

### End-to-end chain — verified this session

A complete coach → player → parent chain was created from scratch against the live database
(with email confirmation temporarily disabled), and every link held:

1. **Coach signs up** → `profiles` + `coach_details`, unique `invite_code` auto-generated.
2. **Player signs up entering `TRK-<code>`** → `profiles` + `player_details`.
3. **Player appears in that coach's squad** → `squad_players` row whose `coach_user_id` matches
   the new coach exactly, with name, position, shirt number and age group copied across.
4. **Parent email at signup** → `parent_invites` row, status `pending`.
5. **Parent signs up with that address** → `player_parent_links` row pointing at the right child.

This is the relationship backbone of the product and had never previously been exercised end to
end. Code matching is tolerant of `TRK-` prefix, case and surrounding whitespace, and every step
is idempotent — repeating it returns the existing row rather than creating a duplicate.

### Signup / onboarding — verified this session

- **Password rules did not match Supabase.** Every signup path checked only length while the
  server also required upper, lower, digit **and symbol**, so realistic passwords were rejected
  with a raw character-set dump. Fixed (`fd1a30e`) via `src/lib/password.ts`.
- **Email confirmation is ON.** New accounts must click a link before they can sign in
  (*"Email not confirmed"*), so a fresh coach → player → parent chain cannot be completed in a
  test run without either mailbox access or temporarily disabling confirmation.
- **`DevSetupPage` will fail on a fresh Supabase project** — it seeds with the password from `VITE_DEV_PASSWORD`, which has
  no symbol. Existing dev accounts predate the policy and still work. Not changed: altering it
  would break the logins currently in use.

### Open observations, not yet investigated

- The passport rendered **two identical "Player of the Week" entries** — possibly duplicate rows
  in `recognition_awards`, possibly a render duplication.
- A **U11s squad exists in the data**, but `AGE_GROUPS` in `constants.ts` starts at U13. The app
  holds data for an age group it does not officially offer — relevant to the character feature's
  age banding.

### Change log — this round

| Commit | Change |
|---|---|
| `a282d34` | Quick Assess sliders start from the player's last assessment, not the midpoint |
| `a1f957d` | Dropped the unused `player_goals` table |
| `aa446c0` | Age groups single-sourced; range starts at U13 |
| `acbfd2f` | Recognition awards added to the parent alerts feed |
| `18b2fa4` | Installable app (manifest, icons) and a real share preview |
| `bf74447` | **Security:** coach/club writes now require the writer's role |

### Earlier in this round

| Commit | Change |
|---|---|
| `f144688` | Parent access to assessments and awards unblocked (P5); dead code removed |
| `3bd1507` | Club dashboard "TOTAL PLAYERS 1" contradicted squads summing to 29 |
| `866949a` | Passport no longer scrolls sideways; PNG export geometry preserved |
| `14976b2`, `42e43c3` | Dev seed made idempotent — it had duplicated data on every run |
| `7c1593b` | Dead goals code removed (`PlayerGoals.tsx`, `lib/goals.ts`, seed block) |
| `80826d3` | Cleanup script for duplicate rows from earlier seed runs (since applied) |
| `fd1a30e` | Signup password rules aligned with what Supabase actually enforces |
| `5c91efe` | A8 — players can now deliver a parent invite via a shareable link |

Two database migrations were applied by hand: `20260612000001` (parent read access) and
`20260613000001` (parent invite sharing).

### Security review

A full authorization pass was run against the live database (`bf74447`). Read isolation was clean
across player, coach, parent and anonymous access. One serious write flaw was found and fixed:
policies on coach-owned tables checked ownership but never the writer's **role**, so any player
could fabricate coach assessments and awards about themselves. Details in
`docs/features-outstanding.md`.

### Method note

Policies and files were confirmed to *exist* in source; they were not exercised against a live
database. Items marked ⚠️ are present but not behaviourally verified.
