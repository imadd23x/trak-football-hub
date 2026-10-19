<!-- delivery-policy: historical -->
> Historical record. Development and delivery follow the [current canonical delivery policy](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/blob/main/docs/release/merge-gate.md). Process instructions recorded below are superseded; product facts, explicit scope holds and test observations remain evidence.

# Trak Football — Pilot MVP Design

> **Status:** Draft for review by Dimos, Kostas, Tarek
> **Date:** 2026-07-27
> **Supersedes:** nothing. Complements `Strategy.md` (build brief) and `docs/pm/REQUIREMENTS.md` (REQ-001–005).
> **Decision needed by:** end of August 2026 (see D5)

---

## Executive summary

Trak has a good product layer and no connective tissue.

The rating engine, seven-band system, design language, match-log UX and parent
invite flow are built and sound. What does not exist is every arrow *between*
the three personas: a coach cannot connect to a real athlete, an athlete cannot
see their coach's feedback, a coach cannot see an athlete's matches, and a
parent's screens return zero rows by construction.

Underneath that, the application has no environment separation, no verified
access control, no error visibility, no tested backup and no CI. **It is not
currently safe to onboard a real 13-year-old.**

Both problems are smaller than they look. The missing product work is a codes
table, one link column, four RLS policies, one telemetry table and three
screens — not 37 screens. The missing infrastructure is free-tier and
achievable in roughly ten weeks, tight by about a week, with three named levers
to close the gap.

This document sets out the strategy the work serves, what exists today with
evidence, the pilot scope, the architecture, the infrastructure, and the jobs
required to reach an October pilot.

---

# Part A — Strategy

## Purpose — why Trak exists

**A young footballer's development record is destroyed roughly ten times before
they turn eighteen, and the one person with everything at stake is the only one
who never owns it.**

Academy players change club or coach about twice a year, so a 13-year-old will
experience around ten transitions by 18, each resetting their track record to
zero. Parents pay ~€500 a year and receive no persistent written record. The
information exists — in a coach's head, a WhatsApp thread, a parent's memory —
and it evaporates at every transition.

Trak exists to stop that evaporation.

## Vision

**Every academy footballer in Europe reaches 18 holding a complete, portable,
self-owned record of who they became as a player — regardless of how many
coaches, clubs or countries they passed through.**

The test: when a player walks into a trial at a new club, they arrive with
evidence instead of anecdote.

## Mission

**Give 13–18 year old footballers a development record they own — one their
coach contributes professional judgement to, their parent can see, and no club
transition can take away.**

Three verbs in dependency order: **capture** (athlete logs, coach assesses),
**reflect** (bands, trends, feedback the athlete can act on), **carry** (the
record moves with the athlete, not the club).

## Strategy — how Trak wins

**Where we play.** The athlete's phone, not the club's back office. This is the
deliberate anti-position: LeagueApps and SportsEngine sell registration,
payments and scheduling to club administrators. Trak is never sold to a club as
an admin system. Greece and Cyprus first, where those incumbents have minimal
presence, then Netherlands and Belgium.

**Four moves:**

1. **Coach-led distribution, athlete-owned product.** Coaches are the validated
   demand — they asked for this. Athletes are the unvalidated thesis. Coaches
   are therefore the *channel* (one coach brings a squad; the `TRK-XXXX` code
   is the distribution mechanism) while the athlete is the *owner*.
2. **Portability as the moat.** Anyone can build a match log. What compounds is
   a longitudinal record that survives transitions. The CEO review scored
   differentiation 3/5 and called the primitives "individually unremarkable" —
   correct, and it means the moat must be accumulated record, not features.
3. **Bands, not numbers, as product philosophy.** The hidden-score design is
   positioning as much as UX: Trak is a development tool, not a scouting-grade
   rating service. It keeps the product safe for minors and aligned with
   coaches rather than threatening to them.
