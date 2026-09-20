# PR #66 — current-head scorecard review

Reviewed September 20, 2026, using native PostgreSQL 17.11 and synthetic data only. Exact PR head: `404e729a1f7cae728e14e61ba4424fb96b7c9ef9`. Main: `4335e8984777b7b704e8706d3fe277352658c9ed`. No remote database/Auth access, peer-branch edits, production deployment or merge approval.

## Result

**The earlier unpublished positive-fixture problem is fixed.** The current suite's 22 assertions pass against four histories. A separate regression gap remains: the newly added D0b assertion passes when the published-only filter is deliberately removed. Request a focused test correction from Tarek, the suite owner, before treating the published-only rule as protected.

| Native replay | Migrations | Current suite |
|---|---:|---|
| #66 standalone | 65 | 22/22 pass |
| #66 + #44 `8e72e80`, fresh | 74 | 22/22 pass |
| Released main first, then pending #44, upgrade | 74 | 22/22 pass |
| #44 + #74 `c910829` + #76 `252b486` | 77 | 22/22 pass |

Every overlapping migration was required to have identical content. Replays use the real application migrations and repository Auth/Storage SQL boundary fixture. These are database metric tests, not hosted Auth, browser, load or email verification.

## Finding: D0b disables itself when publication filtering regresses

Location: `supabase/tests/pilot_scope.sql`, D0b, lines 184–191 at the reviewed head.

The assertion is structurally:

```sql
pg_get_viewdef('public.pilot_match_coverage'::regclass) NOT ILIKE '%published%'
OR NOT EXISTS (... unpublished fixture ...)
```

On the #44 integration schema, remove only `AND e.published` from `20260919160000_split_match_coverage_by_logger.sql` and replay that view definition locally. The `logged_by_player` / `logged_by_coach` columns, every other view clause and the entire test suite remain unchanged.

Observed results:

| Case | Published fixture rows | Unpublished fixture rows | Test result |
|---|---:|---:|---|
| Normal #44 view | 1 | 0 | 22/22 pass |
| Published filter removed | 1 | 1 | **22/22 pass — regression missed** |
| Academy filter removed independently | — | — | 7/22 fail, including B1/B2/B4/B5/B6/C1/D1 |

The academy mutation is a useful negative control: failures are surfaced by the actual runner. The publication failure is in the test predicate, not a suppressed process error. This does not show that #44 currently counts drafts; its unmodified implementation excludes the decoy correctly.

Preferred correction after #44 is part of the integration base: assert unconditionally that the unpublished fixture is absent. If backward compatibility with pre-#44 schemas must remain, select the expected contract using an independent version marker. As a local proposal, using the presence of the appended `logged_by_coach` column (which survives the filter-removal mutation) makes the baseline pass and D0b fail under that mutation. Tarek owns the final approach and patch; no change to his suite is committed here.

## Coverage limit: D2/D3 do not verify counts or isolation

`pilot_assessment_rate` and `pilot_rating_agreement_derived` each have **zero rows** in the current fixture. D2/D3 assert `count(*) >= 0`, which every successful COUNT satisfies. Their descriptions correctly say the views evaluate, but those checks cannot establish cohort filtering, correct assessment selection, computed agreement, or the denominator.

Add actual matches and assessments for both academies, assert the intended positive rows and exact values, then assert foreign rows are excluded. Include positive controls before denial assertions and demonstrate filter-removal mutations fail. This is requested work for Tarek's T-V scorecard package, not a claim of a new application defect established by these empty fixtures.

## Dependency integration remains necessary

Current #42 `918d8c3` is not an ancestor of #66 `404e729`. Comparing them shows #66 carries an older runner, lacks main's migration filename validator/revocation migration and differs in birthday coverage. That is branch ancestry, not proof a normal Git merge will delete newer files. Do not use whole-file replacement from #66 to resolve conflicts. Integrate onto the current #42/main and preserve the newer validator, mutable migration list/upgrade replay and birthday checks. Review the resulting merge delta rather than assuming all inherited changes belong to the scorecard fix.

PR #66's description still says thirteen assertions; the current suite has 22. Refresh the description with the final integration base and actual scope when updating the test.

## Reproduce

From a clone with the five pinned commits, run:

```sh
python3 docs/reviews/pr66-native-review.py
```

The script uses `/opt/homebrew/opt/postgresql@17/bin`, creates its own temporary database cluster on a free loopback port, refuses an already-bootstrapped database, validates shared migration bytes, and stops the cluster in `finally`. It never reads deployment URLs or credentials. A nonzero script result means the observed baseline/mutation expectations changed; inspect the output rather than treating it as an application release gate.

The review script intentionally **expects the known publication mutation to survive** so it can reproduce this finding. It is evidence for this exact head, not a replacement production regression suite. Replace that expectation only after reviewing the owner's corrected suite; do not treat this reproducer's exit zero as proof publication filtering is protected.
