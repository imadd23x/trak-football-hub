# Executable consent and private-note audit

Status: **unresolved, intentionally failing audit**. These are existing defects in integration `b66abcb`, not regressions introduced by the parent-family, invitation, authentication or academy-departure fixes. The [P4 boundary review](p4-feedback-contract.md) describes the UI/edge paths and ownership; the [P2 plan](../plans/p2-academy-consent.md) covers the larger academy-specific design.

`supabase/tests/consent_privacy_review.sql` replays against the real migrated schema and uses actual authenticated database roles. It must exit unsuccessfully while any desired privacy assertion fails. A red result is evidence of unresolved behavior, never a passing security check or pilot approval. Keep it behind an explicit non-release audit command until the fixes land; do not invert its assertions to make current vulnerabilities green.

## Assertions and controls

| ID | Required behavior | Current source responsible |
|---|---|---|
| CP1 | Linked child cannot SELECT a private assessment note. | `20260524000001_player_feedback_rls.sql:6` grants player reads without publication. K9 owns the repair. |
| CP2 | With `parent_visibility=false`, parent SELECT returns no assessments, awards or matches (three assertions). | `20260612000001_parent_read_assessments_awards.sql:43` and `20260423171651_b6c96b22-bd86-4a0a-82ee-abf9be16363a.sql:39` authorize through identity links only. P2 owns purpose enforcement. |
| CP3 | After actual sole-guardian withdrawal, parent SELECT returns no assessments, awards or matches (three assertions). | `withdraw_parental_consent` closes approval in `20260912000001_parental_consent.sql:297`, but the parent read policies do not consult it. |
| CP4 | With `recognition=false`, the owning coach cannot INSERT an award. | `20260917000001_coach_write_ownership.sql:193` uses the general consent gate; `player_has_parental_consent` at `20260912000001_parental_consent.sql:118` ignores purpose choices. |

All identities are synthetic. The child is 11, below both the old and approved pilot thresholds. A single guardian is linked; grants and withdrawal call the existing public RPCs with that guardian's identity. Visibility and recognition are varied separately to avoid conflating the two permissions. Notices are explicitly synthetic fixture text, not approved real-user wording.

Positive controls establish that approved parent reads and coach/player writes work, the owner coach can read the private note, unrelated parents cannot read the child's records, purpose choices were recorded, withdrawal closes exactly one active consent without unlinking, and evidence/development records remain present. Private-note access is denied to parents even when progress visibility is enabled.

The assertion helpers are SECURITY INVOKER. SELECT checks accept either zero RLS-visible rows or an explicit permission denial. The INSERT helper rolls back an unexpected successful write before recording failure. Unrelated runtime/SQL errors propagate rather than count as access denied. The final exception lists all failed labels; passing unrelated controls cannot hide a failed privacy assertion.

## Running safely

Run the explicit audit from the repository root. It creates an in-memory PGlite database, replays all migrations and existing backfill checks, and runs this audit alone. It never accepts a connection URL or contacts Supabase:

```sh
npm run test:db -- --consent-privacy-review
```

Expected current result: exit 1 with eight privacy failures and no control failures. The default `npm run test:db` and its existing release behavior remain unchanged. A green default run does not resolve this separate audit.

The SQL refuses a database without the disposable marker, wraps fixtures in a transaction and contains no COMMIT. On an assertion failure the runner rolls back or closes its disposable connection. Never run this file against the shared live project.

## Evidence and limits

The initial manual replay at `b66abcb` loaded 60 migrations. A parent with visibility and recognition declined could read one assessment, one award and one match, including after actual withdrawal; a declined-recognition award INSERT succeeded. The linked child could read one private note; the linked parent could read zero.

Executable replay on September 18, 2026 against integration `c5e8832`: **60 migrations; 8 failing privacy assertions; all 19 controls passed; exit code 1**. CP1 returned one private note; each CP2/CP3 read returned one row; CP4's INSERT succeeded and was rolled back. After the runner's final ROLLBACK, a privileged check found **zero fixture Auth users remaining**. Passing later requires all eight desired denials and the controls to pass together, followed by independent review.

After adding the explicit runner flag, `npm run test:db -- --consent-privacy-review` reproduced the same eight failures with all backfill checks retained. The unchanged default `npm run test:db` exited 0: parent-invitation suite passed and operational-view suite passed all 282 assertions.

This suite does not assert pending multi-guardian precedence, invent a future academy-consent API, verify concurrency, test HTTP/Auth/provider behavior or prove deployed policies. It does not exercise the direct AI-generation endpoint. K9/T2 must independently remove private inputs from that endpoint and enforce explicit publication; P4 must consume the agreed shared projection without a private-data fallback. No automatic publication of historical notes is permitted.
