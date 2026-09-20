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
7. Coach-only match logging for the pilot is confirmed. Players and parents view coach-recorded matches. Retiring UC-A02/A03 is separate from proving backend player-write denial. Manual minutes are integers 0–120; goals/assists are integers 0–10, as specified in the original testing file.
8. **Academy data stays with the academy when a coach leaves.** Imad confirmed this pilot product rule on September 20. Academy records include roster/child development history, assessments, notes, awards, attendance, session plans and calendar events. Departure or transfer removes the former coach's read/write/export authority, including already-issued sessions; author IDs do not confer portable ownership. Records and historical academy attribution remain intact, and joining another academy must not transfer them. Personal account data is a separate export scope. Retention does not publish private notes or AI drafts or override consent. [Verified gaps, test handoff and implementation contract](../reviews/coach-departure-ownership-2026-09-20.md).

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
| #74 `c910829`, draft | Imad owns staff admission. Email/activation/management follow-up is committed to the fork; both CI runs pass. Local evidence: 420 source tests, nine browser journeys, 14 baseline/mutation controls, five SQL suites and 13 native PostgreSQL races. Tarek reviewed only foundation `9408ea9`; current-head extension review is requested. Household/provider/bootstrap gates remain. |
| #70 `8467ecd`, draft; **fork #3** `9ced1cd` | Imad's consent authority and development read/write cutover. Reconcile household identity, existing history, AI/export/deletion before release. Do not replace with a second consent system. |
| **fork #1** `a15219b`; #48 `43db21e`, #49 `01304a4`, #50 `6d3bb25` | Parent details, Settings account boundaries, retained history and consent recovery already implemented in branches. Review incremental parent changes and their integration base, not a blind squash of the stack. |
| **fork #2** `f74a8a7`; #71 `7216ae0`; #72 `9ddcf31` | Private-avatar UI, password visibility, UTC database birthday correction already have tests and review requests. Reuse; deployment is pending. Avatar UI does not prove Storage-policy correctness. |
| **fork #4** `d306355`, draft | Incremental UT-22 remembered-account choice on #74 `c910829`: 16 focused/436 source/17 harness tests, type/build and 15 browser journeys pass, including current-head fork CI. Tarek confirmed the final delta at `d306355` on September 20, including 16/16 focused tests; the original navigation-gate mutation fails eight tests. Confirmation is the separate fork #5 below; household/consent and production remain open. |
| **fork #5** `4899864`, draft | Isolated email confirmation on fork #4, including the traced AuthContext return-to-sign-in hang. 20 focused/456 source/17 harness tests, type/build and 21 built-app journeys pass; six confirmation cases rerun after final wording/error classification. [PR and evidence](https://github.com/imadd23x/trak-football-hub/pull/5). Exact-head fork CI passes. Tarek review and hosted provider/template rehearsal pending; reset-password recovery is separate. |
| **fork #6** `5c4fb07`, draft | Password recovery on fork #5 now identifies and binds the verified account, recovers failed/expired/timed-out operations, and keeps AuthContext current after a reset-route account switch. 24 focused/480 source/17 harness and all 28 browser journeys pass, plus type/build and bundle checks. [PR](https://github.com/imadd23x/trak-football-hub/pull/6), [evidence](https://github.com/imadd23x/trak-football-hub/blob/5c4fb07a788340e9aea776f961b880cb993c5f3a/docs/reviews/password-recovery-2026-09-20.md). Exact-head fork CI passes; Tarek review is pending and there is no deployment. Reset-email request controls and child credential recovery remain separate. |
| **fork #7** `c0999f9`, draft | Reset-email request controls on fork #6, reusing #48 through explicit merge `f9f1d5d`. Bounded verification/request waits, actual Auth GET abortion, scoped feedback, duplicate prevention and truthful delivery wording. 54 focused/513 source/17 harness and 34 browser journeys pass, plus type/build/bundle checks; 0 lint errors/131 inherited warnings. [PR](https://github.com/imadd23x/trak-football-hub/pull/7), [evidence](https://github.com/imadd23x/trak-football-hub/blob/c0999f9b8e34a4a9225174f6280c718340211925/docs/reviews/reset-email-controls-2026-09-20.md). Exact-head CI passes; independent review, real delivery, child credentials and production remain open. |
| **fork #8** `84ea139`, draft | Profile-loading recovery on fork #7: actual 20-second deadlines, transport cancellation, explicit retry, preserved usable profiles/drafts and stale-attempt isolation. 39 focused/523 source/17 harness and 38 browser journeys pass; type/build/bundle pass, lint 0 errors/131 inherited warnings. [PR](https://github.com/imadd23x/trak-football-hub/pull/8), [evidence](https://github.com/imadd23x/trak-football-hub/blob/84ea1399d63fdf68dc3d255b2e83a17f043beea1/docs/reviews/profile-hydration-recovery-2026-09-20.md). Exact-head CI passes; independent review is pending. Earlier SDK session restoration/sign-in/sign-out and production remain separate. |
| **fork #9** `74a4a35`, draft | SDK startup/Auth network recovery on fork #8: request/body deadlines, startup page retry, cancellation across families and newer sessions of the same user, retained refresh ownership through background backoff, and stale INITIAL_SESSION rejection. 19 focused/542 source/17 harness and 44 browser journeys pass; type/build/bundle pass, lint 0 errors/131 inherited warnings. [PR](https://github.com/imadd23x/trak-football-hub/pull/9), [evidence](https://github.com/imadd23x/trak-football-hub/blob/74a4a35e6d2633eff35cc6bbf71cf6e6b5a7e482/docs/reviews/auth-network-recovery-2026-09-20.md). Exact-head CI and merge-base checks pass; independent review is pending. No production or capacity claim. |
| **fork #10** `ca36554`, draft | Parent interface integration on fork #9: reuses existing history/details/consent/avatar/password work through selected commits and excludes old coach-code ancestry. 662 source/17 harness/8 upgrade controls/14 staff controls pass; six SQL suites pass in fresh and upgrade orders including native PG17.11, plus 13 staff races. All 52 active browser journeys have passed locally; nine affected invitation/staff journeys rerun after retiring two obsolete public staff-signup expectations. [PR](https://github.com/imadd23x/trak-football-hub/pull/10), [evidence](https://github.com/imadd23x/trak-football-hub/blob/ca36554f976ec70321769d1b8f9a3d210ee8ef1b/docs/reviews/parent-pilot-interface-2026-09-20.md). Exact-head CI and merge-base pass, including all 52 current browser journeys. Peer review and release gates remain. |
| #73 `f88db54`, draft | Transitional truthful signup responses. Public signup is being replaced; carry applicable error/recovery behavior into admission, not the obsolete registration model. |
| #44 `8e72e80` | Still OPEN. Both previously raised holds independently verified corrected; see the scoped evidence below. This is not production approval or proof that the whole platform is ready. |
| #51 `5beba3b` | Tarek's exact goal-count/rating-key work overlaps `CoachAddSession` in #44. Reuse `match-input-keys` and its tests. It already stores exact numbers independently of rating buckets. The remaining range change is its ceiling/options to the user-specified 0–10, plus boundary/consumer validation; #76's proposed 0–20 does not override that requirement; do not redesign storage. Kostas owns the final form; Tarek hands off and reviews the mapping. |
| #76 `146bf16`, open | Rating hold independently cleared: shared #51 mappings now reach the rendered form; 53 focused tests pass and both goal/assist mapping mutations fail. **Remaining:** 20-goal/assist ceilings conflict with the agreed 10; the unchanged SQL/fixtures still need the recorded #44/#74 composition corrections and final integration proof. [Review and reproducers](../reviews/pr76-current-head-2026-09-20.md). No full release approval. |
| #42 `918d8c3`; #66 `404e729` | Tarek owns calendar contracts and the SQL suite registry; #38 dependency is satisfied. #66 carries an older snapshot of #42 work, not its current head (verified ancestry); it supplies scorecard tests. The latest `404e729` positive-fixture correction passes independently on native PostgreSQL across four histories; D0b still misses removal of the publication filter. [Review/reproducer](../reviews/pr66-current-head-2026-09-20.md). Integrate #42 first, then reconcile #66 against that exact base. Do not overwrite current runner/birthday coverage with an older file. Verify each final delta after main changes. |
| #40 `e732740`; #47 `2681685`; #53 `4061175` | Tarek owns AI approval, deletion tests and consent-coverage tests. #40's title/body understates its current files: it already includes an Edge Function and coach review page. Reconcile household/consent and private-note contracts; do not implement a duplicate review workflow. Current #40 Supabase preview still fails on missing remote migration history; the timestamp rename did not repair that ledger mismatch (see evidence below). |
| #17 `8b16f4a`; #45 `f54b56f` | Legacy coach-code linking/history work. Tarek identifies reusable identity/history safeguards; do not ship new code-based admission as the target architecture. Prior Settings integration is evidence to preserve behavior, not a reason to retain obsolete copy. |
| #34 `7e8e9b5`, #36 `5bc730c`, #37 `93ae9ea` | One forward academy-history repair plus corrected registry declarations now appears in all three branches. Current upstream CI passes at all three exact heads. Tarek explicitly accepted the registry declarations at those heads; this does not approve the triggers or the final runner composition. All migration/SQL-body bytes are preserved. Keep the existing upgrade modes/hooks when combining #42. Trigger review and production approval remain. |
| #46 `3c2a6e3`, #65 `8cb066c` | Imad owns release governance. #68 already supplied filename validation; retain #65's useful documentation/ignore rules without duplicating the validator. Reconcile old Friday/pilot wording with the current gate. |
| #43/#60/#63/#64/#67 | Review documentation against actual delivery; do not let old claims or workshop suggestions override the agreed architecture. Slide 5 remains Chris's. |

