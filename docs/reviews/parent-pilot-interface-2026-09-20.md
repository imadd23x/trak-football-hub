# Parent pilot interface integration

Status: integration in progress; no production change. Base: fork #9 `74a4a35e6d2633eff35cc6bbf71cf6e6b5a7e482`, on canonical main `4335e8984777b7b704e8706d3fe277352658c9ed`.

## Scope and provenance

Compose existing Imad-owned parent work into the current staff/Auth candidate. Use selected commits with `cherry-pick -x`; preserve original migration bytes. Do not merge whole fork #1/#2 ancestry: it contains superseded coach-code onboarding. Existing #48 Settings and PasswordInput are already present and must be reconciled, not replaced.

1. `484ad20`: complete match summaries and cursor history, invoker RPCs and regression fixtures.
2. `01304a4`: retained development history with nullable/deleted coach attribution.
3. `da5412b`, `a2bda4b`, `d1bc895`: existing pinned history-upgrade verification and suite metadata, preserving the current staff suites and workflow.
4. `6d3bb25`: existing consent retry UI, inspected against current shared Auth boundaries; no new consent authority or household schema.
5. `fdf51aa`: exact selected match, assessment and award details; never substitute a stale cached record when authority or retrieval changes.
6. `f74a8a7`: private-avatar presentation and upload feedback, preserving current verified-account Settings controls.
7. `7216ae0`: accessible password visibility using the already present shared component; retain staff-invitation admission gates.

The committed result and any omitted/dependent hunks will be recorded below. Shared runner changes are composition of the existing parent-history hooks, not a competing replacement for Tarek's #42 registry work.

## Acceptance and verification

- Parent Home totals include all authorized matches beyond API row limits. History cursor navigation reaches every record once in a static fixture and survives retry, child/account changes and empty later pages.
- Opening a match retrieves exactly that child's selected record. Assessments and awards display the selected authorized record; private coach notes/AI drafts are not exposed.
- Deleted/departed author labels cannot erase retained authorized history. Academy ownership and consent remain release gates; this UI does not fix the known departure/export backend failures.
- Profile images resolve from the existing private Storage boundary; upload/reset feedback cannot leak across account changes. No claim about hosted Storage policy follows from mocked UI tests.
- Password toggles work by keyboard and preserve input values without bypassing current staff admission or Auth recovery.
- Run focused source checks first, then complete source/harness/type/lint/build checks, existing/new built-app phone journeys and fresh/deployed-order SQL replay. Verify history role checks in native PostgreSQL with synthetic fixtures and API row-cap behavior where relevant. Exercise combined account-switch/child-switch behavior, not just independent components.
- Preserve explicit coach-only match logging and fully waived academy invitations; no old coach-code enrollment, payments, household schema or unrelated owner routes.

## Rollout and rollback

Publish to the fork for exact-head peer review. The additive history RPC migration must precede its frontend; verify role/consent boundaries and a synthetic parent journey in the target environment only after separate production approval. H0 household contract review, other owners' implementation, real email/Storage verification and coach-departure ownership fixes remain open. Roll back the frontend if necessary; leave unused additive read RPCs until a reviewed cleanup. Never weaken backend authorization as a rollback.

## Evidence

Pending fresh integration checks. Earlier branch results are provenance only and are not counted as verification of this composition.
