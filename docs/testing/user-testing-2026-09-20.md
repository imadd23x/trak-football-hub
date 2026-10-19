# September 20 user testing: fixes and acceptance criteria

Source: Imad's `trak_use_cases_and_testing.md`, read September 20, 2026. This tracks every observation, including suggestions that need design work. Reports are not proof of root cause. Related open PRs are not deployed fixes. Canonical main at intake: `dc5c9d5`; this parent work starts from fork integration `92e537b`.

## Decisions and priority

Imad confirmed on September 20: **academy invitations for the free pilot; payment-only signup, shared household credentials and parent-created child usernames are a separate design**. No payment integration or auth identity rewrite in this fix batch. Individual verified guardians and the already agreed academy-specific consent decisions remain in force. Removing a signup screen alone is not an access-control implementation; admission must be checked by the backend.

Under-18 approval in Greece and UAE is a Trak pilot policy pending legal review. No waiver, invitation or payment flow by itself establishes legal compliance. When multiple eligible guardians exist, coaching may continue while one approves; optional progress visibility is shared across linked parents if any eligible guardian approves that purpose. Private coach notes stay private unless explicitly shared.

1. Admission, consent, academy/coach isolation and account correctness block real-child use.
2. Repair lost/incorrect records, failed saves, unusable views and misleading loading/errors.
3. Complete parent details, confirmed schedules and truthful totals.
4. Validate exports, simplify duplicate navigation and rehearse all roles on phones.

Suggested owner below follows the current pilot plan, not an assertion that another contributor has accepted new work. Coordinate files in #coding-agent-reviews before implementation.

## Parent slice: scope, acceptance and release

Scope: make Home recent matches, Matches rows, and Alerts match/assessment/recognition entries accessible buttons opening readable details. Home's latest assessment also opens. Fetch match facts with explicit safe columns, selected child ID and match ID. Do not retrieve private notes, self-reflection or AI drafts. Unknown facts stay unknown; zero is a recorded value. Do not invent a causal explanation for a rating.

Acceptance: activate by click and keyboard; show exact selected record; Escape/Close returns focus; details fit a 390px phone and scroll vertically; failed/missing/malformed/wrong-child responses show retry; child/account removal unmounts details; delayed responses cannot reopen another identity's record; rejected refresh removes cached facts. Regression tests must fail before the fix, then pass with the implementation. Built-app browser checks use intercepted synthetic responses, never production writes.

Rollout: commit and CI on the fork, peer review, integrate after dependent parent changes, then request production approval. No schema changes in this slice. Rollback is a reviewed frontend revert of this slice; do not revert access-control or consent dependencies. A local passing test is not live verification. Account deletion/history/coach-link integration from the base remain independently reviewable work.

## Inventory

Status **reported** means not yet reproduced in this branch. **Related** means existing work may cover it, but needs a targeted retest against the final integration. **Implemented locally** does not mean released.