4. **Parent as payer, athlete as user.** Parents already spend ~€500/year and
   get nothing written back. That is the willingness-to-pay thesis —
   deliberately untested until after the pilot, per anti-requirement (E).

**What Trak refuses to be:** a club admin system, a scouting marketplace, a
public rating platform, a social network.

## Ambition — four tiers

| Tier | What it is | Success test |
|---|---|---|
| **Pilot** (Oct, 8 wks) | One academy, ~15 athletes, ~2 coaches. Evidence-gathering | Q4 metric: ≥60% of athletes log weekly, unprompted |
| **MVP** (post-pilot) | The full 37-screen spec — goals, medals, profiles — if and only if the pilot validates | Multi-club retention, first paid parent |
| **Product** | Multi-club, multi-season, GR/CY. Record genuinely portable across clubs | An athlete carries their record through a real club transfer |
| **Platform** | GR/CY/NL/BE. The record becomes credential | External parties accept a Trak record as evidence |

## Unresolved strategic tensions

**T1 — Positioning and demand evidence point at different people.** Trak is
positioned player-first, but every validated demand signal is coach-side (CEO
review: Market Fit 2/5). The strategy resolves this by making coaches the
channel and athletes the owner. But if the Q4 metric fails, the honest
conclusion may be that Trak is *a coach's assessment tool that athletes benefit
from* — a different company with a different buyer. **Decide in advance what
you would do.**

**T2 — The stated TAM does not support the stated ambition.**
`REQUIREMENTS.md` puts the market at 500–800 players across GR/CY/NL generating
€250–400K/year of *parental academy spend* — which is not Trak revenue. Even
100% capture at a real subscription price is a small business. This is likely
the reachable pilot-adjacent segment rather than the market, but as written it
is the number in the requirements doc, and any investor will do the arithmetic.
**Needs restating by Kostas before any external conversation.**

## The five product pillars

- **P1. The athlete owns the record.** Architectural consequence: match logs
  and assessments belong to the athlete's identity, never to the coach's roster
  row. A coach leaving must not take the history with them.
- **P2. The coach's assessment is the trusted signal.** The professional
  judgement the athlete's self-log is measured against.
- **P3. Bands, never numbers, to the athlete.** Showing a 13-year-old "you are
  a 6.2" is a safeguarding problem; showing them "Steady" is feedback.
  Non-negotiable.
- **P4. The loop must close.** Coach assesses → athlete sees → athlete logs →
  coach sees. **None of these four arrows exist in code today.**
- **P5. The pilot measures itself, or it isn't a pilot.** Evidence is the
  entire ROI. Telemetry is a first-class feature with tests.

---

# Part B — Where we are

Audit performed 2026-07-27 against commit `b57c329`. All findings verified by
reading code, schema and running the toolchain.

## Verified working

- `npm run build` succeeds (579 kB bundle, 1753 modules)
- `npx tsc --noEmit` exits 0
- `npm test` → 34 passed across 5 files
- 13 tables in code, 13 defined in migrations, no drift

## Critical findings

**F1 — The pilot cannot measure itself.** `src/lib/telemetry.ts:9` inserts into
`telemetry_events`, a table that exists in **no migration**. It is cast `as any`
and every error is swallowed by design. All three kill criteria (30% athletes,
50% coaches, 20% parents) are measured by this client. The pilot would run
eight weeks and produce no data, silently.

**F2 — The triangle is three disconnected silos.** `squad_players.linked_player_id`
appears only in generated types — never written, never read anywhere in `src/`.
A coach assesses a name in their private list; that row has no connection to
any player account.

**F3 — Athletes can never see coach feedback.** Every `coach_assessments` query
in the repo is a coach path, and RLS is `coach_user_id = auth.uid()`. Note that
`Strategy.md` §13 *specifies* this should be visible to the assessed player —
it is designed and unbuilt, not undesigned.

