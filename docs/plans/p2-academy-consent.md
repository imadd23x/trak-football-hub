# P2 — academy-specific guardian consent

Status: **technical design only, September 18, 2026**. This document implements no SQL, changes no live service, and establishes no legal approval. Follow the [pilot readiness gates](../pilot-readiness-2026-09-25.md); synthetic demonstrations do not authorize real-child admission.

## Decisions and release boundary

- Trak requires online guardian approval below 18 in both UAE and Greece. This is the agreed pilot policy, pending legal review.
- Before approval, allow only the agreed minimal roster stub. No assessments, matches, attendance, child-linked meetings, recognition or other development records. No academy-collected or offline consent path.
- Consent is for one **child and one academy**, with separate purpose choices. A parent-child identity link does not authorize processing at every academy.
- Preserve all consent evidence. Never automatically convert legacy child-wide consent into academy approval.
- Historical coach notes remain private. Future sharing requires explicit coach publication and applicable consent; `parent_visibility` never exposes private notes or AI drafts.
- Imad confirmed on September 18: **processing may continue while another
  verified guardian's approval remains active for that academy**. Withdrawal
  removes the caller's approval without revoking another guardian's independent
  approval. An approval must cover the requested purpose; a different academy's
  approval never counts. Whose parent visibility each choice authorizes and
  dispute/reapproval handling still need their explicit contracts.
- Child-personal-data AI processing, its notice and its purpose scope remain undefined. Coach approval of output does not settle permission to send input to an AI provider.

## Current execution path

| Area | Current source and gap |
|---|---|
| Consent authority | `supabase/migrations/20260912000001_parental_consent.sql`: global threshold 15; `parental_consents` has no academy; the effective check ignores purposes; unknown DOB and unlinked roster rows bypass the gate. |
| Grant/withdraw | `record_parental_consent` checks a child link but accepts client notice text/version and labels verification without checking current verified Auth email/parent role. Grant supersedes every guardian's active child-wide record; withdrawal affects only the caller's records. |
| Development writes | `20260917000001_coach_write_ownership.sql` preserves assessment/award consent checks on INSERT, not UPDATE. `20260917000005_match_rpc_departure_check.sql` checks coach ownership but has no consent gate or saved academy/session identity. |
| Parent experience | `src/pages/parent/ParentConsent.tsx` selects the first pending child and submits child-wide approval. `src/lib/parent-data.ts` loads child-wide records. Settings has no implemented withdrawal control despite the notice promising one. |
| Existing foundations | Preserve P1 verified-recipient linking, P3 account/child-scoped loading, P5 captured-session protection, K1/K2 ownership/departure checks and K9 private/shared separation. None alone supplies academy consent. |

## Required authorization contract

1. Resolve a trusted child identity, validated calendar DOB, stable academy ID and requested purpose from authoritative records. Caller-supplied academy, parent, age or role cannot establish authority.
2. An authenticated parent must have a current verified email in Auth, parent role, an active child link and the required relationship declaration. Reuse the P1 identity rules; a copied invitation token or user-editable metadata is insufficient.
3. Approval references an approved, academy-specific notice with controller, country, version, exact text/hash and permitted purpose definitions. The server selects the notice; reject substituted, retired or mismatched versions. Decide reapproval requirements before publishing a replacement.
4. For a minor, require effective approval for that child, academy and operation's purpose. Missing/invalid DOB, unknown academy or unresolved consent state fails closed. Link/adopt/transfer operations must not manufacture approval.
5. Enforce `coaching_records` on development processing, `recognition` on awards, and `parent_visibility` on parent progress reads. Optional choices default off and remain optional. Reject malformed/extra purpose keys and non-boolean values. Minimal identity needed to request consent is a separate, narrowly defined read.
6. Apply controls to direct SQL/Data API access, every relevant RPC, service-mediated writes and reads; INSERT, UPDATE, reassignment and upsert must all obey them. Preserve independent coach ownership, departure and academy-isolation checks.
7. A child's eighteenth birthday follows one explicit server calendar rule shared by client helpers and tests. Restrict and audit DOB correction; a self-service change from minor to adult cannot silently bypass the gate. Unknown age is not adult status.
8. Withdrawal stops newly authorized processing and affected parent visibility according to the approved guardian rule. It does not delete audit events or automatically delete historical records. Retention and access to retained records require the P8 decision.

## Proposed data model and provenance

Names below are proposals, to reserve with the migration owner before implementation.

- An approved-notice catalogue binds immutable notice versions to stable academy IDs, controllers, country and purpose definitions. Operational approval is recorded; documentation is not legal sign-off.
- Append-only `academy_consent_events` records child, academy, actor/guardian, relationship, server verification evidence, exact notice, purpose choices, action, server time and request ID. Never store passwords or Auth tokens. Corrections/withdrawals append events rather than erase earlier evidence.
- A separate versioned state/projection supports effective authorization and locking per `(child, academy)`. Keep per-guardian decisions distinct: processing continues when at least one verified guardian retains applicable approval for that academy. Repeated requests use an idempotency key without discarding distinct later decisions. Parent-visibility projection remains subject to its separate scope decision.
- Preserve original legacy rows, timestamps, text and supersession history as legacy evidence with **unresolved academy scope**. Fresh approval is required; reviewed record attribution alone cannot turn old child-wide approval into a new grant.
- Do not derive historical ownership from a coach's or child's current membership. Pin academy provenance when creating each record; verify referenced rows agree and prevent later reparenting across academies.