| ID | Observation / requirement | State and suggested owner | Acceptance evidence still required |
|---|---|---|---|
| UT-01 | Owner provisions academy, academy invites coaches with expiring single-use activation; no unaffiliated public coach | Design required; academy/Kostas + auth/Imad | Invite correct email/role/org; expiry, replay, wrong recipient; direct API cannot self-enrol |
| UT-02 | Academy approves roster; coach selects registered/approved players instead of arbitrary names | Reported; academy/Kostas, linking/Tarek, consent/Imad | Stable IDs rather than spelling; deny unauthorized additions and development writes; approved assignment visible to all roles |
| UT-03 | No development records for unconsented children | Known release gap; P2/#70 foundation + #53 related, Imad | Real DB grant/withdrawal at ages 17/18 both markets, unknown DOB, purpose and academy boundaries, concurrent writes; foundation alone is insufficient |
| UT-04 | Bulk-add approved academy players | Pending design; academy/Kostas | Selection only from permitted registry; duplicate-safe retry and per-row failures |
| UT-05 | Alex Martinez cannot see George while Sarah sees George's 11 matches/assessment | Confirmed live name mismatch, read-only; joint identity investigation | Same player ID has 11 matches and Sarah link; Alex's active roster names him Jamie Wilson and has four assessments. Fixed synthetic row matches seed source. Determine name/seed history and reconcile explicitly; no live correction performed |
| UT-06 | Goalkeeper coach option | Reported enhancement; coach/Kostas | Supported specialty persists and displays without changing permissions |
| UT-07 | Coaching manual revision | Content review pending; coach/Kostas | Instructions match routed, released behavior and supported fields |
| UT-08 | Shared player notes separate from assessment; private coach notes tab | Related K9/#44; coach/Kostas + parent/Imad | Separate private/shared data; explicit publication; parents/players cannot query private notes or AI drafts |
| UT-09 | Player season bands overview removal | Requested UI change; player/Tarek | Remove redundant section without losing useful totals/navigation |
| UT-10 | Goals/assists/matches plus GK/DEF clean sheets for player and parent | Reported; joint stats | Totals across complete permitted history; missing vs zero; own-team conceded zero, not home-team scored zero; define participation/position eligibility before implementation |
| UT-11 | Sessions quick/full choices duplicate same form; session count should open history | Reported; coach/Kostas | Sessions goes to type selection; dashboard count opens history; labels match destination |
| UT-12 | Minutes integer 0–120, goals/assists integer 0–10 | Related K3/K4/#44; coach/Kostas | Routed form and server reject out-of-range/fractional input; store exact goals, not a 2+ bucket |
| UT-13 | Four positions GK/DEF/MID/ATT | Requested; joint model/UI | Normalize existing aliases; identical options and persisted meaning across routes |
| UT-14 | Coach calendar reaches parent/player; parent Home next confirmed session with location | Not confirmed; S7/#42 related, parent/Imad | Correct academy/participant audience, confirmed-only upcoming event, cancellations, empty/error, Dubai/Athens dates and DST, coach departure |
| UT-15 | Parent Home recent match cards cannot open | Reproduced; implemented locally, Imad | Source regression + built mobile interaction; fork CI green at `79e468b`; peer review/deployment pending |
| UT-16 | Parent Matches records cannot open | Reproduced; implemented locally, Imad | Correct ID after pagination/child switch; exact facts; inaccessible/failed fetch handling |
| UT-17 | Parent assessment/match alerts cannot open exact record | Reproduced; implemented locally, Imad | Open older as well as latest assessment; safe projection; match retry; recognition detail included |
| UT-18 | Two confusing Back controls after invalid DOB/age group | Reported; player/Tarek + auth/Imad | Correct validation; single clear back-to-DOB action; preserve entered form |
| UT-19 | Duplicate email signup falsely claims account/email/guardian invite created, same or different role | Reported; auth/Imad | Trace actual Auth responses and email delivery; accurate neutral result with sign-in/recovery action, no role overwrite or account-enumeration API |
| UT-20 | Password show/hide | Implemented and tested in standalone upstream #71 at `7216ae0`; awaiting peer review and release, Imad | Five new regressions failed before fix; 390 source and eight mobile journeys pass; fork/upstream CI green; no production deployment |
| UT-21 | Slow/expired academy confirmation and resend; login appears possible without confirmation | Reported; auth/Imad | Record send/receive/click timestamps and actual confirmation state; test scanner-consumed, expired/reused and fresh links with approved synthetic inboxes |
| UT-22 | Existing session immediately bypasses login; explicit account choice requested | Related account boundaries/#48, design required; auth/Imad | Returning user can choose account or continue; email callback does not silently join data to wrong account; token refresh does not discard forms |
| UT-23 | Coach squad flashes empty and Home flashes zero while loading | Reported; coach/Kostas | Deferred requests show loading; distinguish genuine empty/error; retained data not mixed across accounts |
| UT-24 | Smart calendar says unauthorized | Related K8/#44; coach/Kostas | Actual deployed function with valid coach token, expired token and unauthorized user; visible recovery; verified parsed result |
| UT-25 | Smart calendar should ask for missing days/times rather than guess | Requested; coach/Kostas | Clarify missing fields before creating events; explicit confirmation; no fabricated schedule |
| UT-26 | Repetitive recent assessments on coach Home | Suggestion; coach/Kostas | Decide/remove redundant list while preserving direct assessment-history access |
| UT-27 | Training vs match assessment and started/sub/training confusion | Reported UX; coach/Kostas | Session type determines relevant participation fields, clear history and preserved saved meaning |
| UT-28 | Coach assessment history lacks details | Reported; coach/Kostas | Open exact historical assessment with permitted private/shared notes and meaningful errors |
| UT-29 | Session type order Match, Training, Other; consistent player selection | Requested; coach/Kostas | Consistent selection, retaining type-specific fields and entered values safely |
| UT-30 | Impossible team/player goals and 21 players × 90 minutes | Related K4/#44; coach/Kostas | Server and UI enforce feasible contributions for defined match duration/team format/substitution rules; do not assume all academy matches are 11-a-side |
| UT-31 | Session history cannot open saved note/details or edit | Reported; coach/Kostas | Open persisted session and notes; authorized edit with validation and honest partial-save/retry; missing vs denied |
| UT-32 | Other sessions display Training/Tactical | Reported; coach/Kostas | Persist and render actual kind/subtype (e.g. gym/video); do not substitute match result or training category |
| UT-33 | Coach/player avatar upload fails | Cause confirmed; private image display/upload reference repair implemented and locally tested, Imad; review/release pending | Four role profile + Settings browser journeys pass; account boundary/type/size/retry tests pass. Storage-policy isolation and deletion remain separate unresolved work |
| UT-34 | Parent invite/linked status clutters player Home; keep Profile | Requested; player/Tarek | Profile still exposes pending/error/action status; Home stays useful |
| UT-35 | Parent linked on player Home/Profile but Settings says none | Related #48/#17 integration; Imad | Same authoritative links in all views; loading/error/unlinked distinguishable; account switch and multiple links |
| UT-36 | Passport export clips/misaligns text | Reported; player/Tarek | Render actual downloaded image at narrow/wide widths, long names, fonts loaded, complete content |
| UT-37 | Evolution-card export proportions/layout | Reported; player/Tarek | Render shared/exported asset and inspect all edges/text; no temporary UI controls in export |
| UT-38 | Show evolution Series 2 lifecycle | Verification request; player/Tarek | Deterministic synthetic progression produces next series; inspect card history without rewriting real records |
| UT-39 | Personalized confirmation-email greeting | Requested; auth/Imad | Escaped name, safe missing-name fallback, correct recipient/action for all roles; template change needs production approval |
| UT-40 | Player recent matches potentially redundant | Suggestion; player/Tarek | Decide simplification; match-history route remains discoverable |
| UT-41 | Payment webhook, one household login, child username/password, payment-lapse suspension | Explicitly deferred September 20 | Separate identity/security/recovery/billing design; reconcile independent guardians, withdrawal and consent evidence; no implementation in free pilot |

