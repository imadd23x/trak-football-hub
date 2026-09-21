# Academy dashboard recovery — 21 September 2026

Base: canonical main `9114f4c`. Scope: academy Overview and Squads pages, their count header and routed regression coverage. No database, AuthContext, shared client or deployment changes.

## Reproduced behavior

The initial routed suite failed six cases against unchanged main, with two controls passing. A failed coach/roster request displayed an empty academy. Missing and all-zero assessments appeared Steady, zero scores were discarded from mixed averages, and Overview selected an older assessment when the response arrived oldest first.

## Acceptance and implementation

- Each required query failure produces an accessible error and Retry action. Pending/failed totals remain unknown rather than displaying zero.
- Retry recovers the page after the request succeeds.
- Account changes hide previous account state immediately and cancel in-flight loads; late success or failure cannot replace the new account's page.
- Both pages request assessments newest first, with an ID tie-breaker. Zero values participate in averages; missing scores do not invent an assessment band.
- Empty rosters avoid an unnecessary assessment query. Existing Overview band categories and page design remain unchanged.

The 23 tests render the actual App, auth provider, router and Supabase client with intercepted HTTP responses. They cover each required query stage, error recovery, late responses across account changes, zero values, missing data and ordering. The baseline failures were observed before implementation.

## Verification

- Focused routed tests: 23 passed; independent second-agent review reran all 23 successfully and found no actionable issues. This is not the required non-author human review.
- Typecheck, full lint and production build passed. Existing large-chunk build warning remains; the bundle budget check is separate.
- Isolated Chromium at 390px: both pages show the error, recover via keyboard Enter on Retry, avoid horizontal overflow and produce no page errors or unexpected external requests. Retry measures 91 × 44px.
- Screenshots: `/private/tmp/trak-academy-mobile-evidence/`; reproducible check script: `/private/tmp/trak-academy-mobile-check.mjs`.

All 20 current CI checks passed, including native PostgreSQL, database histories/convergence, query plans, bundle budget and 10 browser cases. Results: `/private/tmp/trak-pilot-evidence-20260921/academy-final/results.json`. The source suite passed 693 tests with nine skipped.

## Release and limits

Obtain a non-author review under `docs/release/merge-gate.md`, then explicit authorization before merging to the production-deploying main branch. After deployment, verify both routes with the synthetic academy account, including reload, recovery and account switching. A previous compatible frontend is the rollback path.

Mocked requests and a desktop browser viewport do not establish hosted RLS behavior, completeness above API row limits, physical-phone behavior or concurrent-user capacity. Other academy pages and the new academy/staff onboarding flow remain separate work.
