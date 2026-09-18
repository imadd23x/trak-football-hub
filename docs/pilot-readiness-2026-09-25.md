# Pilot readiness — September 25, 2026

This is the current delivery scope. Source code and recorded deployment/runtime evidence determine completion; this document is not proof that a task works.

Source: [Imad's September 18 Slack plan](https://trakfootball.slack.com/archives/C0BLW846732/p1789675494856059). Correct repository: `kostasanastasioubusiness-lang/trak-football-hub`; initial implementation baseline `1fcb9238`. `t-bones29/trak-football-hub` is an outdated copy. Deployment: `trakfootball.com`, Supabase project `xbykbqolvqyqmipikuae`.

## Confirmed decisions

- September 25 is a phone demonstration with synthetic accounts. Real-child admission is a separate gate below.
- UAE first, Greece on the same build. Guardian consent is required below 18 in **both** countries as Trak's pilot policy, pending legal review. This supersedes the earlier "Greek behaviour unchanged" wording.
- For real minors, permit minimal roster setup only before online guardian approval. Development records wait for approval. Academy-collected/offline consent is not in this release. Historical synthetic assessments can demonstrate roster adoption without an exception for real children.
- Consent is academy-specific: approval for a child at one academy does not authorize another academy. Preserve legacy consent evidence without automatically treating child-wide approval as academy approval. The multiple-guardian withdrawal rule and child-personal-data AI notice/scope remain pending; see the [P2 technical delivery plan](plans/p2-academy-consent.md), which is design only.
- Imad coordinates and merges releases. Kostas or Tarek must approve Imad's PRs; Imad then merges them. This clarifies the earlier no-self-merge wording.
- Restore privacy for all existing coach notes. Future feedback is shared only by explicit coach publication; do not automatically copy historical private notes into shared storage. Kostas owns K9; P4 consumes only explicitly shared feedback. AI feedback is invisible to children until a coach approves it.
- Imad/Codex commits and runs regression checks in `imadd23x/trak-football-hub` before proposing changes to the canonical repository. All coding-agent coordination and review requests go to Slack `#coding-agent-reviews`.
- No billing, redesign, notifications, character module, medals, multi-sport or new academy-requested features. Slide 5 financial assumptions remain with Chris.

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
| Imad | P2 | Academy-specific under-18 consent enforced by the backend, purpose choices/withdrawal honored, guardian identity and approved notice verified |
| Imad | P3, P4 | Multiple children across all parent screens; permitted shared feedback only, no private notes or AI drafts |
| Imad | P5, P6 | Account-bound onboarding and preserved forms; remove settings that do not change behavior |
| Imad | P7 | Real-email invitation journeys for new and existing parents, including a second child |
| Imad | P8, P9 | Terms, privacy and academy agreement drafts; one current pilot charter |
| Kostas | S1, S3, S5 | Second academy, org-scoped pilot configuration/scorecard, demonstrated backup restoration |
| Imad | S2, S4, S6 | Replay-safe synthetic demo data, branch/release protection, obsolete docs retired |
| Tarek | S7 | Dubai and Athens session dates/times round-trip correctly |

Every owner tests across role boundaries. A defect in another owner's table is coordinated before editing. Reserve migrations and shared files in Slack; announce each merge and its deployment state.

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
| U3 | Ages 17/18 in GR/AE, missing age, academy-specific grant/withdrawal/purposes; direct INSERT/UPDATE/RPC bypass attempts denied; legacy ambiguity fails closed |
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

Demo: U1–U10 together, two academies, four roles and two phones, using clearly synthetic data. Every shown capability must pass; unresolved failures remove that capability from the demonstration. Never seed real identities, fabricate consent for real children, or count synthetic activity as pilot usage.

Before a real child signs up, require all of the following:

- K1/K2/P1 reviewed by Makis, deployed and verified against the live project with synthetic identities.
- Academy-specific guardian approval and purpose enforcement for the agreed market/age policy; unresolved DOB/provenance cannot bypass it. Multiple-guardian withdrawal semantics and child-personal-data AI scope/notices must be resolved before enabling affected processing.
- Suitable signed academy agreement, with controller responsibilities and retention/deletion decisions resolved; privacy/terms match actual hosting, AI and email data flows.
- Verified account deletion for all roles, including a decision on consent evidence and avatars.
- Restore rehearsal evidence and duration (Kostas S5), not merely an available backup.
- Correct pilot org/cohort/date window and sane scorecard numbers; UI activity verifies telemetry independently of seeded records.
- Named support owner and working parent-support inbox.

Until those gates pass, use synthetic squads only. Real-academy names, cohort ages, dates, contacts and agreement decisions must be supplied/confirmed with the academies; do not invent them.

## Initial evidence and remaining limitations

At baseline: live Supabase was healthy with 51 migrations, but the legacy parent-link function was unsafe and consent threshold was still 15. GitHub main was unprotected; Imad had write but not admin permission. The latest main workflow deployed both backend and frontend, but five pending use-case failures did not block CI. Local baseline: 94 source tests and typecheck passed. None of these facts establishes readiness for real children.

Track implementation, merge, deployment and live verification separately in PRs and release records. The local work starting September 18 has not yet passed peer review, deployed or completed the phone/email admission gates.