**F4 — The parent role returns zero rows, always.**
`src/pages/parent/ParentMatches.tsx:19` reads `matches` where `user_id = childId`,
but the policy is `USING (user_id = auth.uid())`. The parent is not the child.
The query discards `error` and renders "No matches yet."

**F5 — RLS is never enabled on the identity tables.** The first migration
creates `profiles`, `player_details`, `coach_details`, `parent_invites`,
`player_parent_links` with 14 policies and **no `ALTER TABLE ... ENABLE ROW
LEVEL SECURITY`**. The other four migrations do it correctly. Postgres policies
on a table without RLS are inert. *This could not be verified against the live
database from the repo — and that unverifiability is itself the finding.*

**F6 — Invite codes are cosmetic.** `src/pages/coach/CoachProfilePage.tsx:21`
derives the code as `coach_details.id.substring(0,4)` — a UUID prefix. No `code`
column exists in any migration; `parseInviteCode()` is called nowhere; there is
no uniqueness check. REQ-003 is unimplemented at the data layer.

## Resilience pattern (root causes, not symptoms)

- `@tanstack/react-query` is a dependency with **zero** `useQuery`/`useMutation`
  calls. All 37 data-touching files use raw `useEffect` + `setState`.
- **No ErrorBoundary anywhere.** One render throw blanks the whole app.
- `const { data } = await ...` is the house style — `error` is destructured
  away. **Network failure, permission denial and "no data yet" all render
  identically as an empty state.** This single pattern is the root cause of the
  app feeling fragile.
- `src/__tests__/pilot-e2e.test.ts` is named e2e but is pure rating-engine
  math. All 34 tests cover `lib/` only. Every bug above lives in the untested
  gap.

## Dead parallel implementation

`src/pages/Dashboard.tsx` is **not routed** and is the only importer of
`src/components/coach/*` (7 screens) and `src/components/player/PlayerHome.tsx`.
That entire tree is an orphaned earlier build. Five legacy routes (`/dashboard`,
`/log`, `/log/match`, `/profile`, `/goals`) are registered **without
`RouteGuard`**.

## Process debt

- `PRD.md`, `ARCHITECTURE.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`,
  `PROJECT.md` each exist in two **divergent** copies (root and `docs/pm/`), as
  do the six plan files. No authoritative set.
- `STATE.md` reports 0 of 31 tasks complete; commit `b57c329` claims all six
  milestones shipped.
- `.env` is tracked in git (commit `6cec37e`) despite `.gitignore`.

## Use-case inventory

Legend: ✅ works · ⚠️ fragile · 🔴 built but always returns nothing · ⬜ cosmetic stub · ❌ not built

### Coach

| # | Use case | Status |
|---|---|---|
| C1 | Sign up, onboard, set club/team/role | ⚠️ RLS unverified |
| C2 | Add a player to squad manually | ✅ |
| C3 | View squad | ✅ |
| C4 | Assess a player on 6 sliders → band | ✅ |
| C5 | View a player's assessment history | ✅ |
| C6 | Log a training/match session | ✅ |
| C7 | Share `TRK-XXXX` to connect a player | ⬜ cosmetic (F6) |
| C8 | See a linked athlete's logged matches | ❌ |
| C9 | Coach progress dashboard | ❌ unreachable (dead tree) |

*A coach can run a useful private assessment notebook. They cannot connect it
to a single real athlete.*

### Athlete

| # | Use case | Status |
|---|---|---|
| A1 | Sign up and onboard | ⚠️ RLS unverified |
| A2 | Log a match with position inputs + live band preview | ✅ strongest feature |
| A3 | See band result | ✅ |
| A4 | Match history + detail | ✅ |
| A5 | View goals | ⚠️ read-only |
| A6 | **Create a goal** | 🔴 exists only at unguarded `/goals`, not in the nav |
| A7 | Earn/see medals | ⬜ empty `useEffect`; `lib/medals.ts` tested but never called; no table |
| A8 | Connect to coach via code | ❌ |
| A9 | See coach's assessment | ❌ (F3) |
| A10 | Invite parent | ⚠️ email invite works; `PAR-XXXX` flow absent |
| A11 | Profile | ✅ |

