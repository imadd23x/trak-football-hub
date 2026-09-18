# Combined consent and roster audit gates — 2026-09-18

Local fork candidate `shared/audit-gates-integration` combines consent
`f1e4e4dd4d3904b53dcd08537dcd69dd9b1ec8c7` and roster
`b0e3ef94eeb28522a8004a093da4c45265f38f56`. Their exact common ancestor is
governance `3c2a6e37134fcd76f5f6c747c5df4fd58cd5ee60` (PR46).

## Integration contract

- Resolve four shared files additively: CI workflow, proposed protection JSON,
  source release-workflow tests, and governance workflow tests.
- Keep separate **Consent privacy audit** and **Roster adoption audit** jobs,
  isolated candidate/trusted checkouts, read-only permissions and full summaries.
- Both Supabase and Deploy require both audit jobs to succeed, plus the existing
  main release eligibility and source/backend checks. Tests execute the actual
  conditions across both audit outcomes, including missing results and supersession.
- Required contexts: `test`, `Merge policy`, `Consent privacy audit`,
  `Roster adoption audit`. Every existing source, SQL, upgrade, browser, harness,
  lint, typecheck and build step remains.
- No app, migration, runner, SQL assertion, baseline, observation, inventory or
  dependency manifest changes. Historical observations are not relabelled.

| Trusted input | Preserved revision |
| --- | --- |
| Consent runner/inventory | `e9789c11da81414ab51eb7c697f2610af80c6d4c` |
| Consent policy/baseline | `8fcd564ebda05f60b271a4df6d68bed333e1d253` |
| Roster runner | `781f4d423a4f85c7658dfbae53e8002e96773db3` |
| Roster inventory | `415a796af366e436de3c36c1e2f8a716da14ce0c` |
| Roster baseline | `0b1b039a7b46382a9da4c7fba36da68222365111` |

## Verification

Executed against committed merge candidate `238221aa7d0f1c95b843d3ec941a295141f16a94`:

| Command / check | Observed result |
| --- | --- |
| Pinned consent runner from separate trusted checkout | Pass: 62 migrations; 27 assertions, 19 passing controls and 8 explicitly accepted failures |
| Pinned roster runner from separate trusted checkout | Pass: 21 assertions, including 7 controls; zero accepted debt |
| `node --test tests/governance/*.test.mjs tests/audits/roster-adoption.test.mjs` | 104/104 pass |
| `npm test` | 318/318 pass, 28 files |
| `npm run test:harness` | 17/17 pass, 4 files |
| `npm run typecheck` / `npm run build` | Pass; existing build chunk-size warning |
| `npm run lint` | 0 errors, 136 warnings |
| `npm run uc:check` | Exit 0: 2 enforced cases pass; pending UC-A02 still has 3 failures, 10 other tested cases pass, 15 pending cases have no tests |
| `npm run test:db` | Pass: 62 migrations, both backfill fixtures, parent-invite security and 282 operational-view assertions |
| `npm run test:db -- --parent-upgrade-review` | Pass: 62 migrations with deployed reports preceding parent upgrade; both suites and 282 operational-view assertions |
| Pin and diff review | Runner/SQL/inventory/baseline/observation bytes unchanged; no app, migration or package changes; whitespace check clean |

The source tests execute the actual workflow expressions for a 6×6 audit-outcome
matrix. Governance tests execute 7×7 audit states and three release-eligibility
states for both production jobs. Independent review found no integration blocker.
Audit reports and complete step summaries are local files under
`/private/tmp/trak-audits-integration-*238221a*`; other check logs use the same
prefix. No browser rerun or hosted CI is claimed by these local checks.

Reproduce from the current candidate checkout using its actual HEAD. The consent
runner requires that exact revision and a fresh, unused report path; the temporary
directory below keeps a new execution separate from recorded evidence. Each runner
script still comes from its corresponding trusted checkout:

```sh
CANDIDATE_SHA="$(git rev-parse HEAD)"
AUDIT_REPORT_DIR="$(mktemp -d /private/tmp/trak-audit-replay.XXXXXX)"
node ../trak-consent-audit-gate/scripts/audits/consent-runner.mjs --candidate-root . --candidate-revision "$CANDIDATE_SHA" --runner-revision e9789c11da81414ab51eb7c697f2610af80c6d4c --policy-revision 8fcd564ebda05f60b271a4df6d68bed333e1d253 --report "$AUDIT_REPORT_DIR/consent.json"
node ../trak-roster-audit-gate/scripts/audits/roster-adoption.mjs --candidate-root . --candidate-revision "$CANDIDATE_SHA" --baseline-revision 0b1b039a7b46382a9da4c7fba36da68222365111
```

## Remaining gates and limits

PR46 must be approved/delivered before canonical integration, then this candidate
must contain current main and receive fresh checks and independent review.
There are no separate open audit PRs to resolve. This is local fork preparation,
not hosted protection activation, a production release, or real-child approval.
The eight named consent failures remain admission blockers; roster has zero
accepted debt within its limited identity inventory. Feedback FS7/FS8 still need
their feature contract and native concurrency runner. General suite discovery
and the separate production-queue work are unchanged. No hosted fixtures or
credentials are used; no permission to bypass these gates is implied.
