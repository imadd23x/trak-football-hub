# Parent invitation security release

This change closes email-based arbitrary child claiming and direct invite/link writes. It adds seven-day invitations, explicit token rotation, verified-recipient acceptance, and matching parent/player recovery screens. It does not establish legal guardianship, change consent ages, or complete the pilot consent gate.

## Dependencies and rollout

Integrate P5's captured-account onboarding and serialized sign-in/sign-out before releasing the invitation UI. P3 provides multiple-child navigation. Commit and run regressions in Imad's fork before an upstream PR; Kostas or Tarek reviews and Imad coordinates the merge. Do not apply this migration or function through the live SQL editor or MCP.

The upstream deployment workflow must pass tests, apply `20260917205027_secure_parent_invites.sql`, deploy `send-parent-invite`, and only then deploy the frontend. Existing browser tabs may need a reload: anonymous token lookup is intentionally closed. Never restore that public lookup or unrestricted linking as a rollback. If deployment is interrupted, hold new invitations and complete the forward fix using the reviewed commit.

Existing accepted links are preserved. Old pending invitations expire from their original creation date; a missing creation date expires immediately. Players renew through an explicit resend, on either Home or Profile. A send failure can occur after rotation, so the UI re-reads the invitation and blocks an unconfirmed old token. The local uncertainty marker survives route changes but not a full browser restart; the server remains authoritative for validity.

## Persistent regression coverage

| Check | What it proves |
| --- | --- |
| `npm run test:db` | Replays actual migrations in disposable PostgreSQL, then tests roles, stored verified email, wrong recipients, direct table/column write denials, token privacy, expiry/backfill, two children, repeated acceptance, resend and recycled email |
| `npm run test:db -- --baseline` | Negative control: the original foreign-email claim must fail the security assertions |
| `npm test` | Parent invitation recovery, wrong accounts, existing-account preservation, player expiry/resend/create recovery, edge authentication and delivery decisions |
| `npm run test:browser` | Production bundle and real app providers/SDK: public-link privacy, wrong-account sign-out and existing-parent sign-in, selected-child acceptance, expired/foreign-link handling; HTTP responses are intercepted |
| `npm run typecheck` and `npm run build` | Frontend type and production-build compatibility |

The database and source regressions run in CI. PGlite 0.5.8 uses PostgreSQL 18.3; production currently uses PostgreSQL 17. The harness does not replace Supabase Auth/PostgREST, independent simultaneous connections, email delivery or actual phone tests. Handler tests execute the request logic, not the Deno deployment adapter.

Before pilot approval, verify the deployed build and migrations; use synthetic accounts for wrong-recipient, two-child, expired-link, resend/email failure and shared-phone checks. Check email redirects on the actual pilot domain. Test separate simultaneous clients and academy isolation. Audit historical parent links separately: this migration deliberately does not infer which existing links should be deleted.

## Isolated review evidence — September 18

The review branch is built from canonical `ff9d713` plus S4 fork guards, the required P5 serialized-auth follow-up, and P1/P7 fixes. It excludes unrelated parent Settings and academy-access changes. Local checks passed: 238 source tests, 17 harness tests, all 58 migrations with parent/backfill SQL assertions, typecheck, build, and three intercepted production-bundle browser scenarios. Lint reports 0 errors and 135 existing warnings. The use-case gate passes its two enforced cases while reporting four existing pending failures (three obsolete player-log assertions and one player match-history failure-state assertion).

The browser tests started only a local preview and intercepted all backend calls; no real email, Auth account or shared database was modified. This review still requires Kostas/Tarek approval, deployment and live device/email evidence.
