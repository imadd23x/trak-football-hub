# Internal consent predicates and the coach UI contract

Status: implemented and verified on a review branch based on `upstream/main`
`9114f4c`. No hosted migration, seed or Auth change was made by this work.
A hosted API exposure check remains required before release.

## Defect and boundary

On 21 September 2026, a read-only role probe against Trak found that both
`anon` and an unrelated authenticated synthetic identity could invoke four
`SECURITY DEFINER` functions with another player's/roster row's UUID:

- `public.player_age_years(uuid)`
- `public.player_has_parental_consent(uuid)`
- `public.player_consent_required(uuid)`
- `public.squad_player_consent_required(uuid)`

The first discloses age; the others disclose consent state. They have explicit
Supabase grants to `anon` and `authenticated`; the older `REVOKE FROM PUBLIC`
did not remove those grants. This was already recorded as a residual exposure
in `docs/reviews/player-age-utc.md`. The live probes returned only aggregate
success indicators and made no data changes.

Current main has no browser/Edge RPC caller of these raw functions. Self and
parent screens use `my_consent_status()` and
`get_children_awaiting_consent()`. Internal definer callers and service-role
SQL still need the raw helpers. Five RLS policies invoke the squad predicate
as the authenticated role, so simply revoking it would break legitimate
assessment, recognition, and published-feedback operations.

During this work, PR #94 at `687766f89c8721cc0a6d9721a9dfcb82ba8ddf3f` added
four direct browser calls to the raw squad helper. PR #95 at
`a0982dad7539b62393663e52468c6c004bf02f96` added a journey suite with two such
coach calls and a raw self-age call. They need the compatibility changes below.

## Change

`20260921182442_restrict_consent_helper_rpc_access.sql` was created with
`supabase migration new restrict_consent_helper_rpc_access`.

1. Revoke the four raw helpers from `PUBLIC`, `anon`, and `authenticated`;
   preserve owner execution and explicitly retain `service_role` execution.
2. Add `trak_private.squad_player_consent_required(uuid)`, a stable definer
   bridge with an empty search path. Authenticated RLS can execute it. Anonymous
   roles cannot use the schema or function, and authenticated cannot create in
   the schema. Keep `trak_private` outside PostgREST's exposed schemas.
3. Change only the qualified helper reference in five existing policies:
   assessment insert, recognition insert, player feedback read, and player and
   parent shared-feedback reads. Preserve every ownership, academy, session,
   publication, and withdrawal condition.
4. Add the scoped UI RPC
   `public.coach_squad_player_consent_required(p_squad_player_id uuid) RETURNS boolean`.
   It requires a subject, the coach role, and `squad_player_is_mine(id)` before
   invoking the internal predicate. This preserves the current coach/academy/
   departure checks. Foreign, missing, null, and inaccessible IDs all return
   SQLSTATE `42501`, message `Not authorized for this squad player`.
   Only `authenticated` is granted execution. Supabase's default service grant
   is explicitly removed; service callers retain the internal helpers instead.

The four raw bodies, UTC configuration, volatility, definer status, owners,
argument types, and return types remain unchanged. No user rows or consent
records change. The migration checks actual effective grants and policy
function dependencies and can be applied a second time.

## Compatibility handoff

PR #94 must change its four RPC names and its MSW endpoint to
`coach_squad_player_consent_required`. Argument name and boolean result are
unchanged; errors still take the existing unconfirmed-reason path. PR #95 must
use that name for the two coach checks and read its own player's age through
`(my_consent_status()->>'age')::integer`. Its 19 assertions are retained.

Patches against the exact heads above are prepared outside those authors'
branches in [consent-helper-compatibility](consent-helper-compatibility/README.md). These patches are
handoff material, not pushed changes. Deploy the scoped RPC before, or together
with, the patched UI. Do not merge an unpatched #94 and assume its consent
notice works after the raw-helper revoke.

