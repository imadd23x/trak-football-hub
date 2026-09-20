# PR #76 review — hold at 252b486

Reviewed `252b4869cd0adca45ab94c117d208cc3e1d3d9ce`, September 20, 2026. No changes to Kostas's branch or production. This review covers the match-validation delta and its database composition, not the complete pilot or every coach-session failure mode.

## Required correction: reuse #51's rating keys

`CoachAddSession.tsx` now permits exact goals above two, but its changed `goalsKey()` still returns `2+` for every position once goals reach two. The comment describing a universal `0 | 1 | 2+` engine contract is false: the attacker branch of `rating-engine.ts` reads `1`, `2`, `3+`; only the midfielder goal scale caps at `2+`.

Executed the actual TypeScript helper extracted from the page's AST, and the unchanged engine, for an attacker in a 4–0 league/home win, 90 minutes, no card, good condition, average self-rating, no assists:

| Exact goals | Current form key | Current score | Existing engine key | Correct score |
|---|---|---|---|---|
| 0 | `0` | 6.90 | `0` | 6.90 |
| 1 | `1` | 7.25 | `1` | 7.25 |
| 2 | `2+` | 6.90 | `2` | 7.45 |
| 3 | `2+` | 6.90 | `3+` | 7.65 |
| 4 | `2+` | 6.90 | `3+` | 7.65 |

This mismatch pre-exists on main and is already fixed in Tarek's #51 at `5beba3b67582459d35b55564b07517fa172a2138`. #76's newly extended count controls retain it for every larger count. Integrate `src/lib/match-input-keys.ts` and its engine-contract tests with the form. Store exact counts and derive the appropriate goal/assist keys only for the engine. Do not change rating weights. Extend the shared contract test range to the agreed form ceiling, and add a rendered write-path assertion for an attacker with two/three goals; the 39 pure validator tests pass without detecting this mismatch.

## Native database verification and fixture handoff

Using PostgreSQL 17.11 on loopback in disposable databases:

- #76 alone: 67 immutable migrations, four suites pass (`parent_invite_security`, `pilot_view_security`, `privilege_and_consent_security`, `match_stat_rules`). Its new suite has 17 assertions.
- Compose #44 `8e72e80ac87b39670fa20c6dcf4e70b76bbadb69`, #74 `c910829a088c0debaaf15c61ad897b1a77f00f84` and #76 `252b486`: identical shared migration bytes, 77 migrations replay successfully. Seven of the original nine suites pass; the following two fail during fixture setup.
- Correct only those fixtures in memory and add #42 `918d8c3a250d0a5728aa60fc07430a9543b43f1c`'s academy-isolation suite: all ten suites pass. No constraint, trigger, grant, policy or application function was weakened. Both disposable servers were stopped.

### Export fixture: supply a plausible match

#44's `supabase/tests/account_export.sql:69` inserts a goal/assist but omits minutes and team score, both defaulting to zero. #76 correctly rejects that row. Add `minutes_played, team_score` to the fixture column list and `90, 2` to each synthetic match's values. Keep both distinct children/opponents and every ownership/private-note canary assertion.

### Privacy fixture: clear the simulated actor for maintenance setup

#44's `supabase/tests/coach_notes_privacy.sql` uses `RESET ROLE` before privileged fixture construction, but that does not clear `request.jwt.claims`. The previous coach identity therefore remains active when the test inserts an academy, moves staff membership or inserts another coach. #74 deliberately refuses those actor-bearing writes. For these maintenance blocks, use:

```sql
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
```

The following authenticated test blocks must continue to set the actual role and test identity. The local correction clears claims after the fixture's `RESET ROLE` statements; all privacy assertions still pass. Do not add a production bypass or rely on `SECURITY DEFINER` to ignore the actor.

Kostas owns these two fixture corrections. Request that they land with the appropriate PR composition; they have not been committed to his source by this review. Keep the export correction coupled to #76 and the privacy correction to #74 integration if #44 is otherwise held frozen.

## Remaining evidence limits

The six new CHECK constraints intentionally remain `NOT VALID`; new writes are checked, but existing rows have not been certified or corrected. Native replay does not replace production data review, Auth/REST integration or preview deployment. The reported Supabase preview-slot exhaustion remains a separate operational issue; no preview branches were deleted here.

#76's pure validator suite: 39 passed. The existing session-save path still ignores per-player RPC/attendance errors and can report success after a partial failure; that is pre-existing K-C work, not a new issue introduced by this delta. Current form minutes still step in 15-minute increments; one/five-minute substitute acceptance is verified at validator/RPC level, not selectable through that control. Do not mark all of UT-12 or the session reliability package complete from this PR.

Confirm a single shared count/range contract with Tarek: #51 currently offers 0–6, the earlier testing plan said 0–10, and #76 proposes 0–20 with a contribution/time heuristic. The heuristic is a product validation rule, not a mathematical impossibility proof. Registry integration must use #42's discovery mechanism, preserving the suite pragma rather than adding a second runner.

## Reproduce the native findings

Use a local clone containing the exact commits above (fetch upstream PR heads 42/44/74/76 as needed) and PostgreSQL 17 binaries at `/opt/homebrew/opt/postgresql@17/bin`. From the clone directory run:

```sh
python3 /path/to/pr76-native-review.py
python3 /path/to/pr76-native-review.py --fixture-corrections
```

The [harness](pr76-native-review.py) creates only temporary local databases, verifies shared migration bytes match, asserts the two exact original fixture failures and requires all corrected suites to pass. Its `finally` block stops its temporary server. It never edits source, connects to a live database or removes an existing database. Adjust the local binary path in a disposable copy if PostgreSQL is installed elsewhere.