| Record | Required authoritative provenance and integration |
|---|---|
| `squad_players` | Stable academy plus child identity or pending stub identity. Linking/adoption must reconcile identity without duplicating history or granting consent. Coordinate K2. |
| `coach_assessments`, `recognition_awards` | Preserve existing `organization_id`; verify roster belongs to that academy and forbid academy/child reassignment. Purpose checks also cover edits to historical records. |
| `matches` | Persist exact academy and roster identity; retain explicit originating session when applicable. Existing `logged_by` and `user_id` cannot distinguish multiple academies. Coordinate T1 and `log_match_for_player`; do not infer provenance on read. |
| `coach_sessions` | Persist the originating academy independently of mutable/deleted coach membership. A generic empty session need not expose a child; attaching a child is gated. |
| `session_attendance` | Verify session, roster and child belong to the same academy; preserve that identity through updates and coach departure. A mutable join must not move old attendance into a new academy. |
| `meeting_requests` | Pin academy and roster/child identity, including on status/reason updates; do not infer scope from current coach membership. |
| Calendar/derived records | Inventory child-identifying `coach_calendar_events`, summaries, exports and AI inputs. Generic scheduling is distinct from processing a named child's data; every child-bearing path needs a defined provenance/purpose. |

If a historical match/session/meeting cannot be attributed uniquely from evidence, mark it unresolved and deny affected development access. Provide a reviewed repair queue; never guess from present membership, duplicate into both academies or silently discard the record. Parent aggregates must include only authorized, attributed records.

## Delivery phases and owned files

### A. Settle contracts and prepare fixtures

- Obtain the remaining inputs below; implement the confirmed independent-guardian withdrawal rule without treating it as approval of the unresolved notice/visibility contracts. Reserve a new migration timestamp and shared interfaces with Kostas/Tarek.
- Specify permitted stub fields, academy/child identifiers, notice response, purpose-state response, grant/withdraw RPC signatures, error codes and idempotent retry behavior. Include plural child/academy combinations.
- Review `src/lib/consent.ts` date helpers with its current owner. Move threshold to 18 only with the coordinated backend change; a UI-only threshold change is not P2 completion.

### B. Add immutable scope and consent authority

