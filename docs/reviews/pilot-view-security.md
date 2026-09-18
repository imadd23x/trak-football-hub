# Operational view access review

Status: implemented and verified in disposable databases on September 18, 2026. Not deployed. This isolated branch starts from canonical `ff9d713` with fork deployment guards; it does not depend on the parent invitation or academy-access migrations.

## Problem and scope

The operational report views were created with owner privileges. Their comments describe service-role/SQL-editor use, but no migration restricted their grants. Under the legacy public-schema grants modeled by the test bootstrap, anonymous and authenticated callers can query the views despite base-table RLS. Two reports, `pilot_time_to_assess` and `pilot_rating_agreement`, are automatically updatable: unrelated callers can update or delete another coach's telemetry through them.

A preceding disposable replay confirmed both anonymous and unrelated authenticated callers could read zero rows from the other coach's base telemetry table, yet read and update/delete that coach's rows through both views. All eight attempted mutations succeeded and were independently checked as the owner, then rolled back. This is executable evidence in a disposable database; it does not claim any production mutation or real-record access occurred.

Current frontend and Edge Function source has no consumers of these views or the two SQL conversion functions. Existing consumers are founder reports in [the pilot runbook](../pilot-runbook.md) and SQL rehearsal checks. An application's `club` role is not the database `service_role` and must not gain access to global operational reports.

Tarek's review identified two legacy script references. `check-pilot-state.mjs`
formerly probed `pilot_scorecard` and `pilot_activation` anonymously and treated
permission errors as proof of presence; it now explicitly skips restricted reports
and directs operators to the authorized SQL workflow. `seed-pilot-rehearsal.mjs`
only prints a scorecard query, without executing it; its output now identifies the
required operator/service role. Both Markdown and HTML runbooks document that same
boundary for weekly, drill-down and duplicate checks, including S3 evidence.
Neither script receives service credentials. This compatibility adjustment does
not depend on the separate S2 replacement, which retires the legacy scripts.

A read-only live metadata check on September 18 confirmed owner-privilege mode and anonymous/authenticated SELECT grants on all 12 views; the ten `pilot_%` views also reported UPDATE/DELETE grants. No real report rows were read and no live mutations were attempted. Disposable fixtures reproduce the resulting bypass; live data exposure was not probed.

## Forward repair

Migration `20260918070209_restrict_pilot_operational_views.sql` applies to exactly these reports:

| Metric/report | Views |
| --- | --- |
| Activation and match coverage | `pilot_activation`, `pilot_match_coverage` |
| Assessment rate and timing | `pilot_assessment_rate`, `pilot_time_to_assess` |
| Rating agreement | `pilot_rating_agreement`, `pilot_rating_agreement_derived` |
| Usage and retention | `pilot_weekly_active`, `pilot_retention` |
| Safeguarding and weekly rollup | `pilot_safeguarding_checks`, `pilot_scorecard` |
| Roster and consent review | `squad_duplicate_candidates`, `stale_pending_consent` |

Every view uses `security_invoker=true`. All privileges are revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`; only SELECT is then granted to `service_role`. PostgreSQL table-level revocation also removes the corresponding column privileges; the tests seed explicit column grants and verify both table and column queries are denied. Report definitions and underlying table policies are unchanged.

Missing views intentionally fail the migration. All 12 are required by earlier
migrations and were present in the September 18 metadata check. Silently skipping
one would hide schema drift and leave an incomplete reporting contract. Investigate
and repair a missing prerequisite through the reviewed release process; do not add
blanket existence guards or weaken the access checks to keep deployment green.

`band_ordinal(text)` and `score_to_band(numeric)` remain pure invoker functions; their search paths are pinned to `pg_catalog`. Existing conversion behavior is preserved. This change does not repair consent policy, academy provenance, metric definitions or the accuracy of the pilot cohort.

## Regression evidence

The runner seeds legacy column grants immediately before the repair, including grants inherited through `PUBLIC` and service-role write grants. The test suite creates only synthetic identities and records, requires the disposable-database marker, and rolls back its transaction. Unexpected successful writes are rolled back inside the denial helper so the old baseline can report every violation safely.

```sh
npm run test:db:pilot-views
node scripts/test-db.mjs --pilot-views-baseline
```

- Isolated repair: **58 migrations, 282 assertions passed** on PostgreSQL 18.3 through PGlite 0.5.8, without P1 or academy-access changes.
- Historical negative control: **57 migrations, exit 1, 246 failing assertions**. Failures include actual foreign telemetry INSERT/UPDATE/DELETE attempts and anonymous/application report queries. A baseline unexpectedly passing is also an error.
- Combined integration: all **60 migrations** and parent, academy, operational-view and deletion suites passed on private PostgreSQL 17.11. The Supabase CLI security advisor then returned **No issues found**, exit 0. This includes the same repair plus separate P1/academy migrations; it is local evidence, not a production advisor result.
- Coverage includes anonymous, coach, player, parent and club-administrator callers; direct SELECT denial on all 12 views; explicit column SELECT denial; absent table/column privileges; actual foreign telemetry UPDATE/DELETE denial through both writable views and INSERT denial through `pilot_time_to_assess`; exact preservation of base records; service-role SELECT-only access; and full JSON result equality between service and owner reads for all 12 nonempty reports.
- Node syntax, focused runner ESLint and `git diff --check` passed.

The full report comparison verifies useful service access, rather than treating an empty result as success. The suite uses real database role switching and SQL enforcement; it does not mock authorization or assert SQL text as a substitute for access checks.

## Release and recovery

Root integration must run `pilot_view_backfill_setup.sql` immediately before the new migration and `pilot_view_security.sql` after migrations, before any committed account-deletion fixture. Repeat native PostgreSQL 17 replay and the unchanged security advisor gate; do not suppress findings. Review/merge through the fork-first release process, then verify deployed grants and synthetic role behavior with the approved release workflow.

If an unexpected operational consumer loses access, keep the application denial in place and repair its narrowly scoped service-role access in a reviewed forward migration. Do not restore the owner-privilege/application-grant combination. Never provide service credentials to the browser to work around a denied report.