**#44 review holds corrected at `8e72e80`, independently checked:**

- The three files from fork correction `1b6b3e2` are byte-identical in #44. All eight rendered/real-SDK assessment regressions pass on its current head; no competing implementation was introduced.
- `20260919170000` matches its original blob `fe72f5349f6decf5ebb9c7ac9bddb6ca37f5c584`. Forward repair `20260920104500` restores the policy and correct comment. Six SQL suites pass on each of fresh 74 migrations, released-main 66 plus eight pending migrations in deployed order, and a preview already past the old DROP. All three converge on PostgreSQL 17 to policy present, DELETE absent, SELECT/INSERT/UPDATE intact and comment hash `fe45a829f8ff304046166e807f796062`. No live database was written or reset by this verification.
- Imad accepts the narrow new `package.json` convergence script and CI test-step additions as the reviewed integration hunks; no revert/reimplementation is needed. This does not hand general ownership of those files away.
- #66's positive-fixture correction at `404e729` now passes with #44. A new mutation proves D0b misses removal of the publication filter; Tarek owns that test correction and populated assessment/rating controls. Do not weaken the published-only query.
- Evidence: [current-head review](../reviews/pr44-current-head-2026-09-20.md). The two scoped holds are cleared; production approval and integration of remaining dependencies are separate.

