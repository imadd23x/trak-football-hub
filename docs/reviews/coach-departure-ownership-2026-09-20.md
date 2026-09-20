# Coach departure: academy data retention and access

September 20, 2026. Status: **user decision recorded; gaps reproduced; implementation and independent review pending**. This is not a production change or release approval.

## Controlling pilot decision

Imad confirmed that academy data must stay with the academy when a coach leaves. This supersedes the earlier product assumption that coach-authored records, session plans and calendar events are portable personal work product. Treat this as the pilot access/retention contract, not a legal determination of ownership or a change to existing privacy/consent rights.

- Removal, resignation, transfer or membership revocation must deny the former coach subsequent academy reads, writes, publication and exports through the API as well as the UI. Authorship and an already-issued access token confer no continuing authority.
- Keep roster, development history, assessments, private/shared notes, awards, session plans, attendance and calendar records attributed to their original academy. A new academy must not inherit them by hiring the author. Account deletion must not silently erase academy history; reconcile the reviewed retention/erasure contract.
- Keep the academy's authorised operational history available after departure. Private notes and AI drafts remain restricted: retaining them does not automatically publish them to players/parents or create a new administrator permission.
- Separate personal account/profile data from academy records in account portability. Any operational export must have an explicit current academy-authorisation check and bounded scope; author-based bulk retrieval is insufficient. Preserve legitimate parent/player access within existing consent and publication rules.
- Clear application caches and stop subscriptions when membership is revoked; backend authority must be checked independently. Previously downloaded files, screenshots or information already seen cannot be remotely recalled. This is not a promise to revoke a bearer signed URL instantly: inspect Storage delivery and expiry explicitly before claiming it meets the requirement.

## Source and runtime evidence

Fresh GitHub checks: upstream main `4335e8984777b7b704e8706d3fe277352658c9ed`; open #44 `8e72e80ac87b39670fa20c6dcf4e70b76bbadb69`. Runtime reproduction used integration #34 `7e8e9b5de1968b27e4e7d6ecb5bdddba7c2d326e`, which includes #44 and the forward history repair. These findings are about that candidate, not a claim that #44's export is deployed.

Sources explain the failures:

1. `20260917000002_coach_departure_and_transfer.sql` explicitly exempts `coach_sessions` and `coach_calendar_events`, calling them the coach's diary and flagging academy ownership as a pre-pilot decision. Their policies retain author-based access.
2. `20260919140000_export_my_account.sql` implements a SECURITY DEFINER export. Its coach branch queries roster, assessments, private notes, sessions, calendar events and awards by `coach_user_id = auth.uid()` without current academy authority. Table RLS therefore does not enforce the intended departure boundary inside that RPC.
3. The club session policy in `20260609000001_fix_rls_recursion.sql` resolves academy access through `coach_in_my_org(coach_user_id)`, the coach's current membership. Thus session access moves between academies with the coach. Pinned roster/assessment provenance alone does not protect sessions.

The [reproducer](coach_departure_ownership_repro.py) copies the existing harness/fixtures to a temporary directory and injects synthetic checks into the actual coach-departure suite. It runs native PostgreSQL 17.11 over a private Unix socket with no network listener, no inherited database credentials and cleanup. It never edits the checkout or connects to hosted Supabase. It calls the actual `remove_coach_from_org`, legacy `join_organization` and `export_my_account` under the authenticated role. The legacy join is a transfer probe for this candidate, not an approved admission path.

Results, 76 migrations:

| Check | Result |
|---|---|
| Unchanged existing native runner | All ten SQL files pass, including export, departure, privacy, history and deletion |
| Added ownership requirements | **Fail: 16 desired assertions**, native process exit 1 |
| Removed coach direct roster | 0 rows (existing denial works) |
| Removed coach export | 2 roster rows, 1 assessment, 1 private note, 1 session and 1 event remain readable |
| Removed coach direct session/event | 1 of each remains readable |
| Coach after transfer to academy B | Same prohibited export and direct session/event access |
| Original academy A session access after transfer | Lost, despite positive access before departure |
| New academy B session access | Gains academy A's session |
| Positive controls | Current coach's original roster/attendance/assessment/note/event, original academy's pre-departure session, retained academy roster and coach's personal profile export pass |

Run against the named candidate or a reconciled successor:

```sh
python3 docs/reviews/coach_departure_ownership_repro.py /absolute/path/to/candidate --control
python3 docs/reviews/coach_departure_ownership_repro.py /absolute/path/to/candidate
```

The second command must become green after the implementation; its current failure is a bug reproduction, not a passing security check. It deliberately fails if fixture anchors change, requiring an explicit rebase. On macOS the harness needs permission for PostgreSQL shared memory. An initial sandbox run could not initialise PostgreSQL; both reported runs completed outside that restriction and cleaned up their temporary clusters. An initial temporary-path alias issue was corrected before either reported run.

## Bounded implementation and handoff

**Kostas — K-A/K-C and existing #44 export/deletion writer:** first reconcile with current PRs and unpublished work. Propose a focused follow-up branch with explicit dependencies; do not fold unrelated work into #44. Persist academy provenance for sessions/events and every other unscoped academy record, stamp it server-side, preserve it through transfers/deletion, and check current membership in reads/writes/export. Inventory policy OR-composition, views and SECURITY DEFINER/service-role paths. Backfill only with trustworthy historical evidence; the coach's current academy is not proof of an old record's origin. Ambiguous legacy rows need a reviewed mapping and restricted access, not guessed attribution or deletion. Keep private-note/publication restrictions and personal-account portability.

**Imad — I-A/I-P/I-R:** retain the shared admission/consent/trigger ownership and integrate the agreed guard contract; verify parent/player continuity and account-cache behavior. Existing #34/#36/#37 history repair remains necessary but does not solve the reproduced session/export gaps. This record creates no competing backend implementation.

**Tarek — T-V:** independently review the focused migration/RPC diff and register regression suites through the existing runner reservation. Carry the 16 failing checks, then add active-token/direct API writes, publication, current/foreign/removed academy and coach deletion, genuine retained-history controls, AI/Storage and concurrency cases. Removing the membership/provenance guard must make the relevant test fail. Coordinate #42 calendar ownership before any schedule-writer edit.

Before release: fresh and deployed-order replay, membership-removal versus export/write races, exact-head peer review, required CI, explicit production approval, and a synthetic live rehearsal. Reads committed before revocation may already have delivered data; define transaction ordering and test requests after committed revocation. Roll back pre-release source normally; after migration use forward repair or a fail-closed feature disable, never restore author-only academy access. No hosted database, Auth account, production setting or application implementation was changed for this decision/reproduction.