## Dependencies and next execution

The parent detail slice is based on tested fork integration `92e537b`, which includes open parent work and #17. It is not a small standalone diff against today's canonical main. Review the incremental change against that base; do not bypass dependency review by merging a large integration blindly.

Next parent tasks: confirmed next-session query/widget and full-history stats after the calendar/consent contracts are settled; duplicate-email and shared-phone reproduction; invite delivery and avatar failures. Consent data enforcement remains higher priority for real-child admission than these UI additions. The earlier temporary uncommitted P2 cutover checkout disappeared; rebuild from committed #70 in a persistent worktree and rerun all affected SQL/role/concurrency tests. Historical draft test results do not verify a reconstruction.

Do not mark any item done until source, tests, review, deployment and live synthetic verification are separately recorded. No promise of zero remaining bugs from a passing subset.

## Parent details verification — September 20

- Reproduction: all 14 new render + real SDK/MSW tests failed on the unchanged UI (no record action existed).
- After implementation: 39 parent-family tests pass; full source suite 509 passes. Typecheck passes. Lint: zero errors, 129 existing warnings; changed source files have no lint findings.
- Built-app Chromium 147 mobile tests: all 8 parent journeys pass, including opening match details from Home/Matches/Alerts and assessment details from Home/Alerts; keyboard activation, Escape/focus restoration, and no horizontal dialog overflow. Screenshots visually inspected after animations finish. Browser HTTP is intercepted synthetic data, not a live authenticated Supabase test.
- Existing DB regression replay: 67 migrations, parent invite/backfill, 282 operational-view assertions, 151 privilege/consent assertions, 81 parent-history assertions pass in disposable PGlite. No SQL migration added by this slice.
- Harness: 17 passes. Use-case gate: two enforced cases pass; three pre-existing UC-A02 player-log tests fail as pending/non-blocking; 14 pending cases have no tests. They are still defects/debt, not a green end-to-end platform claim.
- Initial browser attempt could not launch because Chromium 1217 was absent; installing the repository's required browser resolved this environment issue. The subsequent eight-test runs pass.
- Upstream #38 was separately approved and merged during this work at `4335e89`. Release verification is tracked independently; this parent detail slice is not deployed by #38.