## 3. Delivery packages and accountable owners

These are assignments for the three people and their agents. Dependencies below permit parallel work after plan review; they do not authorize simultaneous edits to shared files.

### I-A — Imad: admission, household identity and consent (first priority)

UT-01/03/18/19/20/21/22/39/41; consent part of UT-02/05/08/14/35.

- Complete existing #74 staff delivery/activation/management and regressions. Preserve existing-account passwords, truthful delivery states, recipient binding, expiry, revocation, idempotency and shared-phone identity boundaries.
- Reconcile the proposed [household/admission/assignment contract](household-admission-assignment-contract-2026-09-20.md) with K-A/T-V before K-A writes consumers. The existing consent draft requires Auth/roster records before consent and needs adaptation to registered child IDs. Implement academy-approved waived enrolment, household activation, hard consent gate, child username/password creation/reset and explicit account choice. No public role or metadata provisioning bypasses.
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
- Coordinate a focused academy-data departure follow-up with K-A and I-A: persistent academy provenance for sessions/events, current-membership read/write/export checks, academy history retained after departure/transfer/account deletion. The old “coach keeps their diary/work product” assumptions are superseded. Kostas remains the writer for #44 export/deletion bodies; first report any unpublished overlapping fix and reserve the narrow forward migration/RPC scope. Do not expand #44 wholesale or replace shared triggers without the existing handoff.

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
- Independently verify the new academy-data departure contract. The [native reproduction](../reviews/coach_departure_ownership_repro.py) currently fails 16 required checks despite all ten existing suites passing. Carry these into the owned registry and expand to writes, retained-history/account-deletion, concurrent revocation, AI/Storage and cache boundaries. Preserve positive academy/personal-account controls; an empty export or hidden button is not a fix.

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
| `scripts/test-db.mjs`, suite-discovery logic | Tarek. Keep #42 registry, `migrationReplayOrder` and assertion output. #34/#36/#37 pragmas are committed and accepted; #70/#72/#74/#44 also carry their new suite pragmas. Preserve the current upgrade modes/hooks during composition. |
| `trak_admission`, household/enrolment/child identity, `trak_consent`, consent/provenance guards | Imad. Kostas owns assignment consumers and assignment RPCs after the agreed contract. No second admission/consent gate. |
| `CoachAddSession.tsx`, coach assessment/squad/history | Kostas. Tarek hands over #51 form delta; Imad's existing `1b6b3e2` is a repair to reuse, not a competing feature branch. |
| `CoachSchedule.tsx`, event-time helpers | Tarek until #42 caller contract/diff is accepted; explicit writer handoff to Kostas for schedule UI; helpers remain Tarek-owned. |
| `PlayerHome.tsx` | Tarek integrates #44's published-feedback reader and #42 calendar delta while preserving removal of the private-note query. Kostas supplies the exact hunk, not a second rewrite. |
| `Settings.tsx`, shared password/avatar components, own-profile avatar mounting points | Imad until fork #2/#71 integration; coordinate all profile changes before editing. Storage policy work is Tarek's separate task. |
| `pin_org_id_on_update`, `set_squad_player_org_id` | Kostas's reviewed #44 intent plus Imad's coordinated #34/#36/#37 resolution; preserve both attribution and deleted-academy history protections. Neither merge order alone solves replacement collisions. |
| `delete_my_account`, `export_my_account` | Kostas owns current #44 repair/export bodies; Imad owns household/consent maintenance boundaries. Agree the final function contract and one writer before either replaces it; Tarek verifies. |
| Academy-data departure follow-up; session/event academy provenance | Kostas proposes the bounded backend/export follow-up under K-A/K-C; check unpublished work first. Imad retains shared admission/consent/trigger integration. Tarek owns independent regression/registry integration and the existing #42 schedule writer until explicit handoff. No concurrent rewrites or production permission. |
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
| Imad | Reconciled Tarek's review; independently verified #44's two fixes | I-R coordination/reviews active; existing #74 follow-up is committed at `c910829`, both CI runs green, awaiting exact-head independent review. New household/assignment contracts wait for affected-owner reconciliation. |
| Kostas | Both #44 fixes verified; broad PLAN REVIEW reply still awaited | K-A/K-C proposed, not globally accepted. Existing #44 correction retained; match-validation follow-up #76 is now published at `252b486`; review identifies #51 mapping reuse and fixture corrections. Its proposed 20-goal/assist cap must follow Imad's stated 0–10; its contribution heuristic needs coordinated contract review; K-A/household handoff remains open. |
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