*Logging works well. Nothing ever comes back. A teenager logs into a void.*

### Parent

| # | Use case | Status |
|---|---|---|
| P1 | Accept invite, create account, link to child | ✅ best-engineered flow in the app |
| P2 | See child's season band | 🔴 (F4) |
| P3 | See child's match feed | 🔴 |
| P4 | See child's goals | 🔴 |
| P5 | Alerts | 🔴 1 of 3 types, built on a blocked query |
| P6 | See coach assessments | ❌ |

*A parent signs up successfully, then sees four screens saying "nothing yet" —
forever, and identically whether the cause is no data, a permission wall, or a
dead network.*

### Requirement status

REQ-001 (log + band) genuinely works. REQ-002 works only as a private coach
notebook. **REQ-003, REQ-004 and REQ-005 are non-functional.**

---

# Part C — Pilot scope

**Pilot:** 1 Greek academy · ~15 athletes aged 13–18 · ~2 coaches · ~15 parents ·
8 weeks from October · mobile web only, ≤430px.

**Build window:** ~10 weeks from 2026-07-27, roughly 1.5 fragmented
AI-assisted streams.

## Scope rule

**Does this use case sit on the loop, or does it prove the loop worked?** If
neither, it is parked — feature-flagged off, still in the repo, zero pilot
exposure. This is applied harder than `Strategy.md` §8, because §8 describes the
*MVP* while `REQUIREMENTS.md` defines the pilot as the narrower wedge that
decides whether the MVP is justified.

## The mission-critical loop

```
Coach builds squad  →  athlete claims their row via code  →  coach assesses
        ↑                                                          ↓
   coach sees log  ←  athlete logs match  ←  athlete sees band + coach feedback
                                                                   ↓
                              parent (read-only) sees child's bands and matches
```

## IN — 14 use cases

**Connect (REQ-003)**
1. Coach receives a real, stored, unique `TRK-XXXX` code
2. Athlete enters that code and claims their squad row — coach and athlete genuinely linked
3. Athlete generates `PAR-XXXX`; parent redeems and links to the child

**Capture (REQ-001, REQ-002)**
4. Athlete logs a match with position inputs + live band preview *(built)*
5. Athlete sees band result and match history *(built)*
6. Coach builds a squad *(built)*
7. Coach assesses on 6 sliders → band *(built)*

**Close the loop**
8. **Athlete sees their coach's assessment** — bands and 6 category bars (`Strategy.md` §13)
9. **Coach sees linked athletes' logged matches** — bands only; private self-rating and body-condition inputs excluded
10. Athlete sets and tracks a goal (fixes A6)
11. Athlete earns medals (`lib/medals.ts` needs a table and a call site)

**Parent (REQ-004)**
12. Parent sees child's season band, match feed and coach assessments — read-only, private inputs excluded
13. Parent gives verifiable consent for a 13–14 year old and holds that consent record

**Measure (REQ-005)**
14. Every use case above emits telemetry to a table that exists, with a query that answers the Q4 metric

## PARKED — off in production

Sessions · attendance · meeting requests · coach progress dashboard ·
standalone wellness · parent alerts · profile depth (previous clubs,
connections) · child switcher · training log · highlights · CV export.

**Hard-deleted, not parked:** `src/pages/Dashboard.tsx`,
`src/components/coach/*` (7 files), `src/components/player/PlayerHome.tsx`, and
the 5 unguarded legacy routes. Dead parallel implementations are a security
liability.

