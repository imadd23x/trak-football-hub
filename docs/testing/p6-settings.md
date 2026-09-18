# P6: settings represent implemented behavior

The removed notification switches only wrote `trak.settings.v1` to browser storage. No delivery path read those values. The passport visibility selector used the same storage and did not change database access. Leaving either control visible promised behavior that did not exist.

## Acceptance and scope

- No role sees the ineffective switches or passport visibility selector, including browsers with old saved values.
- Account actions and real role-specific settings remain available. A failed name save retains its draft and can be retried; password recovery targets the signed-in account.
- The parent profile links to “Account settings” and both linked children remain visible after navigation.
- No new notification or sharing behavior, schema changes, or migration of obsolete browser values.
- Account deletion explains that some academy history and consent records may remain, matching the observed implementation instead of promising complete erasure. Cancelling sends no deletion request. Retention policy and cleanup remain separate U10/P8 work.

## Evidence

September 18, 2026, integration base `a7d96b9` plus this change:

- `npm test`: 245 assertions passed, including six new Settings regressions and existing sign-out/family tests.
- `npm run typecheck`: passed.
- ESLint on changed source/test files: zero errors; three existing `any` warnings in Settings remain.
- `npm run test:browser`: production build and four intercepted browser scenarios passed. Parent Settings verified at 390×844; screenshot inspection showed both children and account controls without the ineffective settings sections.
- Separate integration parent SQL suite: 58 migrations replayed and invitation assertions passed. P6 itself changes no SQL.

The browser tests use synthetic intercepted backend responses. This is not live email, production deployment, physical-phone, or full account-deletion verification. Branch-specific CI and independent human review are still required before upstream merge.

The isolated upstream-review branch starts from `ff9d713` and includes the S4 fork guards plus this P6 fix. Its source suite passes 171 assertions and its harness passes 17; typecheck and production build pass. Full lint has zero errors and 140 existing warnings. `uc:check` passes its two enforced use cases but reports four pending failures: three obsolete player match-logging assertions and one player-history failed-load assertion. These are separate Tarek-owned paths, not a claim of a fully passing application. The larger integration/browser result above is recorded separately because that branch also contains parent-security follow-ups.

## Release and recovery

Ship through a reviewed fork PR. No backend rollout is needed. Verify the deployed Settings route and parent profile link after release. If an unrelated account action regresses, fix it or restore the compatible account implementation while keeping ineffective controls hidden; restoring those controls would reintroduce misleading privacy promises.