### Integration evidence after staff email/UI publication

- #74 CI: fork [35517604949](https://github.com/imadd23x/trak-football-hub/actions/runs/35517604949), upstream [35517607156](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/actions/runs/35517607156), both success at `c910829`. Deployment jobs skipped. No live provider or production claim.
- #76 native review: 67 standalone migrations/four suites pass. Combining #44 `8e72e80`, #74 `c910829` and #76 `252b486` gives 77 migrations; original export and privacy fixtures fail. Fixture-only corrections pass all ten suites, including #42 academy isolation, without changing any application guard. Kostas owns committing these corrections to his tests after review; local transformed fixtures are evidence, not a merged fix.
- #76 rating gate: for the same synthetic attacker match, one goal scores 7.25 while two/three goals fall to 6.90 because `2+` is unrecognized. Existing engine keys `2` and `3+` produce 7.45 and 7.65. Reuse #51's position-aware helper; do not change rating weights.


### Household contract handoff v1 and refreshed integration facts

- [Household/enrolment/consent/assignment contract](household-admission-assignment-contract-2026-09-20.md) is published for **review**, not yet owner-accepted or implemented. It reserves a stable child UUID before Auth, adapts the existing consent authority to approved enrolment, defines K-A's assignment boundary, and separates household signer attestation from independently authenticated identity. Kostas reviews K-A DTOs/assignment semantics and supplies exact reservations; Tarek reviews consent/identity/concurrency and the regression matrix. I-A retains shared auth/schema ownership. The multi-academy global-login suspension decision remains with Imad; affected code must wait for his answer.
- Corrected requirement: original use-case file says manual minutes **0–120**, goals/assists **0–10**. #76's 0–20 ceiling is not accepted by this plan. Reuse #51's canonical rating keys and keep exact counts; do not change weights.
- Read-only #40 evidence at `e732740`: Supabase preview check `106096462383` reports `Remote migration versions not found in local migrations directory.` Its preview ledger contains `20260918120000 | coach_approved_feedback`, and ends at `20260918133800 | ai_quota_known_functions`; it contains no September 19+ version. The previous `1457b65` check `105951144975` already had the same error. Compare the originally applied migration with repository history and prepare a reviewed forward reconciliation; do not reset or relabel an applied ledger merely to make the check green. The CI workflow already uses `db push --include-all`, so renaming an older pending version is not evidence this history error is fixed. No preview database was modified during diagnosis.
- #66 `404e729` independently passes 22/22 assertions across standalone 65, combined #44 fresh/upgrade 74 and #44/#74/#76 77 migrations. Removing only the publication filter wrongly leaves 22/22 passing and includes the unpublished decoy. Removing academy scoping correctly triggers seven failures. D2/D3 have no populated assessment/rating controls. Tarek has the scoped correction request; [evidence and reproducer](../reviews/pr66-current-head-2026-09-20.md).
- Main rechecked at `4335e8984777b7b704e8706d3fe277352658c9ed` before this handoff; #44/#74/#76 heads remain unchanged. No new Slack reply was present in the plan thread at that check.

