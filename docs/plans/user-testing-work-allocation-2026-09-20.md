# User-testing implementation plan and three-owner handoff

**Status: partially accepted after review; only the bounded reservations in the ledger are released.** Requested by Imad on September 20, 2026. Tarek has reviewed and accepted T-D/T-V, including CAP-01. Kostas has supplied and corrected his #44 review findings but has not yet accepted the broader K-A/K-C allocation. Unreviewed or overlapping work remains held. Silence is not acceptance. This is not approval to merge or change production.

## 1. Source of truth and settled scope

Canonical source: `kostasanastasioubusiness-lang/trak-football-hub`. Snapshot checked through the GitHub API: main is `4335e8984777b7b704e8706d3fe277352658c9ed` (#38), on September 20. Recheck before starting each task; this snapshot cannot account for later pushes or unpublished local work.

The source is Imad's `trak_use_cases_and_testing.md`, with all 41 grouped observations retained in the [existing inventory at f88db54](https://github.com/imadd23x/trak-football-hub/blob/f88db54/docs/testing/user-testing-2026-09-20.md). The [academy-led admission decision](https://github.com/imadd23x/trak-football-hub/blob/9408ea9/docs/plans/academy-led-admission.md) overrides conflicting signup observations:

1. Owner-issued academy administrator activation; academy-issued coach invitations. Verified recipient, one-time expiring activation, fixed role and academy. No public staff self-registration or shared-code admission.
2. Academy approval of **fully waived enrolment** activates one shared household login. No payments now or later in the pilot, no payment details, billing integration, or automatic paid conversion.
3. Consent precedes ordinary household dashboard access, child username/password creation, child access and development processing. No child email required. Parent-managed credential recovery is part of this flow.
4. Academy assigns eligible, consented children to coaches using stable identities. Manual name-only child creation and shared-code linking are legacy paths to replace, including backend bypasses.
5. Approval is academy-specific. Historical independent-guardian records must be preserved; the previously agreed continued approval/parent-visibility rules must be reconciled with a shared household identity explicitly, not silently discarded. A shared login alone cannot identify the adult who signed; record the named guardian's attestation with household authority and immutable events.
6. Private coach notes remain private unless explicitly published. Draft AI feedback remains private until coach approval. Preserve existing histories; no name/email-based automatic household or player merges.

September 25 remains the documented **synthetic phone demonstration**, not authorization to admit real children through legacy paths. The real-child gate remains separate. No payments, slide 5 financial work (Chris owns it), character/medals, multi-sport, or broad redesign is added here.

## 2. Review before implementation: immediate assignments

**Kostas and Tarek: first review this plan, your current main/PR diffs and your agents' local work. Do not begin the new implementation packages below until this review is reconciled.** Continue no overlapping edits on assumptions about another person's branch. Report already-completed work so we reuse it.

Reply in the plan's #coding-agent-reviews thread using:

```text
PLAN REVIEW — [name], main [full SHA]
Already on main: [UT IDs, commit, relevant runtime/test evidence]
Existing unmerged/local work to reuse: [UT IDs, repo/PR/branch, exact head, files]
Conflicts or superseded requirements: [specific files/functions and proposed owner]
Accept/change allocation: [package IDs]
First bounded task after reconciliation: [branch/base, reserved files/RPCs, tests]
Dependencies/decisions: [specific missing contract or product choice]
```

Imad reconciles each package with its affected owners and posts `PLAN ACCEPTED — [bounded task]` with exact reservations. Independently reviewed, non-overlapping work can proceed while another package awaits its owner; this is not global acceptance of the plan. A PR title, green badge, old review or merge into a feature branch is not completion. Review the final delta and the actual routed page. Do not close/supersede someone else's PR without agreeing with its owner.

### Existing work to reuse before writing replacements

All numbers below refer to upstream unless explicitly marked **fork**. This is a review map, not a release queue.

| Existing work, verified head | Current disposition and next action |
|---|---|
| Main #38 / `4335e89`; #59/#62/#68 already merged | Reuse calendar-date, credential-removal and grant fixes; do not recreate them. Deployment/runtime checks remain separate from source history. |
| #55 and #57 already merged | Tarek retests remaining export/calendar observations against these changes. #55 already centralizes card export and band/age logic; #57 already delivers part of the old #42 description. Do not rebuild those fixes from the original report. |
| #74 `9408ea9`, draft | Imad owns staff admission. Foundation committed and CI green. Additional email/activation/management work is **local and uncommitted**, not part of that reviewed head; reserve it and do not duplicate it. Current local checks have type errors in new tests and one incomplete browser fixture; not a green release candidate. |
| #70 `8467ecd`, draft; **fork #3** `9ced1cd` | Imad's consent authority and development read/write cutover. Reconcile household identity, existing history, AI/export/deletion before release. Do not replace with a second consent system. |
| **fork #1** `a15219b`; #48 `43db21e`, #49 `01304a4`, #50 `6d3bb25` | Parent details, Settings account boundaries, retained history and consent recovery already implemented in branches. Review incremental parent changes and their integration base, not a blind squash of the stack. |
| **fork #2** `f74a8a7`; #71 `7216ae0`; #72 `9ddcf31` | Private-avatar UI, password visibility, UTC database birthday correction already have tests and review requests. Reuse; deployment is pending. Avatar UI does not prove Storage-policy correctness. |
| #73 `f88db54`, draft | Transitional truthful signup responses. Public signup is being replaced; carry applicable error/recovery behavior into admission, not the obsolete registration model. |
| #44 `8e72e80` | Still OPEN. Both previously raised holds independently verified corrected; see the scoped evidence below. This is not production approval or proof that the whole platform is ready. |
| #51 `5beba3b` | Tarek's exact goal-count/rating-key work overlaps `CoachAddSession` in #44. Reuse `match-input-keys` and its tests. It already stores exact numbers independently of rating buckets. The remaining range change is its ceiling/options (0–6 to 0–10), plus boundary/consumer validation; do not redesign storage. Kostas owns the final form; Tarek hands off and reviews the mapping. |
| #42 `918d8c3`; #66 `de85bea` | Tarek owns calendar contracts and the SQL suite registry; #38 dependency is satisfied. #66 carries an older snapshot of #42 work, not its current head (verified ancestry); it supplies scorecard tests. Integrate #42 first, then reconcile #66 against that exact base. Do not overwrite current runner/birthday coverage with an older file. Verify each final delta after main changes. |
| #40 `1457b65`; #47 `2681685`; #53 `4061175` | Tarek owns AI approval, deletion tests and consent-coverage tests. #40's title/body understates its current files: it already includes an Edge Function and coach review page. Reconcile household/consent and private-note contracts; do not implement a duplicate review workflow. |
| #17 `8b16f4a`; #45 `f54b56f` | Legacy coach-code linking/history work. Tarek identifies reusable identity/history safeguards; do not ship new code-based admission as the target architecture. Prior Settings integration is evidence to preserve behavior, not a reason to retain obsolete copy. |
| #34 `805ccb2`, #36 `efb7b0a`, #37 `b8c3a19` | Imad owns coordinated migration/integration repair; all three carry the same older trigger definition. No branch may reintroduce a superseded definition after another is fixed. |
| #46 `3c2a6e3`, #65 `8cb066c` | Imad owns release governance. #68 already supplied filename validation; retain #65's useful documentation/ignore rules without duplicating the validator. Reconcile old Friday/pilot wording with the current gate. |
| #43/#60/#63/#64/#67 | Review documentation against actual delivery; do not let old claims or workshop suggestions override the agreed architecture. Slide 5 remains Chris's. |

**#44 review holds corrected at `8e72e80`, independently checked:**

- The three files from fork correction `1b6b3e2` are byte-identical in #44. All eight rendered/real-SDK assessment regressions pass on its current head; no competing implementation was introduced.
- `20260919170000` matches its original blob `fe72f5349f6decf5ebb9c7ac9bddb6ca37f5c584`. Forward repair `20260920104500` restores the policy and correct comment. Six SQL suites pass on each of fresh 74 migrations, released-main 66 plus eight pending migrations in deployed order, and a preview already past the old DROP. All three converge on PostgreSQL 17 to policy present, DELETE absent, SELECT/INSERT/UPDATE intact and comment hash `fe45a829f8ff304046166e807f796062`. No live database was written or reset by this verification.
- Imad accepts the narrow new `package.json` convergence script and CI test-step additions as the reviewed integration hunks; no revert/reimplementation is needed. This does not hand general ownership of those files away.
- #66's unpublished match-fixture positive control still needs reconciliation with #44's published-only metric. Tarek owns that fixture correction and joint retest; do not weaken the published-only query.
- Evidence: [current-head review](../reviews/pr44-current-head-2026-09-20.md). The two scoped holds are cleared; production approval and integration of remaining dependencies are separate.

## 3. Delivery packages and accountable owners

These are assignments for the three people and their agents. Dependencies below permit parallel work after plan review; they do not authorize simultaneous edits to shared files.

### I-A — Imad: admission, household identity and consent (first priority)

UT-01/03/18/19/20/21/22/39/41; consent part of UT-02/05/08/14/35.

- Complete existing #74 staff delivery/activation/management and regressions. Preserve existing-account passwords, truthful delivery states, recipient binding, expiry, revocation, idempotency and shared-phone identity boundaries.
- Define and publish the household/enrolment/child/consent interface before K-A writes consumers. Implement academy-approved waived enrolment, household activation, hard consent gate, child username/password creation/reset and explicit account choice. No public role or metadata provisioning bypasses.
- Reconcile #70/fork #3 with household authority and all read/write/AI/export/deletion consumers. Withdrawal and enrolment removal must affect already-issued sessions as well as login. Preserve legacy audit evidence and records; no silent identity migration.
- Own `AuthContext`, `RouteGuard`, signup/callback/recovery routes, staff/household auth libraries, admission/consent schemas and authorization helpers. Tarek/Kostas send contract requests or patches for these, not independent replacements.

Acceptance: owner → academy → coach and academy → household → consent → child login work with synthetic identities; wrong recipient/role/academy/household, expired/reused/revoked links, duplicate requests, delayed failures and existing sessions cannot bypass eligibility. No payment fields, scheduled charges or child email requirement. Database role tests and concurrent withdrawal/write tests complement routed browser tests. Real mail latency/expiry is verified later using approved synthetic inboxes; a provider accepting a request is not delivery.

### I-P — Imad: parent experience and shared account surfaces

UT-15/16/17/20/22/33/35; parent consumer of UT-10/14.

- Reuse fork #1/#2 and #48–50/#71. Complete exact-record details, complete-history stats, next confirmed session/location, consistent connection state, account-bound Settings and private-avatar display/retry.
- Consume T-D's canonical stats/calendar contracts. Do not independently define clean sheets or event dates inside parent pages.
- Own parent pages/components, `ParentFamily`, `Settings.tsx`, shared password/avatar components and their mounting changes in the four own-profile pages. Tarek/Kostas coordinate their profile changes through this owner until the avatar diff is integrated.

Acceptance: two children, pagination, correct selected record, missing versus zero, denied/failed fetch with retry, cancellation, account switch, refresh and accessible phone layouts. No private notes or AI drafts in parent responses. Avatar reload/replacement passes and T-V verifies backend read/delete boundaries.

### K-A — Kostas: academy roster and coach assignment

UT-02/04/05; academy part of UT-01/03/41. Wait for I-A's agreed interface, not its complete UI, before schema-dependent implementation.

- Build approved/unassigned-child lists, single/bulk squad assignment and coach selectors from stable registration IDs. Only current academy authority may assign eligible children; validate eligibility again at write time.
- Replace `CoachAddPlayer` name-only admission and shared-code assignment callers. Replace enforced UC-C02 with the positive academy-assignment journey **and** an old-manual/API-path denial regression; do not merely delete the test.
- Own new assignment RPCs and assignment-specific migrations, `ClubSquads`, coach roster selectors and squad membership behavior. I-A retains enrolment/identity/consent functions. `ClubHome`/`ClubProfile`/`ClubCoaches` staff invitation edits are currently reserved by Imad; exchange focused handoff patches before editing those files.
- UT-05 is a confirmed synthetic name mismatch (linked George profile, roster display Jamie), not proof of a missing identity. Reconcile using reviewed stable IDs and deterministic fixtures; no fuzzy merges or live seed replay.

Acceptance: two academies, two coaches, several children; no unapproved/wrong-academy selection or direct write; duplicates/retries are safe with per-row bulk outcomes; same identities/history appear across all roles; reassignment/departure revokes old access and preserves history. Do not preserve NULL/unknown-age loopholes just to make an old fixture pass.

### K-C — Kostas: coach logging, history, notes and schedule authoring

UT-06/07/08/11/12/23/24/25/26/27/28/29/30/31/32; coach writer for UT-10/13/14.

- First reconcile #44 and existing fork `1b6b3e2`; absorb #51's mapping with Tarek's review. Avoid expanding the large #44 with unrelated new work: use focused follow-up branches after its reviewed base.
- Fix the **routed** `CoachAddSession` flow (not the currently unrouted `CoachQuickMatchLog`): integer minutes 0–120, integer goals/assists 0–10, no invented facts, truthful partial-save recovery, match/training/other semantics and consistent selection. Store exact numbers separately from rating buckets.
- Open/edit actual saved session and assessment history including permitted notes; dashboard session count opens history; remove duplicate quick/full entry paths; preserve draft values and prevent cross-player async writes. Loading/error must not flash false zeros or empty squads.
- Add goalkeeper coach specialty, align manual with released behavior, and propose the optional recent-assessment simplification. Do not infer a new permission role from a specialty.
- After Tarek explicitly hands off #42's `CoachSchedule` writer, fix smart-calendar authentication and missing-field clarification before event creation. Require confirmation; do not invent days/times. Keep private/shared notes separate and explicitly published.

Acceptance: full save/read/edit round-trip for match, training and other; boundary and server validation; deferred/failed/partial responses, retries without duplicates; saved zeros survive; private notes stay private; impossible match contributions are rejected against an agreed academy team-format/duration model. Do not assume all matches are 11-a-side or that roster size alone implies impossible participation.

### T-D — Tarek: player experience and shared data contracts

UT-09/10/13/34/36/37/38/40; player/calendar side of UT-14, handoff for UT-12.

- Audit #55/#57 and current exports first. Fix residual passport/evolution clipping by inspecting actual output images, fonts, long text, varied phone widths and complete content. Demonstrate Series 2 with deterministic synthetic progression and retained card history.
- Remove the requested season-bands overview; move parent connection status from Home to Profile. Review optional recent-match simplification while keeping history discoverable. Household admission replaces player-issued parent invites.
- Own the canonical four-position normalization and full-history stats contract used by coach/player/parent callers. Publish interfaces and fixtures before consumers change. Clean sheets use the player's **own team's conceded score**, with known participation/position eligibility; unknown facts must stay unknown. Do not fabricate backfilled totals from scorelines without the needed facts.
- Own existing `match-input-keys` mapping/tests; hand #51's form edits to Kostas. Maintain one engine vocabulary. Treat any rating-weight change as a separate product decision.
- Finish/review #42 calendar helpers and player callers, then explicitly hand the schedule writer to Kostas. Parent consumers stay Imad-owned. Published/confirmed event audience, cancellation, location, Dubai/Athens dates and DST must be one agreed contract.

Acceptance: exact totals across pagination, one shared position vocabulary including existing aliases, zero versus absent values, own-team home/away clean-sheet fixtures, no clipped exports, visible next series, no stale/wrong-account facts. Imad explicitly confirmed coach-only logging for this pilot on September 20. Retire UC-A02 (player logs a match) and UC-A03 (result after that save) from active pilot scope, preserve the decision/history, and remove or archive obsolete active tests without relabeling them as passes. Retain positive player/parent viewing of coach-recorded matches and truthful band display coverage. Use a separate bounded registry/test/documentation branch; do not create the missing player logging routes. Backend coach-only write enforcement remains a coordinated K-C/I-A requirement with T-V denial tests, not permission for the registry-retirement task to edit shared auth/schema.

### T-V — Tarek: independent verification, AI publication and erasure

Reuse #40/#42/#47/#53/#66, not new parallel systems.

- Own the SQL suite registry in `scripts/test-db.mjs`, independent cross-academy/consent/adoption/deletion tests, and #66 scorecard scope/date regressions. Owners add suite pragmas; request runner changes from Tarek.
- Integrate AI draft/review/publication with I-A's academy/purpose checks and K-C's note privacy. Include service-role/Edge Function bypass paths, not only browser policies. No child data sent to AI before the required authority exists; no drafts/private notes returned to child/parent.
- Verify all-role and new household/child deletion, retention/export behavior and Storage root-key read/delete rules. Coordinate any `delete_my_account`/export function edits with the single writers below before changing them. Retained consent evidence is a reviewed policy choice, not an accidental orphan.
- Independently review I-A's staff/household authority and K-A's roster assignment; use positive controls plus regressions that demonstrably fail before a fix. Legacy unknown-age/manual-roster gaps are closed only when backend and callers both enforce the replacement.

Acceptance: real-role disposable SQL + native concurrent operations, both migration replay orders, no unrelated child's deletion, no foreign record access, no unapproved feedback, scorecard counts only the intended cohort/date window. A synthetic second academy is an isolation fixture, not staging or a backup.

### I-R / operational owners — Imad coordinates integration and release

- Imad owns the accepted plan, dependency/UT ledger, fork integrations, release queue, agreement/privacy/charter drafting and support-owner decisions. Kostas/Tarek review Imad's code; Imad reviews their code. This allocation does not substitute agent verdicts for required human approval.
- Kostas owns preparation of pilot cohort/org/date/duration configuration, second-academy setup and backup/restore rehearsal evidence. Coordinate with Imad for real academy details and production authorization; do not choose a real pilot start from the synthetic demo date. Tarek reviews scorecard evidence.
- Kostas coordinates status/evidence of previously requested credential rotation and checks of older deployment access; current status must be verified. Do not post secrets or claim older URLs are exposed merely because they are unverified.
- Imad owns #34/#36/#37 trigger-collision repair, #46/#65 integration, immutable migrations and release records. Keep all copied branches consistent. Do not merge a stale definition back later.

## 4. Single-writer reservations and required handoffs

| Shared surface | Writer / handoff rule |
|---|---|
| `src/contexts/AuthContext.tsx`, auth routes, `src/components/layout/RouteGuard.tsx` | Imad. Preserve account/role guards while integrating admission; do not follow stale documentation paths. |
| `src/App.tsx`, `src/integrations/supabase/types.ts`, `.github/workflows/ci.yml`, `playwright.pilot.config.ts`, `supabase/config.toml`, `package.json` | Imad integrates narrow owner-supplied hunks; no competing whole-file replacements. Existing PR diffs are preserved and reconciled. |
| `scripts/test-db.mjs`, suite-discovery logic | Tarek. Keep #42 registry, `migrationReplayOrder` and assertion output. Add missing pragmas to #34/#37 suites; #70/#72/#74/#44 already have their new suite pragmas. |
| `trak_admission`, household/enrolment/child identity, `trak_consent`, consent/provenance guards | Imad. Kostas owns assignment consumers and assignment RPCs after the agreed contract. No second admission/consent gate. |
| `CoachAddSession.tsx`, coach assessment/squad/history | Kostas. Tarek hands over #51 form delta; Imad's existing `1b6b3e2` is a repair to reuse, not a competing feature branch. |
| `CoachSchedule.tsx`, event-time helpers | Tarek until #42 caller contract/diff is accepted; explicit writer handoff to Kostas for schedule UI; helpers remain Tarek-owned. |
| `PlayerHome.tsx` | Tarek integrates #44's published-feedback reader and #42 calendar delta while preserving removal of the private-note query. Kostas supplies the exact hunk, not a second rewrite. |
| `Settings.tsx`, shared password/avatar components, own-profile avatar mounting points | Imad until fork #2/#71 integration; coordinate all profile changes before editing. Storage policy work is Tarek's separate task. |
| `pin_org_id_on_update`, `set_squad_player_org_id` | Kostas's reviewed #44 intent plus Imad's coordinated #34/#36/#37 resolution; preserve both attribution and deleted-academy history protections. Neither merge order alone solves replacement collisions. |
| `delete_my_account`, `export_my_account` | Kostas owns current #44 repair/export bodies; Imad owns household/consent maintenance boundaries. Agree the final function contract and one writer before either replaces it; Tarek verifies. |
| stats/position helpers and rating-input keys | Tarek owns shared model; Kostas coach writer and Imad parent reader consume it. Announce changes to `types.ts`, `rating-engine.ts` or SQL match contracts before editing. |
| migration files and tests | Unique forward versions created with the CLI; owner reserves table/RPC scope. Never edit another task's historical migration or use a duplicate version. Tests added with the change stay with its owner. |

A file reservation is temporary execution coordination, not exclusive product ownership. A handoff records the accepted commit, remaining patch, next writer and tests. Conflicting existing PRs are resolved by combining required behavior, never by choosing an entire side for convenience. Each new task gets one bounded branch, an exact base and explicit dependencies; do not grow one omnibus PR per person.

## 5. Sequence, decisions and completion bar

**Wave 0 — package-specific review:** Tarek has completed his review; his isolated export task and separate coach-only use-case retirement are released below. Kostas still owes his K-A/K-C acceptance/first-task reply. Existing #74 follow-up stays within Imad's already-announced reservation, with Tarek confirming no overlap. New household/assignment interfaces remain held until the affected owners reconcile them. No global acceptance or production authorization is implied.

**Wave 1 — after acknowledgment:** Imad finishes the existing staff slice and publishes the household/consent interface. Kostas clears #44's two holds and scopes focused coach follow-ups. Tarek verifies #42/#51 handoffs and reproduces residual player/export issues against already-merged fixes. These can proceed independently within the reservations.

**Wave 2 — after interface agreement:** household/consent work, academy assignment and player/coach/parent consumers proceed in parallel against pinned contracts. Independently review schema boundaries before integration. Tarek's model fixtures unblock shared stats; #42's handoff unblocks schedule UI and parent next-session work. Existing implemented slices are reviewed/reused rather than rewritten.

**Wave 3 — integrated candidate:** two academies, all four roles, several children and shared phones; owner/academy/coach/household/child admission; record save/read/edit; scheduling; private/shared/AI feedback; withdrawal with active sessions; departure/reassignment; exports and deletion. Replace obsolete acceptance journeys with new positive and denial tests. Run the current-main dependency composition, not just each branch in isolation.

**Wave 4 — release and live synthetic rehearsal:** peer review at final head, required checks, explicit Imad production authorization, serialized backend then frontend delivery, observed live synthetic journeys and phone/email checks. This plan does not grant production permission. Stop the queue on failed deployment and inspect what actually applied. Use reviewed forward repairs; a compatible frontend revert must not reopen old admission or privacy bypasses.

Decisions to resolve before the affected implementation (owners submit concrete options, not assumptions): match formats/duration/substitution constraints (Kostas); participation/position eligibility for clean sheets (Tarek); multi-academy child access when one academy's consent is withdrawn (Imad); deliberate mapping of existing separate guardian accounts into households and named-consenter evidence (Imad with policy review). Never impose a global multi-academy suspension or retain an access loophole by accident. Optional dashboard simplifications/manual content can be proposed without blocking admission work.

For every changed journey, record reproduction or positive baseline, regression evidence, exact commit and test results. Run the repository's required source/harness/typecheck/build/lint/use-case checks; SQL changes also require real-role disposable replay and deployed-order/upgrade coverage. Use native PostgreSQL for races. Render actual exported assets and built-app phone-sized journeys where relevant. Do not call a pending test pass, or treat mock HTTP as live email/backend verification.

Status vocabulary: `reported` → `reproduced` → `implemented` → `tested` → `independently reviewed` → `merged` → `deployed` → `live synthetic verified`. Keep every stage distinct. A partial fix may close part of a UT item only, with the remaining scope named.

Real-child admission additionally requires reviewed agreement/notice/retention responsibilities, complete consent enforcement, appropriate access reviews, verified deletion, restore evidence, correct pilot configuration and a named support owner/inbox. No passing code subset or waiver proves overall compliance or a bug-free platform.

## 6. Complete UT allocation index

The linked source inventory supplies the detailed original observations. This index gives every item one accountable lead; dependencies do not create multiple writers.

| UT | Outcome | Accountable lead / package |
|---|---|---|
| 01 | Owner/academy-issued staff admission | Imad I-A; Kostas academy consumer |
| 02 | Registered, consented roster and selectors | Kostas K-A; Imad eligibility contract |
| 03 | No unconsented development processing/access | Imad I-A; Tarek independent coverage |
| 04 | Bulk assignment of approved children | Kostas K-A |
| 05 | Stable identity/name/history reconciliation | Kostas K-A; Tarek fixtures, Imad parent validation |
| 06 | Goalkeeper coach specialty | Kostas K-C |
| 07 | Coaching manual matches released workflows | Kostas K-C |
| 08 | Separate private notes and published feedback | Kostas K-C; Imad parent consumer, Tarek AI |
| 09 | Remove player season-bands overview | Tarek T-D |
| 10 | Complete truthful goals/assists/clean-sheet totals | Tarek T-D contract; Kostas writer, Imad parent reader |
| 11 | Session entry/navigation and count opens history | Kostas K-C |
| 12 | Exact validated minutes/goals/assists | Kostas K-C; reuse Tarek #51 |
| 13 | Four positions, existing-alias normalization | Tarek T-D; coordinated consumer handoff |
| 14 | Confirmed calendar reaches child/parent; next session | Tarek T-D contract; Kostas writer, Imad parent UI |
| 15 | Parent Home record details | Imad I-P; reuse fork #1 |
| 16 | Parent match detail access | Imad I-P; reuse fork #1 |
| 17 | Parent alerts open exact record | Imad I-P; reuse fork #1 |
| 18 | Clear DOB back navigation in surviving admission flow | Imad I-A; obsolete public-signup flow not expanded |
| 19 | Truthful duplicate/failed signup and delivery responses | Imad I-A; adapt #73 |
| 20 | Password visibility | Imad I-P/I-A; reuse #71 |
| 21 | Confirmation/resend/expiry and real-email evidence | Imad I-A |
| 22 | Explicit account choice and callback/session safety | Imad I-A/I-P |
| 23 | No false empty/zero coach loading states | Kostas K-C |
| 24 | Smart-calendar authorization failure | Kostas K-C after #42 handoff |
| 25 | Clarify missing schedule fields before creation | Kostas K-C |
| 26 | Review redundant coach Home assessments | Kostas K-C |
| 27 | Match/training assessment and participation clarity | Kostas K-C |
| 28 | Descriptive assessment history | Kostas K-C |
| 29 | Match/Training/Other order and consistent selection | Kostas K-C |
| 30 | Feasible team/player match contributions | Kostas K-C; format decision first |
| 31 | Session notes/details/history and authorized edit | Kostas K-C |
| 32 | Preserve Other/gym/video session semantics | Kostas K-C |
| 33 | Private-avatar upload/display and cleanup | Imad I-P UI; Tarek T-V Storage boundaries |
| 34 | Parent connection status on player Profile | Tarek T-D; household contract from Imad |
| 35 | Consistent Settings connection state | Imad I-P |
| 36 | Passport export layout | Tarek T-D; retest #55 first |
| 37 | Evolution export layout | Tarek T-D; retest #55 first |
| 38 | Demonstrate Series 2 progression/history | Tarek T-D |
| 39 | Safe personalized activation email greeting | Imad I-A; configuration approval before production |
| 40 | Review redundant player recent matches | Tarek T-D |
| 41 | Fully waived household/child admission architecture | Imad I-A; Kostas K-A assignment, Tarek verification |

## 7. Multi-user performance and recovery gate (CAP-01)

The goal includes concurrent users and responsiveness, not only the 41 functional observations. This gate is additional to the UT index. **Tarek accepted harness/result ownership and the proposed workload shape; final cohort targets, budgets and execution evidence remain pending.**

Read-only source evidence at main `4335e89`: `CoachHomePage` loads historical assessment rows for squad analytics; `CoachSquadPage` loads assessment history to choose latest values; `ClubHome` loads coaches, roster and assessments in a serial chain; `PlayerHome` loads match history without explicit pagination. These are profiling targets, not measured latency failures. Recheck against #44/#42 and the integrated candidate before optimizing. The old `docs/plans/ARCHITECTURE.md` assumes “30 users, no concurrent editing”; that is not an agreed capacity requirement or evidence of readiness for this pilot.

**Ownership:** Tarek/T-V owns the repeatable synthetic load harness and results; Kostas supplies expected academy/cohort sizes and peak simultaneous coaches/families, and repairs measured coach/academy bottlenecks. Imad supplies household/admission scenarios, repairs parent/auth bottlenecks and verifies the integrated release. Each owner keeps their file reservations; query/index changes use existing #37 work where applicable. No new performance library or shared-file change without announcing it in the same thread.

Before execution, record the tested commit, database history, machine/service sizing, client/network profile, expected peak concurrent users, data volumes and external-service limits. Confirm the real cohort and proposed response budgets in the review. A provisional ramp of **5 → 20 → 50 simultaneous users** can establish a baseline; extend it beyond the agreed peak plus headroom if that is larger. Fifty is a test point, not an asserted pilot limit. Generate expected-cohort and 10-times-history datasets with at least two academies, all roles, multiple children and explicit synthetic consent.

Use a disposable, isolated test deployment/database with synthetic identities. A Vercel preview attached to live Supabase is **not** an isolated load-test environment. Do not load-test the shared production project, send bulk real emails, or consume real AI calls for this exercise. Stub email/AI delivery at the boundary and clearly exclude those external latencies from the results; real email/AI functionality still has its own controlled verification.

Run these workloads after the affected contracts are accepted:

1. Normal traffic: dashboards, roster filtering, history pagination, parent child switching and schedule reads, mixed with independent session/assessment saves.
2. Conflicts: two edits of one record; same request retried after a lost response; parallel bulk assignments; consent withdrawal/departure while another actor saves or reads. Define and test conflict behavior; do not silently lose an accepted update. Native lock tests are useful here but do not substitute for HTTP capacity testing.
3. Recovery: expired session, temporary network/database failure, delayed response and return online; no false success, duplicated records, endless spinner or retry storm. Permission-denied cases are expected and counted separately from unexpected failures.
4. Sustained traffic: a documented steady-state run and soak long enough to expose increasing memory, pool use or request queues; report actual duration, not just a single burst. Compare first and last windows and verify pending work drains after traffic stops.

**Proposed review budgets:** p95 ordinary data reads at or below 1 second and writes at or below 2 seconds at the agreed peak, excluding separately measured external email/AI work. Record p50/p95/p99, throughput, payload sizes, timeouts, unexpected 4xx/5xx, database connections/locks and browser errors. Also record request count and the longest dependent-request chain per screen: compare cold/warm loads and realistic mobile RTT/bandwidth, including one-user behavior. Agree screen-specific budgets against the integrated routes, preserving required authorization checks. Tarek's main-only PlayerHome chain includes a private-note read removed by #44; benchmark the final integrated reader, not a soon-to-be-removed path. RTT samples or CSS inspection are preliminary evidence, not measured phone/render results. These are initial engineering targets for team agreement, not measured results or a user-approved service promise. Measure actual phone interaction separately; fast SQL alone does not prove a responsive screen.

Pass requires zero unexpected crashes/server errors and no duplicate, lost, unauthorized or cross-academy records in the exercised workloads; bounded queues/memory and recovery after injected failures; accurate complete totals beyond API row caps; stable pagination; the agreed latency budget at the agreed peak. Count fixture rows before and after so a workload that sent no meaningful writes cannot pass. Preserve failing evidence before fixing it. An index or cache is accepted only after measuring the affected query/route and rerunning correctness tests; caching must not weaken withdrawal or departure enforcement.

Attach reproducible commands, workload/data definitions and result artifacts to the integration PR. Rerun after changes that affect the measured paths. Production readiness cannot be inferred from mocked HTTP, local-only timing, old 30-user assumptions or a green unit-test run.

## Review and reservation ledger

Review discussion: [#coding-agent-reviews plan thread](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789907439602529). Source snapshot remains main `4335e89`; no plan or #44 production merge has been performed here.

| Owner | Review state | Bounded accepted reservation / remaining hold |
|---|---|---|
| Imad | Reconciled Tarek's review; independently verified #44's two fixes | I-R coordination/reviews active; existing #74 staff follow-up may resume in its original branch/reservation. New household/assignment contracts wait for affected-owner reconciliation. |
| Kostas | Both #44 fixes verified; broad PLAN REVIEW reply still awaited | K-A/K-C proposed, not globally accepted. Existing #44 correction retained; next match-validation follow-up needs exact rules/reservation from Kostas. |
| Tarek | Accepts T-D/T-V and CAP-01 ownership | T-D export audit/fix released: `src/lib/card-export.ts`, `PlayerPassport.tsx`, `PlayerEvolutionCard.tsx`, their focused tests. Separate UC-A02/UC-A03 retirement released below. Shared contract/AI/deletion changes still require their specific handoffs. |

### Accepted handoffs and remaining corrections

- **T-D export task:** use repository-locked Playwright and install its matching Chromium if absent (`npx playwright install chromium` after confirming the lockfile version). This normal task dependency is authorized; do not upgrade the repository toolchain or require an unnecessary permission round-trip. Use synthetic data, render/download the actual image, inspect edges/text/fonts at varied widths. Source `truncate`/ellipsis styling alone does not prove that long text is handled acceptably; rendering remains required. No shared App/Auth/Settings/schema edits are included.
- **Coach-only use-case retirement:** Imad's explicit answer is “Yes—coach-only logging for the pilot.” Tarek may use a separate task branch for `docs/use-cases/registry.yaml`, its lock, the obsolete athlete self-log test and decision documentation, preserving current registry invariants. Supply any necessary shared script/package changes as hunks to Imad. Retirement is a scope decision, not a repaired route or passing behavior. Keep player/parent read journeys and report remaining debt honestly.
- **#40 integration:** keep the existing PR; do not land it early to evade reservations or open a duplicate feature PR. Tarek supplies a current-base hunk/dependency manifest for App/types/package and coordinate CoachSchedule/PlayerHome deltas. Imad integrates the shared hunks preserving current additions; Tarek retains PlayerHome/event helpers until explicit schedule handoff. No whole-file checkout from an old branch as a conflict resolution.
- **#42/#66 correction:** verified current #42 is not an ancestor of #66. Preserve #42's current runner and birthday test on integration. At `de85bea`, #66's age test calls `dob(17)` with default day offset zero, so the reported “widened boundary” characterization is not reproduced in that file; an older snapshot is confirmed, weakened birthday coverage there is not. Ask for a specific contrary location before recording it as fact.
- **#51 correction:** exact-count storage and rating-key separation already exist. Reuse them; extend the numeric range and regression coverage without changing rating weights.
- **Manual player creation:** settled by Imad's controlling architecture, now also reported by Kostas. No coach-created name/age-band development identity. C1 is closed only after positive eligible assignment and negative legacy/API bypass tests pass; architecture prose alone does not close it.
- **Timing:** Kostas reports academy registration on Friday and child/coach/parent use the following Monday as intended dates. These are not evidence of readiness or new production authorization. Imad's real-child gates and confirmed academy configuration still apply.

Post exact task head, file/RPC reservations, evidence and explicit handoff when a task changes owners. Unaccepted packages remain proposed; independent accepted work need not wait for unrelated package decisions.
