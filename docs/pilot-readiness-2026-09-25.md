# Current pilot charter and readiness — September 25, 2026

Updated September 18, 2026. This is the single current charter for delivery scope, ownership and admission gates. It supersedes `pilot-scope.html` and the old all-clear `status-update.md`. Source code and recorded deployment/runtime evidence determine completion; this document is not proof that a task works or permission to admit real children.

Source: [Imad's September 18 Slack plan](https://trakfootball.slack.com/archives/C0BLW846732/p1789675494856059). Correct repository: `kostasanastasioubusiness-lang/trak-football-hub`; initial implementation baseline `1fcb9238`. `t-bones29/trak-football-hub` is an outdated copy. Deployment: `trakfootball.com`, Supabase project `xbykbqolvqyqmipikuae`.

## Confirmed decisions

- September 25 is a phone demonstration with synthetic accounts. Real-child admission is a separate gate below.
- The planned free academy pilots include one in Greece and the remaining participating academies in the UAE, on the same build. The total number, names and starting dates are not confirmed here. The two academies required for the synthetic demonstration test isolation; they are not a confirmed live-pilot count.
- Guardian consent is required below 18 in **both** countries as Trak's pilot policy, pending legal review. Approval covers the named academy only; a child joining another academy needs a new approval. This supersedes the earlier "Greek behaviour unchanged" wording and any cross-academy approval assumption.
- For real minors, permit minimal roster setup only before online guardian approval. Development records wait for approval. Academy-collected/offline consent is not in this release. Historical synthetic assessments can demonstrate roster adoption without an exception for real children.
- Imad coordinates and merges releases. Kostas or Tarek must approve Imad's PRs; Imad then merges them. This clarifies the earlier no-self-merge wording.
- Historical coach notes remain private. Future feedback requires explicit coach sharing in distinct publication storage; do not bulk-copy or automatically reclassify historical notes. AI drafts are invisible to children and parents. Coach approval does not replace guardian/purpose access checks.
- No billing, redesign, notifications, character module, medals, multi-sport or new academy-requested features. Slide 5 financial assumptions remain with Chris.

Policy decisions are recorded in the [consent clarification](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789712143431419) and [private-note clarification](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789716895831159). The Greek/UAE pilot distribution comes from Imad's project brief. These replace obsolete scope assumptions; they do not establish that the code enforces them yet.

## Purpose and academy setup

Test whether academies can use Trak for their ordinary development work: coaches record activity and intentionally share feedback, players understand that feedback, parents can oversee the correct child, and academy staff can oversee their own coaches and players. A synthetic rehearsal demonstrates a tested build. Evidence of an ongoing academy pilot requires an actual agreed start and observed use after admission gates pass; neither seeded records nor a demonstration count as live uptake.

| Charter input | Confirmed position / still needed |
|---|---|
| Price | Free pilot; pricing and investor financial assumptions are not finalized by this charter |
| Geography | One planned Greece pilot, other participating academies in the UAE; same build, isolated academy data |
| Academy/cohort register | Await names, designated academy contacts, coaches, age groups and participant counts for each academy |
| Pilot calendar | September 25 synthetic phone demonstration; real start/end dates and duration must be agreed per academy |
| Devices and accounts | Two phones and four synthetic roles for rehearsal; designated real-email test inboxes/devices still need a recorded run |
| Support | Imad coordinates delivery; academy support owner, escalation contact, support hours and working parent-support inbox require confirmation |
| Agreement and notices | P8 drafts/review required; controller responsibilities, retention/deletion and AI processing/purpose terms unresolved |
| Measurements | Agree collection method, denominator, observation period and success thresholds before the real pilot; the old eight-week/30-player targets are not adopted |

For the weekly readout, prepare evidence of coach participation and logging effort, player/parent return and usefulness, academy oversight, and failures/support incidents. These are measurement questions, not finalized KPIs or promised outcomes. S3 must validate the configured academy and date window, distinguish synthetic from admitted participants, and compare scorecard output with actual activity. Do not aggregate the single-academy legacy configuration into a claimed multi-academy result. The proposed thresholds and commercial conclusions in the archived scope need a fresh decision.

## Ownership and deliverables

| Owner | IDs | Required outcome |
|---|---|---|
| Kostas | K1, K2 | Cross-academy isolation and immediate loss of access after coach departure/transfer |
| Kostas | K3, K4 | Correct goal-rating buckets and no invented match facts in the **routed** CoachAddSession flow |
| Kostas | K5, K6, K7 | Honest partial-save failures/retries, zero scores preserved, latest academy assessments and truthful unassessed states |
| Kostas | K8, K9 | Authenticated/rate-limited schedule parsing and genuinely private coach notes |
| Tarek | T1, T2 | Distinct match identities and coach approval before AI feedback publication |
| Tarek | T3–T6 | Worldwide nationality choices, roster adoption without lost history, valid dates, later coach linking |
| Tarek | T7, T8 | Player error/retry states and safe feedback streaming; deck claims reconciled with the build |
| Imad | P1 | Verified-recipient parent linking, immutable invitation target, no direct table-write bypass |
| Imad | P2 | Under-18 consent enforced by the backend, purpose choices/withdrawal honored, guardian identity verified |
| Imad | P3, P4 | Multiple children across all parent screens; permitted shared feedback only, no private notes or AI drafts |
| Imad | P5, P6 | Account-bound onboarding and preserved forms; remove settings that do not change behavior |
| Imad | P7 | Real-email invitation journeys for new and existing parents, including a second child |
| Imad | P8, P9 | Terms, privacy and academy agreement drafts; one current pilot charter |
| Kostas | S1, S3, S5 | Second academy, org-scoped pilot configuration/scorecard, demonstrated backup restoration |
| Imad | S2, S4, S6 | Replay-safe synthetic demo data, branch/release protection, obsolete docs retired |
| Tarek | S7 | Dubai and Athens session dates/times round-trip correctly |

Every owner tests across role boundaries. A defect in another owner's table is coordinated before editing. Reserve migrations and shared files in #coding-agent-reviews; announce each merge and its deployment state there. Imad/Codex commits and tests changes in `imadd23x/trak-football-hub` first, then obtains review before applying them to the canonical repository. Preserve the team's current PR queue; a fork branch is not a production release.

## Execution order

1. September 18: release safeguards, retire misleading docs, parent linking; Makis reviews K1/K2/P1/P2.
2. September 18–20: consent, isolation, multiple children, private/shared notes and AI approval contracts.
3. September 20–21: shared-phone and invitation journeys; truthful settings; agreement drafts.
4. September 21–23: remaining logging/onboarding/error fixes, charter, deterministic demo fixtures, deck reconciliation.
5. September 24: integration, scorecard and restore evidence, buffer. Freeze new scope Thursday evening.
6. September 25: joint rehearsal and only demo-blocking fixes.

Use [the merge gate](release/merge-gate.md). No code task is done merely because a PR is open, merged or green.

## Verification matrix

| Journey | Evidence required |
|---|---|
| U1 | UAE coach adds five synthetic players, assesses three and logs a match; correct facts, errors and timing |
| U2 | Player adopts an existing roster row with two prior synthetic assessments; no duplicates or missing history |
| U3 | Ages 17/18 in GR/AE, missing age, consent grant/withdrawal/purposes; same child at academies A/B receives no B authorization from A approval; unresolved record/academy provenance denies access; direct API bypass attempts denied |
| U4 | Existing parent accepts a second child and switches children on Home, Matches, Alerts, Profile, Settings and consent |
| U5 | Player/parent direct database queries cannot retrieve private notes; shared feedback is visible as permitted |
| U6 | AI draft cannot be read before approval; coach edits/approves; child reads approved version |
| U7 | Academy B's coach cannot read or mutate academy A's records, including guessed foreign IDs |
| U8 | Removed/transferred coach holding an existing session loses former-academy access |
| U9 | Offline/failed requests show retry, not empty states; token refresh preserves forms; wrong-account races do not mix data |
| U10 | All four account roles delete successfully; check retained/orphaned data and avatar handling |

Also test seven-day invitation expiry, wrong email/role, existing-parent acceptance without credential changes, repeated claims, resend rotation and delivery failure. Copied application tokens rotate on resend; existing Supabase Auth email credentials retain their own Auth expiry and are not revoked by database token rotation.

Each verification record names commit/workflow, deployment, role/test identity, device, expected/observed outcome, and limitations. Execute access tests under authenticated roles; tests that merely inspect SQL text do not prove isolation. Use real phones and designated Gmail/existing-account inboxes for the final invitation run.

## Demo and real-user gates

Demo: U1–U10 together, two academies, four roles and two phones, using clearly synthetic data. Every shown capability must pass; unresolved failures remove that capability from the demonstration and remain recorded as gaps. A partial demonstration is not a passed full rehearsal. Never seed real identities, fabricate consent for real children, or count synthetic activity as pilot usage.

Before a real child signs up, require all of the following:

- K1/K2/P1 reviewed by Makis, deployed and verified against the live project with synthetic identities.
- Guardian approval and purpose enforcement for the agreed market/age policy and named academy; unresolved DOB or record/academy provenance cannot bypass it. Prove same-child A/B separation after grant, withdrawal and transfer.
- Approved expectations for multiple-guardian approval/withdrawal and child-data AI processing. Until the latter is resolved, keep those AI paths disabled for real-child data; coach publication alone is not processing authorization.
- Suitable signed academy agreement, with controller responsibilities and retention/deletion decisions resolved; privacy/terms match actual hosting, AI and email data flows.
- Verified account deletion for all roles, including a decision on consent evidence and avatars.
- Restore rehearsal evidence and duration (Kostas S5), not merely an available backup.
- Correct pilot org/cohort/date window and sane scorecard numbers; UI activity verifies telemetry independently of seeded records.
- Named support owner and working parent-support inbox.

Until those gates pass, use synthetic squads only. Real-academy names, cohort ages, dates, contacts and agreement decisions must be supplied/confirmed with the academies; do not invent them.

Wrong-child or cross-academy access, unauthorized feedback publication, loss of saved records, and failures of a required role journey block admission. If found after a cohort starts, pause the affected flow/admission and follow the reviewed incident and release process; record the failed expectation, affected scope and verification of the repair. A passing build or test count alone cannot waive a failed gate.

## Evidence checkpoint — September 18, 16:30 Dubai

The following separates code/review evidence from production evidence. Each row is a dated checkpoint, not a standing claim that all four roles work.

| Work | Evidence / release boundary |
|---|---|
| PR35 operational-report access | Merged as `09d22d4`; [production workflow 35332878336](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/actions/runs/35332878336) passed. Its recorded live checks cover the 12 reporting views and sign-in rendering, not all-role acceptance |
| Parent invitations/onboarding, settings and family screens | PR33, PR32 and PR39 are now merged into main `b9adf1c`, along with PR30/31. [Main run 35343003639](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/actions/runs/35343003639) failed the family browser test on its obsolete Settings label; Supabase and Vercel jobs skipped. Merged does not mean deployed or live-verified |
| Current integration repair | Fork candidate `cae7471` repairs that locator and the task-branch Vercel event guard on current main. Its [verification record](https://github.com/imadd23x/trak-football-hub/blob/cae7471b5d5b6487eefc21dd8cc4afa3efb37561/docs/reviews/task-branch-preview-guard-2026-09-18.md) records 309 source/harness tests, parent/report SQL and five local browser journeys passing. Production approval/review and coordinated calendar release remain outstanding |
| Backend/frontend release boundary | Read-only Supabase history records parent migration `20260917205027`. The recent PR30 run failed history validation before applying SQL, PR31/32/33 runs had no jobs, and PR39 skipped deploys. These runs do not identify who applied that migration or verify its exact SQL. PR35 remains the last fully verified CI deployment; do not describe all current backend state as unchanged since then |
| Parent complete match history | Fork commit `484ad20`, [verification record](https://github.com/imadd23x/trak-football-hub/blob/484ad200df40381dbaffbc64aeaa23c6b4dc635b/docs/reviews/parent-match-history-2026-09-18.md); tests and fork CI pass, no PR/production rollout yet |
| Coach-approved feedback and parent P4 | [PR40 review at `8a6a58c`](https://github.com/imadd23x/trak-football-hub/blob/5e71cafeb91028e354c5b4b817da323fc7e97b7b/docs/reviews/feedback-current-head-2026-09-18.md) retains failing runtime/storage regressions. Parent shared feedback depends on the repaired contract and P2 |
| Calendar release | PR41 adds date/time columns, but current CoachSchedule/PlayerHome/parser consumers still require coordinated repair. Do not unblock production solely because the parent locator is fixed; the schema/backfill and legacy/new timed/untimed behavior need joint verification |
| Real-child admission | Not cleared: effective under-18 academy-specific consent/purpose enforcement, multiple-guardian withdrawal precedence, reviewed notices/agreement, restore proof and live phone/email journeys remain open |

The separately parked consent-test conversion is deferred, not evidence that P2 is complete. Do not count review-only failing audits as green tests. Keep source edits, peer approval, merge, deployment and observable verification as separate stages in each release record.

## Historical starting point

At baseline: live Supabase was healthy with 51 migrations, but the legacy parent-link function was unsafe and consent threshold was still 15. GitHub main was unprotected; Imad had write but not admin permission. The latest main workflow deployed both backend and frontend, but five pending use-case failures did not block CI. Local baseline: 94 source tests and typecheck passed. None of these facts establishes readiness for real children.

These are initial observations, not the current migration/test counts or an up-to-date protection check. The checkpoint above and subsequent exact-commit release records supersede them.