- Plan commit `9c5807e` CI passed on upstream [35519044500](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/actions/runs/35519044500) and fork [35519042029](https://github.com/imadd23x/trak-football-hub/actions/runs/35519042029). Production jobs were skipped. Any later documentation commit requires its own CI status.


### Academy-history convergence and dependent branches

- #34 `5af5ac2` fixes the proven order-dependent replacement of shared triggers by #34/#44: preserve closed academy history and genuine first attribution in either order. It adds `20260920152925_preserve_closed_academy_history.sql`; all previously published migration bytes are unchanged. Ambiguous historic closure/live-academy combinations refuse before partial changes. Native PostgreSQL 17.11 and PGlite verify fresh/upgrade histories, three deliberate guard mutations, ten SQL suite files, 284 view/78 deletion assertions and concurrent linking. [Evidence](https://github.com/imadd23x/trak-football-hub/blob/5af5ac2c7d5e4e2643a2e78274833bcbffad2ef5/docs/reviews/academy-history-convergence-2026-09-20.md). Fork [35520484683](https://github.com/imadd23x/trak-football-hub/actions/runs/35520484683) and upstream [35520486197](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/actions/runs/35520486197) pass; production jobs skipped.
- #37 `b0cb7ab` includes the same repair with the unchanged assessment index. Native 77-migration upgrade plus five overlapping clients preserve complete results. Latest-five local sample improves 72.635 → 2.481 ms; full history remains roughly 72–75 ms. [Evidence](https://github.com/imadd23x/trak-football-hub/blob/b0cb7ab72f4843915e4701a99eaf35e4e63fa61b/docs/reviews/query-history-refresh-2026-09-20.md). Local SQL performance is not CAP-01 hosted capacity proof.
- #36 `ab6c0c2` includes the same repair and no additional migration. All 38 synthetic demo tests pass on both replay orders. The legacy implicit-target scripts remain retired; standalone demo tests now validate migration filenames/versions. [Evidence](https://github.com/imadd23x/trak-football-hub/blob/ab6c0c24aaf038f2f00ee60efb168a041affc5ba/docs/reviews/demo-history-refresh-2026-09-20.md). These fixtures still need adaptation to the new staff/household admission interfaces before those gates can be exercised; no hosted seed occurred.
- #36/#37 each pass 485 source tests with nine diagnostics skipped, typecheck/build/bundle checks and lint with zero errors/137 inherited warnings. Current-head CI and independent review were pending at publication; consult the exact PR checks rather than treating this record as a live status feed.
- [Exact-head handoff in the accepted plan thread](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789920012876709): Kostas reviews trigger/history semantics and demo fit; Tarek reviews SQL/mutations/query evidence and narrow #42 shared-runner integration hunks. No whole-file replacement of his branch and no duplicate trigger work. The coach-only decision is reconfirmed; Tarek retains the separate obsolete use-case retirement reservation. Backend player-write denial still needs implementation/verification rather than merely removing UI tests.


### UT-22 returning-account review handoff

The landing page previously skipped account choice for a restored session. [Fork PR4](https://github.com/imadd23x/trak-football-hub/pull/4), `03b9dd82912e891f1f5acc0bbab1c2200279a042`, now requires Continue or Sign in with another account; deliberate password sign-in still continues the matching hydrated profile. Failed sign-out/sign-in is recoverable, another account's response does not auto-open it, and missing roles are not guessed to be parent invitations. The password-reset success message and return journey are included. This is a small review delta against #74's fork branch, not another admission implementation.

Tarek is asked to review the account/session races and test evidence. It changes only `LandingPage.tsx`, one `ResetPassword.tsx` success message, focused tests, an isolated browser spec and its additive Playwright registration. [Evidence](https://github.com/imadd23x/trak-football-hub/blob/03b9dd82912e891f1f5acc0bbab1c2200279a042/docs/reviews/account-choice-2026-09-20.md). UT-22 remains partial: AuthConfirm/provider/template behavior and household/consent still need their own review and tests. It is not a new authorization barrier or a session-persistence redesign. No live account/DB/production change occurred.


### Peer review corrections after the account-choice handoff

- Tarek independently ran the 16 account-choice tests at `b763063` and accepted that logic; deleting the navigation gate caused eight failures. He explicitly did not execute browser tests. His finding that `refreshProfile` resolves after handling errors in AuthContext was correct; the dead component catch is removed at `d306355`. [Current fork CI](https://github.com/imadd23x/trak-football-hub/actions/runs/35522821940) passes, including all 15 browser journeys. This is not a release approval.
- The suggested five registry pragmas were independently composed with #42 `918d8c3`: nine files passed but both committed account-deletion files were omitted. Corrected declarations register them as ordered suites (1000/1001) and group access/departure consistently. Composed `--all` now runs eleven files; the coach mode retains all four original files. #34/#36/#37 inherit the same corrected declarations without changing SQL bodies or migrations. [Evidence](https://github.com/imadd23x/trak-football-hub/blob/7e8e9b5de1968b27e4e7d6ecb5bdddba7c2d326e/docs/reviews/academy-suite-registry-2026-09-20.md).
- #42's raw runner still rejects academy-upgrade mode and lacks the orphan backfill boundary hooks. Its final merge hunk must retain the existing replay helper, academy baseline/upgrade modes, PR37's assessment mode and the 78-check output while using registry discovery. Headers are ready; that final runner integration is not claimed complete. Tarek's conditional runner acceptance does not cover Kostas's outstanding history-trigger review.


### September 20 confirmation delivery and peer-review refresh

- Fork #5 `4899864187ab8b909165f7fb047e93e07adef944` supplies isolated confirmation with local cleanup retry and the necessary AuthContext confirmation-route hydration correction. The first browser run exposed three indefinite-loading failures; the corrected all-role browser set passes 21 journeys. This is implemented/local-tested, not independently reviewed, merged or deployed. Exact-head fork CI [35524897167](https://github.com/imadd23x/trak-football-hub/actions/runs/35524897167) and merge-base check [35524921019](https://github.com/imadd23x/trak-football-hub/actions/runs/35524921019) both pass; production jobs are skipped.
- [Tarek's final reply](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789923265784649) accepts fork #4 `d306355` and the exact #34/#36/#37 registry declarations. He did not supply a runner merge hunk restoring academy/assessment replay semantics; that requirement remains. #66's publication-filter mutation gap and #40's preview ledger are also still open regardless of GitHub mergeability.
- Latest upstream CI succeeds for [#34, 35523119592](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/actions/runs/35523119592), [#36, 35523148922](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/actions/runs/35523148922), and [#37, 35523150619](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/actions/runs/35523150619); production jobs are skipped. The academy-data departure/export requirements added later remain a separate unresolved follow-up.
- #76 rating correction `146bf16` reuses the exact shared mapping and now has rendered real-SDK goal/assist regressions. Imad independently verified 53 positive tests and both corresponding negative mutations. Only the rating hold is cleared; no SQL/fixture/range changes appeared in this delta. See the updated review.
- The current use-case command still exits zero while the optional obsolete UC-A02 file has three failures; its final “OK” is for the enforced scope only. Tarek's existing coach-only retirement reservation must reconcile this, preserve the original decision/history and keep player/parent read journeys. No one may relabel those three failures as passes.


### September 20 password-recovery delivery

- Fork #6 `5c4fb07a788340e9aea776f961b880cb993c5f3a` is stacked on fork #5 `4899864`. A browser reproduction found that switching accounts during reset left AuthContext on the previous family, including an A-child-link query with B's token after saving for B. Both pending-GET and pending-PUT reproductions now pass through B's account choice; the narrow provider correction preserves ordinary session hydration/cache invalidation without redirecting an already-open reset route.
- Local evidence: 24 focused SDK/intercepted-HTTP cases, 480 source tests, 17 harness tests, 28 built-app browser journeys, typecheck/build and production-bundle check pass. New files are lint-clean; 134 inherited warnings remain. The first 17 focused cases failed before the route rewrite, and both extended account-switch journeys failed before the provider correction. The optional UC-A02 failures are still reported unchanged.
- [Exact-head review request](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789925892119989) asks Tarek to review the fork delta without blindly integrating its dependency stack. [CI](https://github.com/imadd23x/trak-football-hub/actions/runs/35526465582) and [merge-base](https://github.com/imadd23x/trak-football-hub/actions/runs/35526467402) both pass at this exact head, including the native database checks and all browser journeys. Supabase, Vercel-credential and deployment jobs are skipped. No independent acceptance, hosted Auth/template/email verification, real password change or deployment is claimed.
- The next reset-email-control change must reuse #48's verified-account/pending-operation handling in Settings. That branch already prevents duplicate requests and ignores stale results; remaining bounded waits and truthful delivery wording should be incremental. Landing's forgotten-password action still needs its own rejection/timeout/duplicate handling. Future parent-managed child credentials remain part of the agreed household contract, not this email-based reset route.


### September 20 reset-email delivery and H0 follow-up

- Fork #7 `c0999f9b8e34a4a9225174f6280c718340211925` composes existing #48 `43db21e` into fork #6 `5c4fb07` via merge `f9f1d5d`, then adds the request controls as a separate commit. This preserves provenance and makes both the reused Settings/Auth boundary and new request changes independently inspectable; #48 remains open upstream. The combined tests do not authorise merging the stack.
- Twelve initial acceptance failures exposed malformed/repeated requests, late feedback, misleading request outcomes and an indefinite verification wait. The existing Settings switch guard already passed. An additional failing assertion showed that releasing the UI alone left the Auth GET running; the reset action now reuses fork #6's abortable check plus #48's current-account recheck. Final local evidence is 513 source/17 harness/34 built-app journeys, type/build and bundle checks passing. New browser cases cover both request entry points, normal sign-in, retry and cross-tab changes on 320/390px phones. No real email or deployment occurred.
- [Exact-head review and H0 reminder](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789927402851029) are in the existing team thread. [CI](https://github.com/imadd23x/trak-football-hub/actions/runs/35527728178) and [merge-base](https://github.com/imadd23x/trak-football-hub/actions/runs/35527730884) both pass at `c0999f9`, including native DB and all browser journeys. Supabase/Vercel/deploy jobs are skipped. Independent acceptance is pending.
- H1/H2 household schema work remains gated by H0's affected-owner boundary review. Both owners were asked to prioritise stable child IDs, state transitions, assignment DTOs and signer attribution. This does not block independent parent/auth repairs, nor does it permit silent replacement of the agreed fully waived household architecture. No new response from either owner was found during this implementation pass; silence is not acceptance.

- The previously reproduced profile-loading gap on `c0999f9` is now addressed in the fork #8 delivery below. The probe held `/auth/v1/user` for 21 seconds with no retry controls; it concerned profile hydration after the SDK supplied a session, not the earlier SDK session-restore phase.

### September 20 profile-loading recovery and review corrections

- Fork #8 `84ea1399d63fdf68dc3d255b2e83a17f043beea1` is stacked on fork #7 `c0999f9`. Seven new real-provider regressions failed before implementation. Nine hydration regressions now cover Auth/profile stalls, protected routes, preservation of usable profiles/drafts, deduplicated provisioning, account changes, unmount, non-cooperative late transport and a lost provisioning acknowledgement. The last case models existing server idempotency; it does not prove SQL behavior.
- Final local evidence: 39 focused, 523 source, 17 harness and 38 built-app browser journeys pass, including real 20-second timeouts and request cancellation. Typecheck, build and actual-bundle checks pass; lint has 0 errors/131 inherited warnings. Inspected 320/390px recovery screenshots. The optional UC-A02 retirement remains Tarek's separate task; its three failures are not reported as passes.
- [Exact-head review request](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789929167730419) is in the existing thread. Exact-head [CI](https://github.com/imadd23x/trak-football-hub/actions/runs/35529374094) and [merge-base check](https://github.com/imadd23x/trak-football-hub/actions/runs/35529376594) pass, including the native database and browser checks. Supabase/Vercel/deployment jobs are skipped; no independent review, merge or deployment is claimed. Earlier SDK session restoration, sign-in/sign-out and the academy-data departure/export follow-up are not fixed by this slice.
- [Tarek's CAP-01 update](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789928018913799) correctly moves measurement to user-visible operations. One source correction was sent: `fetchParentDevelopment` issues up to five requests across three dependent stages after child ID is available (two parallel pairs, then coach names), not five serial RTTs. A cold screen may also include family discovery. Instrument the full critical path and record device/network/load separately; source counts or single-user RTT arithmetic do not establish capacity.
- [Tarek withdrew the prior #40 ordering diagnosis](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789928167067499). The already-read check at `e732740` reports missing remote migration versions, with the preview ledger ending at `20260918133800` and retaining `20260918120000 | coach_approved_feedback`. That is evidence for the current ledger reconciliation, not a retrospective explanation of every preview failure. Keep original applied migration content and prepare an explicitly reviewed forward repair; no preview reset or hosted write was performed.

- The separate expired-session SDK restoration reproduction on fork #8 is now addressed by fork #9 below. Holding `/auth/v1/token` for 21 seconds originally left zero controls and zero profile reads. That diagnostic proved the failure was before profile hydration; it was not a passing recovery test.

### September 20 SDK network recovery and parent integration handoff

- Fork #9 now targets `74a4a35e6d2633eff35cc6bbf71cf6e6b5a7e482`, replacing initial head `767530a`. Six initial SDK regressions failed, then retry-gap, delayed-background, stale INITIAL_SESSION and same-user replacement-session tests exposed additional defects. The current guard includes user and saved credential, preserves successful ordinary token rotation, and retains failed refresh ownership through delayed backoff. Complete successful responses release the in-memory attempt entry. It never logs or persists that tracking state.
- Current local evidence: 19 focused SDK/provider tests, 542 source tests, 17 harness tests and all 44 built-app browser journeys pass. Six new browser journeys include real 20-second deadlines, recovery at root/protected routes and actual second-tab sign-in/sign-out races. Typecheck/build/actual-bundle checks pass; lint 0 errors/131 inherited warnings. The optional UC-A02 failures remain visible. No capacity, hosted Auth, merge or deployment claim follows from these checks.
- [Replacement exact-head review request and next reservation](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789931992840919) are in the existing thread. [Current-head CI](https://github.com/imadd23x/trak-football-hub/actions/runs/35531890294) and [merge-base](https://github.com/imadd23x/trak-football-hub/actions/runs/35531892238) both pass. CI includes database regressions, native staff concurrency and all 44 browser journeys; hosted Supabase/Vercel/deploy jobs were skipped. The prior `767530a` CI passed but does not verify the final credential-identity change. The 20-second bound covers individual HTTP requests/body and recovery controls; the SDK retains its retry cycle. Cancellation can reject an older Auth request after a credential rotation, requiring an explicit retry while preserving the newer session.
- Main was rechecked at `4335e89`. Fork #1 `a15219b5fc71079e87f2c2a565f4102791133ac4`, fork #2 `f74a8a73d0843b451c300ce2e09003163269d3b7`, #49 `01304a4f26d6c79c7b9be9511463a17ef9382f0e` and #71 `7216ae00ca7ad8cb6a966f179c08e6727803f7d0` remain open. They are not ancestors of this staff/Auth candidate; source inspection also confirms the parent detail/avatar changes still need composition. The shared PasswordInput itself is already byte-identical, so do not duplicate it.
- Next I-P/I-R composition reuses parent detail commit `fdf51aaee29918639953c195a1aab026681c69d9`, existing complete-history/retained-coach behavior, and existing avatar/password patches. The older fork #1/#2 ancestry also contains T6 coach-code enrollment and UC-A08 claim work; a wholesale branch merge would reintroduce an obsolete architecture. Inspect dependencies and carry forward the approved parent behavior without reinstating those paths. The history summary/page functions are SECURITY INVOKER and retain underlying matches RLS; preserve that boundary and their upgrade/row-cap tests. Settings #48 and current Auth recovery already exist in the new candidate. Household/consent/assignment contracts and other owners' reservations remain gated as before.


### September 20 parent interface composition

- Use fork #10 `ca36554f976ec70321769d1b8f9a3d210ee8ef1b` as the combined parent interface review on fork #9. Selected original commits carry `cherry-pick -x` provenance. Do not blindly merge fork #1/#2 ancestry: it contains the superseded T6 coach-code enrollment path. Existing #48 account boundaries and shared PasswordInput were reused. AuthContext/App routes/Auth fetch/account helpers and all 68 dependency migration files remain byte-identical to #9; history SQL remains byte-identical to `484ad20`.
- Local checks pass as stated in the inventory. History verification pins the 68-migration dependency candidate, preserves report-before-parent order, checks RPCs absent before the final history migration, and requires all six SQL completion reports. Initial fixture-import failures and obsolete public coach/club signup expectations were diagnosed and corrected; no active invitation gate or assertion was weakened. Existing staff-native verification now includes the history suite. The separate native upgrade run also passes all six suites. Older HTTP row-cap evidence was not rerun; the current native role/pagination checks were.
- [Exact-head review and #42 runner handoff](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789933564632369) request Tarek to compose the existing history verifier, current migration filename validation and all suite hooks into his shared registry. This is an integration of already reserved parent work, not another owner for his runner.
- [Exact-head CI](https://github.com/imadd23x/trak-football-hub/actions/runs/35533306249) and [merge-base](https://github.com/imadd23x/trak-football-hub/actions/runs/35533337665) pass, including all 52 current browser journeys. Supabase/Vercel/deployment jobs are skipped. Parent/household authority, coach-only write denial, departure/export ownership, actual Storage policy checks, provider delivery, CAP-01 and independent review remain separate gates. No deployment or new academy ownership permissions are claimed.

- A separate read-only built-browser probe on #10 held the private avatar GET for 21 seconds and reproduced an indefinite loading state with no retry. This was not covered by its successful response/denial tests. [Imad reserved the focused follow-up](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789933792599599) in `parent/private-photo-recovery`; #10 remains unchanged for integration review. The gap remains open until that follow-up is tested. It does not alter Storage policy ownership or close the separate upload/other Settings timeout work.