**On parent alerts:** anti-requirement (F) caps them at 3 in-app types, and the
parent kill criterion needs parents to open the app — but push and email are
forbidden. Recommendation: keep alerts out, have the coach brief parents at
kickoff, and let <20% engagement cleanly falsify the parent thesis rather than
be blamed on a missing feature.

## Definition of done

On a real device, against staging:

- A coach signs up, receives a code, adds 3 squad players
- An athlete signs up, enters that code, claims their row, logs a match, and **sees their coach's assessment**
- The coach **sees that match**
- A parent redeems a code and sees their child's bands — and for a 13-year-old cannot proceed without a recorded parental consent
- The RLS suite passes: no role reads data belonging to anyone they are not linked to
- Airplane mode produces "couldn't connect — retry", never a blank screen or a false empty state
- `SELECT` on `telemetry_events` returns the Q4 metric over a seeded 8-week window

---

# Part D — Architecture

Approach: **spine first, then a narrow surface.** Fix the foundation everything
depends on, then rebuild only the loop's screens on a hardened data layer.
Rejected alternatives: hardening all 37 screens in place (arithmetic does not
fit the window), and a demo-grade veneer (the pilot *is* October, and real
minors' data would run on unverified access control).

## A-1. Identity link — roster-authoritative

The coach's roster is authoritative. The coach builds the squad first, as they
already do; each `squad_players` row can be claimed by an athlete via the
coach's code. Chosen over athlete-authoritative because it lets a coach walk
into the pilot with a populated squad on day one, and converts athlete signup
from a cold start into a coach-prompted claim — important when athlete-side
demand is the unvalidated thesis.

- New `connection_codes` table: owner, code (unique, indexed), type
  (`coach` | `parent`), created_at, revoked_at. Codes generated with the
  existing `generateCode()` alphabet, collision-checked on insert.
- Lookup by code via a `SECURITY DEFINER` RPC — following the pattern
  `get_parent_invite_by_token` already establishes.
- Claim writes `squad_players.linked_player_id`, in a transaction, idempotent,
  rejecting an already-claimed row.
- **P1 consequence:** matches and assessments key off the athlete's `user_id`,
  never `squad_player_id` alone, so history survives the coach leaving.

## A-2. RLS model

Implements `Strategy.md` §13, which is correctly specified and unbuilt.

| Reader | May read | Via |
|---|---|---|
| Athlete | own everything | `user_id = auth.uid()` |
| Athlete | assessments about them | `squad_players.linked_player_id = auth.uid()` |
| Coach | linked athletes' matches — **bands only** | join through `squad_players` on `coach_user_id` |
| Parent | child's matches, goals, assessments — **read-only** | `player_parent_links` |
| Nobody | another athlete's data | — |

Private match inputs (body condition, self-rating detail) are excluded from
coach and parent reads via column-restricted views, per `Strategy.md` §7.

**RLS must be enabled on all tables and proven by test, not by inspection.**

## A-3. Consent and age gate

Date of birth is already collected at onboarding. Greek digital-consent age is
15, which maps cleanly onto academy age groups.

- Age derived from DOB at signup; threshold held in one constant so it is
  configurable per market (NL is 16, UK 13).
- Athletes 15+ self-consent.
- Athletes 13–14 cannot have data written until a `parental_consent` record
  exists — timestamped, auditable, tied to the parent account.
- Deletion and export paths satisfy GDPR Art. 17 and Art. 20.

## A-4. Resilient data layer

Root cause: `const { data } = await ...` in 37 files makes discarding an error
the path of least resistance.

- **`src/lib/db.ts`** — a single typed wrapper where discarding an error is a
  **type error**, not a style choice. All data access goes through it.
- **react-query** for the ~15 in-scope screens: retry, cache, and genuine
  `isLoading` / `isError` states. Already a dependency, currently unused.
- **Root ErrorBoundary** plus a distinct offline state, so "couldn't load"
  never again renders as "nothing here".
- **Integration tests** for the full loop against a throwaway Supabase project,
  with three real authenticated roles.

## A-5. New screens

Three: athlete feedback view, coach's athlete-matches view, code claim.

---

# Part E — Infrastructure and readiness

## Verdict

**Not safe to onboard a real 13-year-old today** — not because the product is
bad, but because there is no environment separation, no verified access
control, no error visibility, no tested backup and no CI. If something went
wrong during the pilot, you would learn it from a parent, not from the system.

## Readiness scorecard

| Dimension | Status | Evidence |
|---|---|---|
| Access control | 🔴 | 5 identity tables, 14 policies, no RLS enabled (F5) |
| Environments | 🔴 | One `project_id` in `config.toml`, same as `.env`. **Development runs against production** |
| Secrets | 🔴 | `.env` committed (`6cec37e`); keys never rotated |
| CI/CD | 🔴 | No `.github/`, no hosting config. Nothing runs the 34 tests but memory |
| Backup / recovery | 🔴 | No evidence of PITR; no tested restore |
| Observability | 🔴 | No Sentry, no uptime check, no alerting; `telemetry_events` absent. **Blind in production** |
| Error resilience | 🔴 | No ErrorBoundary; failure renders as emptiness |
| Privacy / minors | 🔴 | No age gate, consent record, deletion path, privacy policy or DPIA |
| Auth hardening | 🟠 | 6-char client-side password minimum; `localStorage` sessions; implicit flow not PKCE |
| Public exposure | 🟠 | `robots.txt` allows all crawlers; Lovable OG image and `@Lovable` handle in `index.html` |
| Accessibility | 🟠 | `user-scalable=no` blocks pinch-zoom — fails WCAG 1.4.4 |
| Test coverage | 🟠 | 34 tests, all pure `lib/`; none cover auth, RLS or any screen |
| Build health | 🟢 | `tsc` clean, build succeeds |
| Product layer | 🟢 | Rating engine, bands, design language, match-log UX, parent token RPC |

Ten red, four amber, two green.

## Minimum viable infrastructure

Deliberately small — a 30-user pilot, not a platform. Everything below is free
or near-free tier.

```
GitHub (private)
   └── CI on every push: typecheck → test → RLS suite → build
          │
          ├── Supabase STAGING (new project, Frankfurt)   ← all development + CI
          │      seed script: 2 coaches, 15 athletes, 15 parents
          │
          └── Supabase PRODUCTION (existing, rotated keys)
                 PITR on · restore tested once · daily schema snapshot
                 │
                 └── Static host (Vercel/Netlify), one domain
                        password-gated or noindex — invite-only
                        Sentry (free tier) · UptimeRobot on /
```

Four principles:

1. Two environments, never one.
2. Nothing reaches production that CI did not check.
3. Every error is visible to the team before it is visible to a parent.
4. A restore has actually been performed, not assumed.

---

# Part F — Jobs to be done

## Gate 0 — Stop the bleeding (~3 days, first)

| Job | Done when |
|---|---|
| Rotate Supabase keys; purge `.env` from git history | Old key dead; `git log --all -- .env` empty |
| Create staging project + seed script | `npm run seed` populates a full pilot squad |
| CI: typecheck + test + build on push | A red build blocks merge |
| `robots.txt` → `Disallow: /`; strip Lovable OG tags | Preview shows Trak; crawlers excluded |

## Gate 1 — Safe (~15 days)

| Job | Done when |
|---|---|
| Enable RLS on the 5 identity tables | Migration exists **and** a test proves user A cannot read user B |
| RLS integration test harness | Suite runs in CI against staging with 3 authenticated roles |
| Age gate at 15 from the DOB already collected | 13–14 signup cannot write data without a consent record |
| Parental consent record + verification flow | `parental_consent` row exists, timestamped, auditable |
| Account deletion + data export | GDPR Art. 17 and 20 both work end to end |
| Privacy policy, DPIA, controller decision (D4) | Reviewed by Greek counsel |
| Raise password minimum server-side; enable leaked-password protection | Enforced in Supabase, not just the form |
| Delete dead tree + unguarded legacy routes | `/goals`, `/dashboard` no longer bypass `RouteGuard` |

## Gate 2 — Resilient (~12 days)

| Job | Done when |
|---|---|
| `src/lib/db.ts` — discarding an error is a type error | No `const { data } = await supabase` remains in scope |
| Migrate ~15 in-scope screens to react-query | Retry, cache, real loading and error states |
| Root ErrorBoundary + distinct offline state | Airplane mode shows "couldn't connect — retry" |
| Sentry + uptime monitoring | A thrown error reaches the team within a minute |
| PITR on, restore rehearsed once | Restore time written down |
| Integration tests for the full loop | Coach → claim → assess → athlete sees → logs → coach sees, green in CI |

## Gate 3 — Ready to onboard (~10 days)

| Job | Done when |
|---|---|
| `telemetry_events` + Q4 metric query | One SQL query answers "% logging weekly, unprompted" |
| Onboarding runbook + printed code cards | A coach onboards their squad without the team present |
| Restore pinch-zoom; axe-core pass on in-scope screens | No WCAG blockers on the 15 shipped screens |
| Support channel + incident runbook | A parent has somewhere to report; the team has a first response |
| Pilot dry run on real devices with 3 friendly users | The full loop completes on someone else's phone |

---

# Part G — Decisions pending

| # | Decision | Owner | Recommendation |
|---|---|---|---|
| D1 | Medals and goals in or out? | Kostas / Tarek | **In.** They are the engagement thesis, and both are ~80% built |
| D2 | Accept zero parent notifications? | Kostas / Tarek | **Accept.** Cleaner falsification of the parent kill criterion |
| D3 | Do 13–14 year olds join the pilot? | Kostas / Tarek + club | **Include** — but excluding them saves ~5 days of consent work |
| D4 | Data controller — Trak or the academy? | Greek counsel | Needed before October |
| D5 | If no club is signed by **end of August**, does October hold? | Kostas / Tarek | Set the date now; the CEO review flagged the missing deadline as an open risk |
| D6 | Restate the TAM before external conversations | Kostas | See T2 |
| D7 | Which docs are authoritative — root or `docs/pm/`? | Dimos | Collapse to one set; make `STATE.md` honest |

---

# Part H — Risks and time reckoning

The four gates total **~40 working days.** Against 10 weeks at ~1.5 fragmented
streams — with Kostas and Tarek also needing to land the club — realistic
capacity is **30–35 effective days.**

**Tight by roughly a week.** Three levers, in the order to pull them:

1. **D3 — if the pilot squad is U16+, the consent build mostly vanishes.**
   Saves ~5 days and closes the gap alone. Ask the club first.
2. **Drop medals (D1).** Saves ~3 days, but costs engagement signal during the
   exact 8 weeks engagement is being measured. Resist.
3. **Move the pilot to late October.** Cheapest of the three; nothing in
   `REQUIREMENTS.md` fixes the start date.

**Gate 1 is not cuttable.** Every hour there is spent on the thing that ends
the company if it goes wrong: a data incident involving minors, in the EU, at a
named academy, with no monitoring to detect it.

## Other risks carried forward

- **R1.** Athlete-side demand remains unvalidated (CEO review, Market Fit 2/5).
  The pilot is designed to test it; expect a meaningful chance of missing the
  Q4 metric. See T1 for the pivot decision.
- **R2.** No named pilot club as of this document. See D5.
- **R3.** F5 could not be verified against the live database. **First action in
  Gate 1 is to check the live RLS state**; if it is off in production, treat it
  as an incident, not a task.

---

## Next step

On approval: `superpowers:writing-plans` to turn Gates 0–3 into a task-level
implementation plan with TDD steps and verification commands per task.
