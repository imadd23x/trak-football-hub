# Hosted test and rehearsal target boundary

The approved dedicated hosted project is `trak-football-test`, reference
`vklpncpwenulmjilnxuj`, in `eu-central-1`. Creation is confirmed; schema/Auth
configuration and hosted acceptance remain separate work. Do not substitute
production while that setup is pending. Neither seed reads `.env` or falls
back to `VITE_SUPABASE_*`. Existing database runners use isolated local clusters;
the two seed CLIs below can write to a hosted project and therefore require an
explicit target before reading passwords or constructing a Supabase client.

## Isolated test mode

For `node seed-admin-data.mjs` and `node seed-pilot-rehearsal.mjs`, supply all of:

| Environment variable | Required value |
| --- | --- |
| `TRAK_TEST_PROJECT_REF` | `vklpncpwenulmjilnxuj` |
| `TRAK_TEST_SUPABASE_URL` | `https://vklpncpwenulmjilnxuj.supabase.co` (optional trailing slash only) |
| `TRAK_TEST_PUBLISHABLE_KEY` | That project's publishable key or legacy `anon` key |

Supply the existing password variables securely in the process environment:
`TRAK_DEV_OLD_PASSWORD`/`TRAK_DEV_PASSWORD` for the admin seed, or
`TRAK_REHEARSAL_PASSWORD` (16+ characters) for rehearsal. Never commit them or
pass them as CLI arguments. No credential is included here. The different
reference in the regression fixture is synthetic and is never called.

The guard rejects the known production reference `xbykbqolvqyqmipikuae`, even if
the URL and key are supplied explicitly. It rejects missing/whitespace values,
mismatched references, URL credentials, paths, queries, fragments, ports and
non-HTTPS/custom hosts. `sb_secret_*` and legacy `service_role` keys are rejected.
Legacy JWT claims must declare role `anon` and the selected project reference.
Publishable-key syntax and decoded JWT claims are local validation, not
cryptographic authentication or proof that a key belongs to the chosen project;
the hosted service performs that verification. The operator must approve the
test reference independently. A non-production reference alone is not proof
that the project contains only synthetic data.

Future Auth activation/recovery or hosted integration executables must call
`requireTestTarget(process.env)` from
`scripts/testing/supabase-test-target.mjs` before reading credentials, creating a
client or requesting network access. Do not use the rehearsal-only wrapper in
test runners. Do not copy production user data or credentials into test fixtures.

## Separate production rehearsal operator action

The existing synthetic rehearsal on production is preserved as a distinct,
explicit operator action, only for `seed-pilot-rehearsal.mjs`:

```sh
node seed-pilot-rehearsal.mjs --production-rehearsal=xbykbqolvqyqmipikuae
```

It requires `TRAK_REHEARSAL_PUBLISHABLE_KEY` (production publishable or matching
legacy `anon` key) and `TRAK_REHEARSAL_PASSWORD`. Test-project variables must be
absent; app/Vite environment values cannot opt into this mode. A secret or
service-role key is never accepted. This mode retains the seed's normal RLS and
synthetic-account behavior; it does not bypass Auth, consent or ownership checks.

This is a production write action: obtain the authorized operator's approval
for the specific rehearsal run before executing it. The flag is not itself
authorization. Never run this mode from CI, test scripts or a retry wrapper.
The presence of any `CI`, `CONTINUOUS_INTEGRATION`, `VITEST`,
`VITEST_WORKER_ID`, `PLAYWRIGHT_TEST`, `TEST_WORKER_INDEX`, `NODE_TEST_CONTEXT`,
or `NODE_ENV=test` blocks this mode. Values such as `CI=false`, `CI=0` and an
empty marker still block it. These markers are defense against accidents, not
a security boundary against an operator deliberately removing them.

`--purge` retains the selected target's existing deletion behavior and requires
separate authorization for that destructive action. It does not relax target
selection. For production it must accompany the exact production-rehearsal flag.
The admin seed has no production exception or CLI target override.

## Verification and limits

`src/__tests__/test-target-guards.test.ts` launches the actual CLI modules inside
fresh subprocess VMs with the real target guard. Invalid configurations must
exit before password reads, `.env` reads, client construction or network. For
valid configurations the SDK stub stops at the `createClient` boundary, before
any Auth/write operation; a positive operator test never connects to production.
The existing 17 rehearsal scenarios load the real guard and remain entirely
synthetic. Run these with the consent mirror and credential guard:

```sh
npx vitest run src/__tests__/test-target-guards.test.ts src/lib/__tests__/rehearsal-seed.test.ts src/lib/__tests__/seed-consent-mirror.test.ts src/__tests__/no-committed-credentials.test.ts
```

This patch guards these two CLIs and provides the reusable test entrypoint
contract. It does not provision the hosted test project, validate hosted Auth
settings, deploy anything or prove activation/recovery end to end. The legacy
`playwright.config.ts`/`e2e/smoke.spec.ts` development-server path still has no
global hosted-network deny rule. Its current tests exercise invalid sign-in and
forms, but adding successful Auth/recovery tests there requires a separate
explicit target/network boundary first. Existing fixture browser suites and
local database tests are not a substitute for hosted Auth verification.

Roll out this code before configuring/running hosted tests. For a rejected
configuration, correct the explicitly approved test target or stop the run;
never restore a production default as a workaround. A code rollback would
remove the guard, so suspend hosted seed/test runs until a forward fix is
verified if this implementation needs repair.

Sources checked on 2026-09-21: Supabase's
[environment separation guidance](https://supabase.com/docs/guides/deployment/managing-environments)
and [deployment guidance](https://supabase.com/docs/guides/deployment).
The installed client remains unchanged. The Supabase changelog was checked;
no relevant breaking change affected this explicit hosted API-root selection.
