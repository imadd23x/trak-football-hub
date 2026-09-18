# Public-view test inventory — September 18, 2026

Kostas identified that the PR35 reporting suite only enumerated its 12 known
views. An additional report could inherit broad privileges while CI continued
to pass. This test-only change closes that coverage gap; it changes no migration,
application behavior, grant or live database.

Prepared on fork branch `shared/S4-report-inventory`, based on release-repair
candidate `cae7471` and canonical main `b9adf1c`. Preserve that release candidate
and obtain review before integrating this additional test change.

## Reproduction and repair

In a disposable database with the 59 real migrations, the unchanged suite passed
all **282 assertions** despite three extra public objects: a `pilot_*` view,
an unprefixed view and a materialized view. Actual `anon` reads returned one
synthetic row from each. This demonstrates a test-coverage gap; those objects
were never added to the shared project.

The suite now queries `pg_catalog.pg_class`/`pg_namespace` for **all ordinary and
materialized public views** and fails early if an object lacks an executable
access contract. It uses neither a naming convention nor a fixed total. Repeating
the same external mutation fails with all three qualified names in the diagnostic.

All existing public views currently belong to the operator-report contract. This
does not decree that every future view must be operator-only. A new client-facing
view requires an explicitly reviewed contract with its own actual-role tests;
excluding it from the inventory or merely adding its name is not a valid repair.
Views outside `public` are outside this inventory's stated scope.

Four persistent negative controls are included in the ordinary SQL suite. They
inject prefixed, unprefixed, materialized and quoted-name objects and require the
exact inventory error identifying the object. Each deliberate error rolls back
its DDL subtransaction. Unexpected SQL errors remain failures. The existing
permission tests still require populated fixtures and exercise real database roles.

## Verification

```sh
node scripts/test-db.mjs
node scripts/test-db.mjs --parent-upgrade-review
```

Both fresh-install order and deployed-report-first/parent-upgrade order replay
**59 migrations**, pass the parent invitation suite and pass **287 operational
view assertions** (the previous 282 plus inventory coverage and four mutation
controls). Tested on pinned PGlite 0.5.8 / PostgreSQL 18.3, the same in-memory
runtime used by CI. The injected-exposure negative control changes from exit 0
before the repair to exit 1 after it. Whitespace checks and independent source
review pass.

No native concurrency, live Auth, HTTP authorization, schema deployment or
credential rotation is claimed by this test-only change. Existing parent,
feedback and calendar release gates remain separate. Rollback means reverting
this test/documentation commit; it requires no data or schema rollback.