- Add new `supabase/migrations/*_academy_consent*.sql`; do not rewrite historical migrations. Catalogue notices, append audit events, add constrained provenance and explicitly classify legacy ambiguity.
- Replace the global contracts behind `record_parental_consent`, `withdraw_parental_consent`, `get_children_awaiting_consent` and `my_consent_status` with academy-aware versions. Old write signatures must fail safely after cutover, never fall back to child-wide authorization.
- Use explicit grants and RLS. Revoke public/anonymous execution of privileged functions; constrain `SECURITY DEFINER` search paths and check caller authority inside them. RLS is bypassed by definer authority, so it cannot be the only guard ([Supabase functions guidance](https://supabase.com/docs/guides/database/functions)).
- Regenerate `src/integrations/supabase/types.ts` and define typed consent/provenance interfaces. Return safe academy/notice/status data without leaking another child's details.

### C. Close every processing and read path

- Add consent/purpose checks to assessment/award, match, attendance, meeting and related policies/RPCs, including edits to existing rows. Inventory `provision_my_profile`, DOB updates, roster adoption and service/edge writers. Do not leave an older permissive policy or overload callable.
- UPDATE policies need old-row authorization and new-row validation, with compatible SELECT rules. Test affected row counts: a denied update can match zero rows without an error ([Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)).
- Serialize grant, withdrawal, DOB/identity change and sensitive writes using a shared per-child/academy state lock and consistent lock ordering. A withdrawal that commits must prevent a later-committing unauthorized write; a prior authorized write must finish before withdrawal completes. RLS snapshot checks alone do not prove this.
- Scope parent reads/aggregates by academy and purpose at the database boundary. `parent_visibility=false` must not leak through joins, direct queries, caches, awards, summaries or explicit shared-feedback tables. Keep K9 private notes inaccessible even when visibility is true.
- Gate or disable child-personal-data AI paths until their permission/notice contract is approved; preserve T2 coach publication separately. Do not treat `coaching_records` as implicit authorization for undefined AI processing.

### D. Wire honest user journeys

- `src/pages/parent/ParentConsent.tsx`: choose child and academy, show approved controller/notice and independent choices, submit captured identity/version, distinguish load failure, no pending request, stale notice and completed approval.
- Add scoped status and withdrawal controls in `src/pages/Settings.tsx` or a focused parent consent screen. Show the selected academy and consequences before withdrawal; a failed request must not claim success. Explain that withdrawing one's approval does not withdraw another guardian's approval, and obtain the remaining purpose/visibility wording before release.
- Update `src/lib/parent-data.ts`, `src/hooks/useParentData.ts`, `src/contexts/ParentChildrenContext.tsx` and parent pages for authorized academy records. Include academy/effective revision in relevant cache keys; cancel/drop sensitive data on withdrawal, permission change and account switch.
- Update `src/pages/player/PlayerHome.tsx`, `src/pages/OnboardingPage.tsx` and routed coach callers (`CoachAddPlayer`, `CoachAddSession`, `CoachQuickAssess`, `CoachAwardPlayer`, `CoachPlayerProfilePage`) to show pending reasons and retain drafts on denial. Server checks remain authoritative.

### E. Prove, review and release

- Extend `supabase/tests` with role-switched academy-consent SQL and legacy fixtures, using `scripts/test-db.mjs`. Preserve existing P1/K1/K2 regressions. Demonstrate a negative control against the old child-wide gate.
- Add focused frontend behavior tests and intercepted browser journeys using real app providers. Run source tests, database harness, typecheck, lint, build and relevant use-case checks; record expected and observed outcomes at exact commits.
- Add a disposable **real PostgreSQL** multi-connection suite for locking races. The existing PGlite harness cannot prove independent concurrent transactions, live Auth behavior or delivery. Never run fixtures on the shared live project.

## Acceptance tests

| Boundary | Required result |
|---|---|
| Age | 17/18 in AE and GR; leap dates, UTC/Dubai/Athens birthday boundaries, invalid/missing/future DOB; authoritative age and no minor-to-adult self-edit bypass. |
| Identity/notice | Anonymous, unverified, wrong role, unrelated parent, copied token, altered notice/version/controller and stale notice cannot grant. Valid linked verified parent can approve the correct pair only. |
| Academy | Same child at A/B: approving A permits no B records; B membership, coach transfer/departure and roster adoption cannot relabel A history. Wrong/ambiguous match/session/attendance/meeting references fail. |
| Purposes | False `recognition` denies award insert/update; false `parent_visibility` denies progress reads and aggregates; false/missing `coaching_records` permits only the approved stub. Malformed JSON and upserts cannot bypass. |
| Direct access | Exercise real authenticated roles against tables and every RPC overload for INSERT/UPDATE/reparenting. Assert unchanged records and row counts, not just error presence. |
| Withdrawal | Withdrawal removes the caller's approval. Processing stops when no other verified guardian retains the required approval for that academy/purpose; it continues when another does. Other academy state stays intact. Parent visibility still requires its separate scope decision. |
| Concurrency | Independent transactions race grant/withdraw, development insert/update, DOB change and transfer; retries/deadlocks produce no unauthorized committed rows or lost audit events. |
| Privacy | Historical notes and AI drafts remain unreadable; explicit publication still requires applicable consent. Expired caches, a second child and shared-phone account changes reveal no stale data. |
| Legacy/audit | Existing child-wide approvals grant nothing automatically; ambiguous records are retained but blocked; repair is attributable. Retry, supersession, withdrawal and account deletion preserve evidence under the approved retention policy. |
| UI/failures | Parent selects among children/academies; errors never render as “no consent needed.” Failed/uncertain grant or withdrawal reloads authoritative state; notices and draft choices remain truthful. |

## Rollout and repair

1. Keep real-minor admission closed. Inventory provenance/legacy rows read-only; rehearse additive migrations and rollback/restore on disposable synthetic data. Confirm missing inputs and Makis/peer review.
2. Deploy compatible typed clients and approved notices behind a disabled admission switch. Add scope/audit structures and reviewed provenance backfill; unresolved rows remain explicitly blocked. No automatic approval backfill.
3. Cut over all relevant policies, functions and legacy signatures together. If any path lacks scope or its required notice, keep that academy closed. Failures must not reactivate the legacy child-wide gate.
4. Verify deployed roles with synthetic identities, both academies and real devices; record commit, migration, environment and evidence. Reopen real-minor admission only after the wider pilot gates pass.
5. On failure, close admission and affected processing, preserve audit events, and forward-repair schema/data/policies. A UI rollback must retain stricter backend guards; never roll back to threshold 15, erase consent evidence or re-enable ambiguous access. Rehearse backup restoration separately.

## Inputs still required

- Whose parent visibility each choice authorizes, and dispute/reapproval handling. Core multi-guardian processing precedence is now confirmed above.
- Approved academy/controller identities, country-specific notices, purpose wording, revision policy, retention/deletion decisions and exact minimal-stub fields. No placeholders in real approvals.
- Named UAE/Greece academy fixtures, stable IDs, age/cohort boundaries, DOB correction authority and birthday calendar rule. Synthetic fixtures must be clearly labelled.
- Child-personal-data AI processing scope, provider/data flows and notice; whether a separate choice is required remains a decision, not an assumption.
- Reviewed legacy-attribution evidence, repair owner, support contact and the disposable multi-connection PostgreSQL test environment.
