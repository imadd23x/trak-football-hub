# P2 consent authority and remaining cutover

Implementation starts from deployed main `dc5c9d5` plus reviewed calendar PR #38
(`8190b40`), integrated because the unmodified main birthday boundary failed
at 00:40 Dubai time. The current gate is still
child-wide, threshold 15, missing-age/unlinked-roster fail-open, and a grant
supersedes other guardians. #62 now requires `coaching_records`; it did not
implement academy scope or the other purpose gates.

## Agreed product contract

- Under 18 in Greece and UAE requires online guardian approval for the named
  academy. Joining another academy requires another approval.
- Each verified guardian controls their own decision. Another guardian's
  approval continues to authorize development processing after one withdraws.
- Legacy child-wide records remain evidence, never automatic academy approval.
- Private notes remain private; consent does not publish notes or AI drafts.
- Imad confirmed that one guardian's visibility choice applies to all linked
  parents. As with other purposes, any eligible guardian granting that purpose
  keeps it active for the academy; all withdrawing/declining disables it.
  This foundation reports that effective choice; reader policies follow at cutover.

## This implementation stage

Add a private consent schema: immutable approved notices, per-academy current
notice configuration, one lock/revision row per child/academy, append-only
decision events and each guardian's current event pointer. Preserve identifiers
and notice/controller snapshots independently of mutable/deleted memberships;
do not add cascading deletion of evidence or block existing account deletion.
Retention policy and erasure/export integration remain release requirements.

Only a verified Auth email plus a current parent profile and parent-child link
can grant. The child must have a valid under-18 DOB and a roster association to
the exact academy. The server chooses the approved notice from the academy
configuration; the client passes its ID, never arbitrary notice wording.
No real notice, controller, approval or enabled academy is seeded here.

The parent RPCs live behind checked functions in the private schema. Public
wrappers use SECURITY INVOKER; no client table writes or privileged public
function are added. Functions have fixed empty search paths and explicit ACLs.
All private tables have RLS and no application table grants.

Grant/withdraw requests carry a request UUID and the caller's expected current
event ID. Serialize repeated request IDs, then lock the child/academy scope.
Matching retries return the original event plus current state without undoing
a later withdrawal. Different payloads reusing an ID fail. Stale edits fail and
require a refresh. Another guardian's action does not overwrite this guardian.
Withdrawal of one's existing decision remains possible after a roster/link or
academy disappears. Current approval also rechecks live guardian verification,
link and current notice; retained evidence alone cannot authorize processing.
The guardian authority expires when the child turns 18; an adult's own choices
must be handled by the later cutover, not inferred from old guardian approval.

## Acceptance and verification

Exercise actual SQL roles/RPCs for two academies, children and guardians:
verified/unverified/wrong-role/unlinked callers; notice mismatch/replacement;
unknown/future/17/18-year-old DOB; strict purpose booleans; request replay and
payload conflict; stale grant after withdrawal; two guardians' independent
approvals and withdrawals; revoked links/verification; private-table denial;
immutable evidence; no conversion of legacy rows. Use positive controls before
denial assertions. Native separate connections must race repeated requests,
different guardians and stale grant/withdrawal without lost/duplicate events.
Keep main's existing suites and run both fresh and upgrade replays.

## Remaining full P2 delivery, rollout and rollback

This stage is not the development-record gate. Subsequent changes must pin
academy/child provenance for every assessment, match, attendance, meeting,
recognition and child-bearing AI path; cover INSERT/UPDATE/RPC/upsert; enforce
purpose-aware reads and serialize authorized writes with withdrawals; protect
DOB correction; replace legacy grant signatures and update the parent/player/
coach UI together. Tarek's #53 is the starting write-path coverage inventory.
The client must show academy, notice and per-purpose choices, preserve retries,
offer withdrawal and never show a failed read as no consent needed.

Keep real-child admission closed until the full path, notice/controller inputs,
retention/deletion/export behavior, independent review and pilot gates pass.
No production merge is authorized by this source work. The foundation can be
reverted before deployment; after application preserve event history and use
reviewed forward repairs. Never reopen the legacy fail-open gate as rollback.