## Latest handoff evidence

Parent details: [fork PR #1](https://github.com/imadd23x/trak-football-hub/pull/1), implementation `fdf51aa`, integrated head `79e468b`; [fork CI passed](https://github.com/imadd23x/trak-football-hub/actions/runs/35501643953). No production deployment. The subsequent change to this inventory is documentation only.

Password visibility: [upstream PR #71](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/pull/71), fork commit `7216ae0`; [fork CI](https://github.com/imadd23x/trak-football-hub/actions/runs/35502164827) and [upstream CI](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/actions/runs/35502223413) passed. This standalone PR is based on main and does not depend on the parent-history integration. No production deployment.

Calendar #38: explicitly authorized by Imad, merged at `4335e89`; [production CI](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/actions/runs/35501564264) passed including Supabase and frontend. Live public DOB route and actual deployed calendar helper checked in Dubai, Athens and Los Angeles with a fixed birthday-boundary clock; zero writes or page errors. [Release evidence](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/pull/38#issuecomment-5748898983). DB still has 66 migrations and legacy threshold 15; this was not the P2 cutover. #42 corrects a UTC DOB **test fixture**, not the separate production `player_age_years` session-timezone issue.

UT-05 source trace: `DevSetupPage.tsx` and `supabase/seeds/dev_data.sql` seed the same fixed roster row as Jamie Wilson. Coach views use `squad_players.player_name`; parent views resolve `profiles.full_name`. The live join establishes the mismatched names but does not establish who or what renamed the profile. Do not repair by fuzzy matching, auto-merging histories, or rerunning a seed against production.

## UT-33 private avatar repair — September 20

Scope and acceptance: Settings and the parent/player/coach/academy own-profile screens must display existing private root-key photos, replace them with an acknowledged upload, retain the result after reload, and expose a retry on failed reads. Account changes must discard in-flight images and release browser URLs. No third-party URL is fetched from a profile field.

Confirmed cause: the live avatar bucket is private, while the existing uploader stores `getPublicUrl` output. All four inspected synthetic profiles have their own root-key objects, but their public URLs cannot serve them. The repair downloads the current account's root key with a captured, verified JWT and displays a temporary browser blob URL. Existing URL values remain usable as version markers; new uploads store an object reference/version rather than a public or signed URL. Bucket visibility and Storage policies are unchanged.

Verification: seven initial regressions failed before the fix. The final Settings/AuthProvider/SDK suite passes 32 cases, including all four roles, denied reads/retry, delayed account changes, upload acknowledgements, blob cleanup, malformed/empty/oversized content and rejected upload types. Full source: 523 passes; harness: 17 passes; typecheck/build pass; lint: zero errors and 129 existing warnings. Four new built-browser journeys decode actual PNG bytes on each role's profile, recover a denied download, upload through Settings, and verify both Settings and profile after reload. All 12 built mobile-browser journeys pass, and the four role screenshots were visually inspected. Backend traffic in these journeys is intercepted synthetic data. The existing three pending UC-A02 failures and 14 pending use cases without tests remain.

Release boundaries: this incremental slice depends on the reviewed parent integration candidate `a15219b` (including its account-bound Settings helpers). Peer review, dependency review and production approval remain required; local results do not establish a live authenticated upload. After release, verify one approved synthetic account per role against the real private bucket. Rollback is the frontend revert; this introduces no database migration. Old UI already cannot display private public URLs, and newly stored object references likewise require the new reader, so reverting does not restore photo display.

Separate unresolved Storage work: the currently broad read policy and the root-object DELETE-policy mismatch need a coordinated policy review; this UI change does not prove cross-account Storage denial or account-deletion cleanup. The deletion mismatch was sent to Tarek for #47. Do not make the bucket public as a workaround.