In a disposable checkout containing this migration and those caller patches,
all eight #94 notice tests pass and #95's complete 19-assertion SQL journey
passes after all 84 migrations. Reverse-apply checks confirm both patches
match the locally validated files. No other-author branch was edited.

## Local evidence

- Before the migration, the new role tests failed on exactly 16 unauthorized
  raw-helper invocations in both PGlite and native PostgreSQL 17. The positive
  RLS controls still passed. Known and nonexistent IDs are both exercised.
- After the change, the focused privilege/consent suite passes 227 assertions,
  including unrelated coach/player/parent denial, raw-helper denial, scoped
  coach true/false results, withdrawal and re-approval, missing/null IDs,
  academy departure, role loss, and explicit anonymous/service-role behavior.
- All five policy paths have actual successful reads/inserts, followed by
  withdrawal denial. An unrelated account sees neither feedback canary.
- The timezone suite passes 142 assertions in six timezones. It retains the
  original arithmetic/negative controls as owner and exercises each player's
  scoped `my_consent_status()` under the authenticated role.
- Native PostgreSQL 17 passes the existing ten academy-upgrade suites and the
  timezone suite. The temporary cluster is stopped and removed by the harness.
- Applying the new migration twice succeeds; the 227 assertions still pass.
  A before/after catalog comparison confirms the four raw functions are
  unchanged and every policy is identical except the five qualifications.
- Sixteen applied mutation controls are caught: regrant each of the four raw
  helpers; restore each of the five public policy references; force the private
  bridge open; remove all coach scope, remove coach role, remove roster scope,
  force scoped false, grant scoped execution to anon, or grant it to service.
  These ran in disposable databases without editing tracked production files.
- The local Supabase security advisor reports no errors. Its one warning is
  the existing mutable search path on `export_scope_includes_observations`,
  outside this change. The release coordinator ran all 20 current CI checks
  on this final code tree; all passed, including native PostgreSQL, convergence,
  query plans, and browser checks. Results are recorded in
  `/private/tmp/trak-pilot-evidence-20260921/privacy-final/results.json`.
  A combined-branch integration run remains separate.
- An independent agent review reran the focused database suite and found no
  actionable issue; this does not replace the required non-author human verdict.

Transient runner copies were used only to add catalog snapshots, second apply,
mutation SQL, and native timezone coverage. No shared runner, CI, or package
file was edited. These are SQL role tests, not hosted PostgREST tests.

## Hosted release checks and remaining limits

At `2026-09-21 18:33:44 UTC`, a read-only hosted query found neither a session
`pgrst.db_schemas` value nor a database/role override for exposed schemas or
extra search path. This **does not reveal** PostgREST's effective external
configuration. The available connector does not provide that configuration.
Do not claim the private bridge is inaccessible over HTTP from that result.

Before deployment, inspect the hosted Data API configuration and establish that
`trak_private` is not exposed. After authorized deployment, use synthetic
identities to verify the four raw RPCs are denied for anonymous and unrelated
clients, selecting `trak_private` as an API schema is refused, the scoped coach
RPC admits only the owning current coach, and parent/player/coach journeys
still work. Keep API schema exposure as an explicit release prerequisite.

The larger consent-authority/data-cutover work must preserve these private
policy references and the scoped coach API. If it changes the internal
predicate from `STABLE` to `VOLATILE`, update the bridge and scoped RPC
volatility deliberately in its own forward migration. This change preserves
current gate semantics, including unlinked roster behavior; it does not decide
those future product rules or prove system-wide performance/capacity.

## Rollout and rollback

Land the reviewed migration and compatible #94/#95 callers in a coordinated
order, run every current CI test-job step on their combined tree, and verify
the hosted checks above after deployment. No hosted update is authorized by
this review document alone.

If a legitimate path fails, repair the private bridge or scoped endpoint in a
new forward migration and retest the affected RLS path. Keep the four raw RPCs
closed. Never roll back by regranting arbitrary-ID access, removing consent
conditions, or editing historical migrations. An application rollback can
remove the new pre-check UI while the database retains its consent gate.
