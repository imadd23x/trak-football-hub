# P2 development-write boundary — draft checkpoint

Base: committed authority #70 (`8467ecd`) plus released main `4335e89`, integrated at `78e48bf`. This persistent worktree reconstructs the required boundary from real source; the lost temporary draft and its old test results are not reused.

The academy authority previously accepted decisions without affecting development writes. This forward migration stamps child/academy provenance on matches, assessments, private notes, awards, attendance and meeting requests. It checks a current academy approval for under-18 coaching and the recognition choice for awards, rejects unknown/unlinked identity, disallows reassignment of record IDs/provenance, and records immutable authorization receipts only after a row persists. A player with multiple academies must supply a valid academy rather than silently using the first one. Established DOB changes require verified support review.

The write and decision paths serialize on the same child/academy scope. Shared locks cover the guardian's current verification/link, child DOB/profile and current roster/coach membership. Another eligible guardian can keep a purpose active after one withdraws. Native testing found that the old STABLE policy helper reused the INSERT's pre-wait snapshot after a concurrent grant; marking the replacement policy helper VOLATILE fixed that demonstrated false rejection.

The existing account-deletion body is moved behind a checked wrapper with a private transaction/actor capability. That permits the existing deletion bookkeeping after withdrawal, without giving application roles a way to enable maintenance themselves. The tested coach deletion retains record provenance and receipts. This is not a claim that all four roles' deletion/export/retention paths are complete.

## Observed verification

- Pre-cutover foundation fails the actual unauthorized assessment probes for age 17, unknown age, unlinked roster and a younger child with only legacy child-wide approval.
- New write suite: 36 assertions, including positive real-role writes across all six tables, age 10 and 18, two academies/guardians, purpose choice, last withdrawal, updates, ambiguous match academy, immutable IDs/DOB/provenance, no-op/rollback receipt behavior, private evidence denial and coach deletion.
- Five deliberate runtime mutations (purpose checks, academy scoping, provenance checks, DOB protection and receipt-before-persistence) each make the real role suite fail at the corresponding assertion. Together with foundation controls, 12 node runner tests pass.
- Native PostgreSQL 17.11: all five SQL suites pass after replay. Ten races use independent connections and assert actual lock overlap through pg_blocking_pids: four foundation races, grant-before-write, both withdrawal/write orders, both unlink/write orders and transfer-before-write. Verify exact event, revision, record and receipt outcomes. Disposable server stopped afterward.
- 385 source and 17 harness tests pass; typecheck/build pass; lint zero errors/134 existing warnings. Five built mobile browser regression journeys pass with synthetic intercepted HTTP. Those browser journeys do **not** exercise the new database boundary through PostgREST.
- Existing three pending UC-A02 failures and 15 pending use cases without tests remain. The legacy privilege suite's positive fixture now obtains explicit synthetic academy consent instead of using a bypass; its legacy-evidence tests remain.

## Still required before any release

1. The six current direct-table reader policies are now covered by the subsequent read boundary and its role tests; see `p2-consent-read-boundary.md`. Private/shared feedback integration and service/owner readers remain.
2. Legacy match/attendance/meeting provenance, safe roster adoption and retained history. Unresolved historical records currently cannot be edited through the new guard; do not treat that as a completed migration.
3. Adult optional-purpose choices: this stage permits adult coaching without guardian approval but rejects adult recognition until the adult's own choice exists.
4. Child-bearing AI and SECURITY DEFINER RPC path inventory, including the new feedback/draft tables in pending teammate branches. Direct table coverage alone does not establish complete service coverage.
5. Full parent/player/coach UI and generated types, academy selection for player match writes, retiring legacy grant/withdrawal callers, configured approved notices/controllers and the agreed under-18 policy throughout.
6. Export, retention and deletion for all four roles. Compose the wrapper with the final #44/#47 deletion implementations and organization cleanup; this draft only verifies the coach case. Do not let a later historical CREATE OR REPLACE silently bypass the wrapper.
7. Full parent-history, private-note and teammate-branch integration, independent review, explicit production approval and live synthetic verification. #72's standalone database UTC fix is separately pending review.

No production change, real notice, enabled live academy or legacy consent conversion is made by this work. Keep this PR draft. The remaining cutover in the plan is still the required outcome; this checkpoint does not redefine pilot readiness.
