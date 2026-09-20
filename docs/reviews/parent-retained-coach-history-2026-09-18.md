# P3 retained coach history — 2026-09-18

Base: canonical `00910940f596d9fe9a7cd416dc741943d1df2cc9`; branch `parent/P3-retained-coach-history`.

## Failure and focused repair

Coach deletion deliberately retains assessments and awards with `coach_user_id = NULL` (`20260608000002_assessment_data_continuity.sql`; `20260901000008_drop_player_goals_and_fix_deletion.sql`). The generated TypeScript author fields still say `string`.

`fetchParentDevelopment` previously included those null authors in a profiles UUID lookup. The installed Supabase SDK serializes this as `user_id=in.(null)` (or a mixed UUID/null list). The resulting name-query failure prevents both Home and Alerts from displaying the child's otherwise valid history. Retrying repeats the invalid lookup.

The repair makes the two parent projections explicitly nullable and filters null IDs **only from the name lookup**. Assessment/award arrays, explicit field allowlists, private-note exclusion and genuine query-error handling are unchanged. Home and Alerts use the existing neutral “Coach” fallback for absent authors or RLS-hidden names. No snapshot-name policy is invented.

## Executed evidence

The new `src/pages/parent/__tests__/parent-retained-history.test.tsx` runs actual parent components, routes/RouteGuard, AuthProvider, ParentChildrenProvider and Supabase SDK against strict synthetic HTTP fixtures. It does not mock `useAuth`, parent-data or query hooks.

- Before the application repair: **2 failures / 4 controls pass**. Mixed and all-null history failed; visible/hidden live-name, genuine-error/retry and delayed-child-response controls passed.
- After the repair: **6/6 pass**. Mixed/all-null cases preserve every assessment and award in cache and Alerts, retain Home's latest assessment/award, deduplicate live coach lookups, omit name requests when all authors are null, and survive A→B→A child switching. Late A enrichment cannot replace B's coach/data.
- The fixture rejects UUID filters containing literal `null` with `22P02`; an independent memory-only PostgreSQL read control confirmed `'null'::uuid` fails with that code while a valid UUID succeeds. No hosted PostgREST or deletion operation was executed.

| Command | Result |
| --- | --- |
| `npx vitest run src/pages/parent/__tests__/parent-retained-history.test.tsx src/pages/parent/__tests__/parent-family.test.tsx` | 23/23 pass |
| `npm test` | 326/326 pass, 30 files |
| `npm run test:harness` | 17/17 pass |
| `npm run typecheck` | Pass |
| `npm run lint` | 0 errors, 136 warnings |
| `npm run build` | Pass; existing large-bundle warning |
| `npm run uc:check` | Exit 0; 2 enforced pass; pending UC-A02 has 3 failures, 10 other use-case tests pass; 15 pending without tests |

Logs: `/private/tmp/trak-retained-history-{red,focused,source,types,lint,build,harness,usecases}.log`.

## Limits and release

This is a P3 client fix, not a consent-policy or retention change. No schema, authentication, snapshot attribution, private-note projection or parked consent-test work changed. Hosted RLS, actual account deletion and browser/device behavior were not newly verified. Independent review and normal release gates remain necessary before production. Rollback is a frontend commit revert; no database rollback is involved. The same loader in pending parent-history/consent-recovery branches needs to preserve this fix when integrated.
