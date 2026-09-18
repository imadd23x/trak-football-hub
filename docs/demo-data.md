# Synthetic demonstration data

The legacy `seed-admin-data.mjs`, `seed-pilot-rehearsal.mjs`, `check-pilot-state.mjs` and broad duplicate cleanup instructions are retired. The scripts exit without contacting a service; the SQL file contains only a retirement notice. Do not run older revisions to seed or purge a shared project. Existing legacy accounts are untouched; retiring the scripts does not revoke their credentials.

## Preview and test

```sh
npm run demo:plan -- --as-of 2026-09-25
npm run test:demo
```

Planning is the default and performs no network or filesystem writes. The full manifest contains only synthetic names and reserved `.invalid` email addresses. The explicit date (2000-01-01 through 2100-12-31) determines its namespace, UUIDs and historical dates; repeat the same date to resume. Changing it creates another cohort. No `.env`, linked CLI project, ordinary application URL or saved Auth session is used.

The two academies represent UAE and Greece. Each has admin, coach, parent and player accounts; the parent links to an adult and a 17-year-old so navigation can show two distinct children. Adult records include different match/assessment histories, and an unclaimed adult roster row has exactly two assessments for adoption. Pending 17-year-old and missing-age roster cases have no development records. All data is visibly synthetic. The dataset contains no guardian approvals, private notes, AI publications or telemetry and does not change `pilot_config`.

Synthetic adult history does not verify the under-18 rule. Use the separate consent tests and admission gates. Shared feedback, AI approval, real invitations and telemetry require their own journeys. Adoption changes a fixture row, so a subsequent seed replay will report a content conflict rather than undo that action.

## Apply only after reviewing the exact destination

Application is a separate operator action; it is not part of CI, build or deployment. Review the manifest and target with the release owner first. Never put production server keys in the fork's secrets, a frontend environment variable, a CLI argument or chat.

Set `TRAK_DEMO_SERVICE_KEY` securely in the server-side shell environment. Use a secret/service-role key for the intended target. Then run, replacing both placeholder origins with the same reviewed origin:

```sh
npm run demo:apply -- --as-of 2026-09-25 \
  --url https://PROJECT_REF.supabase.co \
  --confirm-target https://PROJECT_REF.supabase.co
```

Local loopback Supabase origins are also accepted. Other hosts, credentials in URLs, non-root paths, HTTP hosted origins and mismatching confirmations are rejected. Requests have a 15-second timeout and do not follow redirects. This confirmation prevents accidental target selection; it does not establish permission to operate a shared project.

Before writing, the tool reads every planned Auth identity and row. Existing Auth identities must have the exact email and server-controlled manifest marker. Existing row content must match every planned field. A conflict or read error stops the run. Missing accounts are created with confirmed synthetic emails through the Admin API; this does not send or test email. Missing rows are inserted in dependency order and read back. The tool never updates/deletes rows, resets an existing password or changes email-confirmation settings.

Generated passwords are saved before account creation under `.local/trak-demo-seed/` in a target/namespace-specific file, mode 600, ignored by Git. The server key is never saved. The success report gives the file path and verified counts, never passwords. Keep this private file for demo logins and retries; do not commit or share it in Slack. A custom `--state-dir` must be kept private and outside version control.

## Interrupted runs and limits

Auth provisioning and REST inserts cannot share a transaction. On error, exit status is nonzero and a partial cohort may exist. Preserve the private credentials file and rerun the identical date/target after resolving the cause. Each existing record is verified separately, so a lost response or half-completed batch does not duplicate successful work. Missing credentials for existing accounts cause a stop, not a password reset.

Preflight checks manifest UUIDs, not every account in the destination. An existing email, coach code or other unique value attached to a different UUID can therefore be rejected by a later insert, after earlier fixtures were created. That failure still stops without overwriting the conflicting identity; it must be investigated before resuming.

Use one operator at a time. A local lock prevents concurrent runs sharing a state directory; it is not a distributed lock across computers. Database uniqueness makes concurrent inserts fail rather than overwrite. If the process is forcibly stopped, confirm that its recorded PID is no longer running before removing that exact stale lock file. Do not delete the associated credentials file.

There is no automatic cleanup/reset. If a person changes a fixture during rehearsal, replay reports a conflict. Investigate it; never restore the old global purge or duplicate-deletion queries. Any later cleanup must enumerate exact manifest IDs and inspect dependencies first. Unrelated records are never intentionally touched.

The test suite replays the real migration history into an isolated in-memory database and exercises actual SQL roles, replay and recovery. Admin API unit tests use a controlled client; they do not prove hosted Auth. A successful seed is not a live release check: separately verify login, invitation delivery, parent switching, academy isolation, consent/withdrawal, phone journeys and scorecard exclusion of synthetic activity.

See [S2 scope and acceptance](plans/s2-repeatable-demo.md) and [current pilot gates](pilot-readiness-2026-09-25.md).
