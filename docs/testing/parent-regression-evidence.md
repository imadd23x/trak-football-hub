# Parent work: verification evidence and limits

Snapshot: September 18, 2026. Integration includes upstream `7668340`, secure parent invitations, P5 account lifecycle, P3 family screens and fork deployment guards. This is an engineering snapshot, not pilot approval.

## Reproducible checks

- `npm test`: 234 source assertions pass at this snapshot.
- `npm run test:harness`: 17 harness assertions pass, including token-bound mock Auth identities.
- `npm run test:db`: all 54 migrations replay in disposable PostgreSQL and parent-invitation permission, expiry, backfill and idempotency cases pass.
- `npm run test:db -- --baseline`: negative control fails on unauthorized foreign-email linking in the historical schema.
- `npm run typecheck` and `npm run build`: pass.
- `npm run lint`: zero errors, 134 warnings remain.
- `npm run uc:check`: two enforced use cases pass; five pre-existing pending assertions still fail. Exit success is not full use-case coverage.
- `npm run test:browser`: four production-bundle browser scenarios pass: multiple-child navigation and failed-load retry; anonymous invitation privacy; wrong-player logout to existing-parent password login and exact-child acceptance; safe expired/foreign-link states. These use the real router/AuthProvider/SDK and synthetic intercepted backend responses. Unknown external requests are blocked and fail the tests. Run `npx playwright install chromium` first; `PW_CHROMIUM_EXECUTABLE` may point to a locally installed compatible Chromium.

The fork CI branches run checks without deployment. Release-gate tests evaluate the actual workflow conditions for upstream/fork, failed tests/backend, missing credentials and PR previews. The source and SQL tests are versioned beside the fixes; no live database or email is required to repeat them.

## Known limits and release blockers

The SQL harness runs PostgreSQL 18.3 via PGlite 0.5.8; production uses PostgreSQL 17. It does not verify real Auth emails, PostgREST JWT handling, multiple independent database connections, latency under load or physical phones. Browser interception proves UI behavior, not backend authorization. The edge handler is tested separately from its Deno adapter.

P5 serializes the application provider's password signup/sign-in/logout operations. Direct SDK calls, automatic OTP/recovery and cross-tab races need further coverage. Invitation uncertainty state survives route changes but not a full restart; no exactly-once email guarantee is claimed.

K1/K2 follow-up denial cases remain unresolved in the coach-departure review suite. Under-18 consent gates, private/shared coach feedback, legal documents, demo fixtures, all-role live acceptance and load/recovery checks also remain open. Passing parent checks does not establish pilot readiness.
