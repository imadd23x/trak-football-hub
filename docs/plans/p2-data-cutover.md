# P2 development-record cutover

Worktree restored from committed authority #70 (`8467ecd`) and released main. The former uncommitted temporary draft is not evidence or an implementation dependency.

Required final outcome: a verified guardian's current academy-specific choices control all development writes, permitted readers, AI processing and parent UI. Under-18 applies in GR and AE; unknown age cannot bypass it. Another eligible guardian may keep a purpose active. Legacy approvals are not converted into academy approvals. Private notes remain private. Account deletion and retained evidence must remain coherent.

First executable boundary: pin child and academy on the six existing development tables (matches, assessments, private notes, awards, attendance and meeting requests), resolve ownership from authoritative current roster/session relationships, and serialize each authorized write with the matching child/academy consent scope. Caller-supplied provenance cannot change ownership. Do not guess an academy for a player linked to multiple academies. Add append-only authorization receipts only for writes that actually persist, including the guardian events and scope revision that authorized them. Preserve historical evidence without fabricating past approval.

Verification must demonstrate rejection before implementing the guard and positive controls afterward: ages 17/18/unknown, two academies, two guardians, purpose choice, withdrawal, wrong/ambiguous academy, update/upsert, rollback/no-op receipt behavior, immutable provenance and DOB, plus actual independent-connection races against withdrawal and guardian/roster changes. Retain existing role/ownership tests; where their fixtures conflict with the new policy, supply explicit synthetic authorization rather than bypassing consent guards for app roles.

Subsequent boundaries remain part of the same required delivery: purpose-aware readers, legacy/adopted history, AI/functions/RPC owner bypass, adult optional choices, retention/export/erasure, notice/controller configuration and UI. No foundation or partial guard is a complete cutover. Do not deploy while callers still use legacy grant/withdrawal semantics or while existing journeys fail.

Rollout: independent review of the full dependency graph, complete regression and concurrency evidence, explicit production approval, forward migration, synthetic verification of each role and current notice/configuration before real-child admission. Rollback must not re-enable processing without approval; preserve evidence and repair forward.
