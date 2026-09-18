# S2: repeatable synthetic demo data

## Scope and acceptance

Replace the two legacy seed scripts and their broad purge/duplicate cleanup instructions. They currently inherit the application target, use shared credentials, swallow failures and skip incomplete batches. The replacement defaults to a network-free plan, takes an explicit date, and applies only that versioned manifest to an explicitly confirmed destination. No schema changes, live writes, consent approvals, private notes, AI publication, telemetry or global pilot configuration are part of S2.

The manifest covers synthetic UAE and Greece academies, all four account roles, two-child parent navigation, distinct adult histories, an adult roster-adoption case with two assessments, and separate 17-year-old/missing-age pending cases without developmental content. Synthetic adult history is a demonstration fixture, not an exemption for real minors.

Acceptance: stable IDs/content; correct real-schema inserts; second apply makes no changes; interrupted application resumes per record; unexpected existing identity/content fails before writes; uncertain responses do not cause duplicate retries; unrelated records survive. Actual authenticated SQL must confirm two-child relationships, cross-academy isolation and adoption preserving the roster ID/history. Unit tests cover CLI target/credential boundaries. No test fabricates an Auth/email or deployed-UI result.

## Implementation and verification

1. Pure `scripts/demo/plan.mjs` defines accounts and ordered rows from an explicit date.
2. `apply.mjs` preflights all IDs, validates existing namespace/content, creates missing accounts then records, and verifies every result. It never updates/deletes existing data. Auth and REST calls are not one transaction; exact-ID resume is the recovery path.
3. `cli.mjs` defaults to plan mode. Apply requires an explicit URL, matching confirmation and a server key from a dedicated environment variable. It does not load `.env`. Generated passwords are persisted in a private ignored local file before account creation; the key is never persisted and neither is printed.
4. Run unit tests plus an in-memory replay of every migration using the real generated manifest. CI runs those checks with no service credentials. Independent review precedes any hosted rehearsal.

## Rollout and recovery

Commit to the fork, obtain Kostas/Tarek review, and merge through Imad. The tool is not invoked by deployment. A designated operator separately reviews the exact plan/date/target before a hosted apply; no hosted apply is performed as part of this implementation. Verify real Auth login, UI journeys and phones separately after that authorized operation.

Use one operator at a time. An uncertain or failed call exits nonzero; rerun the same date/target with the same private credentials file. Modified fixture rows cause a conflict rather than destructive repair. Preserve partial fixtures and investigate; there is deliberately no purge/reset command. Removing this tooling does not remove data. Any later data reset needs an exact manifest/dependency review, not a global name/duplicate query. Changing the date creates a different cohort and is not a retry.
