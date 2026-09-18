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

The merged candidate is committed before running exact-SHA audit CLIs. Results
will be recorded in the final evidence commit; this initial entry claims no
completed combined audit execution.

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
