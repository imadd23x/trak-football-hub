# P2 development-read boundary — draft checkpoint

The write boundary alone left existing SELECT policies able to return records after withdrawal and despite a declined parent-visibility choice. Existing player access to private coach notes was also not corrected by consent writes. The new forward migration adds a restrictive SELECT policy to matches, assessments, private notes, awards, attendance and meeting requests. Existing audience/ownership policies still have to allow the row.

The predicate checks the record's stamped child and academy, current caller relationship, verified parent identity, valid DOB, current academy/notice approval for coaching, optional recognition for awards, and optional visibility for parent readers. One eligible guardian's approval applies to all linked verified parents; another guardian can keep a purpose active after withdrawal. Private notes additionally require their actual coach author. Unknown or unresolved historical provenance is hidden rather than assigned an invented academy or approval. Minimal roster access remains available to request consent.

Adult coaching remains readable through the original audience rules. Parent visibility expires at 18; adult optional recognition remains unavailable until the adult choice flow is implemented. That limitation, unresolved history, old grant/withdrawal UI and service paths mean this draft must not deploy yet.

## Runtime compatibility and verification

PostgREST table/view GET requests use [read-only transactions](https://postgrest.org/en/latest/references/transactions.html). The read predicate therefore has no writes or row locks; it does not call the write authorizer. VOLATILE allows its internal queries to use fresh snapshots after an INSERT's concurrent-grant wait. This is not a promise to retract already returned data or defeat explicit repeatable-read snapshots.

- Fresh and deployed-parent upgrade order: 69 migrations; all six SQL suites pass. Authority 52, writes 36, reads 43, operational view 282 assertions.
- Read assertions cover real player, parent, coach and academy administrator roles; all six table audiences; two academies and guardians; optional choices; private notes; unknown/future DOB; unresolved history; lost verification; notice replacement; disabled academy; withdrawal; and adulthood.
- The pre-read-boundary baseline demonstrably fails privacy, declined visibility and withdrawal assertions. Six specific runtime mutations remove private-note, visibility, recognition, academy-scoping, reader-verification or coaching-approval protection; each fails its expected access assertion. All 20 foundation/write/read runner controls pass.
- Native PostgreSQL 17.11 runs all six suites and the ten existing independent-connection blocking races. A real READ ONLY parent transaction reads an approved assessment; another connection commits withdrawal; the same reader's next READ COMMITTED statement returns zero rows. The disposable server is stopped afterward.
- Withdrawal now hides rows from UPDATE selection through SELECT RLS. The write suite accepts a demonstrable zero-row update as well as SQLSTATE 42501, and rejects any changed row or unexpected error; receipt/no-write assertions remain. This preserves the behavioral contract rather than requiring a particular denial mechanism.
- Local application checks: 385 source tests, 17 harness tests, consent timezone checks, typecheck and production build pass; lint has zero errors and 134 existing warnings. Five built mobile browser journeys pass with synthetic intercepted HTTP. The use-case gate remains green with three known pending UC-A02 test failures and 15 pending use cases without tests. These browser journeys do not exercise this migration through a running PostgREST API. No production performance or end-to-end deployment claim is made.

## Remaining cutover requirements

RLS is not the complete application boundary. Service-role and SECURITY DEFINER readers must be inventoried and guarded explicitly; coach-assistant currently constructs child-bearing context from the minimally readable roster even without development rows. Player-feedback reads private notes and needs the reviewed explicit-sharing model. Pending teammate tables such as shared feedback and AI drafts need equivalent coverage when integrated.

Legacy match/attendance/meeting history, adoption, adult optional choices, parent UI/current notice/controller configuration, generated types, all-role export/deletion/retention, teammate integration and independent review remain required. Do not deploy this draft before those journeys work together. Rollout still requires explicit production approval; repair forward without reopening access after withdrawal.
