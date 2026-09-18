# Explicit audit debt contract

The evaluator at [`scripts/governance/audit-ratchet.mjs`](../../scripts/governance/audit-ratchet.mjs) compares named assertions, not failure counts. The original governance change supplied the contract, CLI and synthetic evaluator tests. This fork integration combines the [consent/privacy gate](consent-audit.md) and [roster gate](../reviews/roster-audit-gate-2026-09-18.md), each with independently pinned inputs and a measured proposed baseline. Feedback remains separate work; neither this evaluator nor an unchanged-debt result establishes pilot readiness.

## Trust boundary

The baseline, expected candidate SHA, evaluator and runner revisions must come from independently reviewed, trusted inputs. Candidate code and its output cannot approve their own new waivers. In CI, check out the trusted evaluator/baseline separately from candidate source; pin the audited runner and inventory to their reviewed revisions. Obtain the expected candidate SHA from the workflow's trusted event/checkout verification, not from the submitted report. Run without production credentials or a hosted database target.

The evaluator validates declarations and comparisons; it cannot prove that a claimed revision was checked out or that a runner genuinely executed a test. Workflow isolation and trusted-runner execution establish that provenance. A candidate-authored JSON file with matching values is not evidence. Do not wire this as a privileged `pull_request_target` job executing untrusted candidate scripts.

Baseline reductions require separate reviewer approval just like additions. The tool never writes or automatically updates a baseline. A newly passing debt assertion makes the old baseline stale and rejects the gate until its expected status becomes `pass`; after that, recurrence is a new failure. Do not delete the assertion to remove debt.

## Version 1 JSON

Both inputs are JSON objects with `version: 1`. Required fields must exist, unknown fields are rejected, and values are not coerced. All revision fields are full lowercase 40-character Git SHAs. Suite and assertion IDs are stable, case-sensitive identifiers matching `[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}`. IDs must be unique within their inventory.

Baseline:

```text
{
  version: 1,
  suites: [{
    id: string,
    sourceRevision: GitSHA,
    runnerRevision: GitSHA,
    inventoryRevision: GitSHA,
    assertions: [{ id: string, kind: "check" | "control", expected: "pass" | "fail" }]
  }]
}
```

`sourceRevision` records the source on which that baseline was observed. `runnerRevision` identifies the trusted runner/test implementation. `inventoryRevision` identifies the reviewed assertion inventory. Each suite must contain at least one behavior check and one positive control. Controls may only expect `pass`; baseline error/skip waivers do not exist. No historical counts or illustrative SHAs in evaluator tests are a real baseline.

Candidate report:

```text
{
  version: 1,
  candidateRevision: GitSHA,
  suites: [{
    id: string,
    sourceRevision: GitSHA,
    runnerRevision: GitSHA,
    inventoryRevision: GitSHA,
    status: "complete" | "error" | "skipped",
    detail?: string,
    assertions: [{ id: string, kind: "check" | "control",
                   status: "pass" | "fail" | "error" | "skipped", detail?: string }]
  }]
}
```

Suite `sourceRevision` must equal the independently supplied candidate SHA, as must the report's `candidateRevision`. Runner and inventory revisions must exactly match the baseline. A completed suite may contain failed checks; `complete` means execution finished, not that its behavior passed. Optional details are strings of at most 4,000 characters. Error/skipped suites can report partial or empty assertions, but always reject the gate. Missing output is not a zero-failure run.

The suite set, assertion set and check/control classifications must match exactly. Reordering is harmless; additions, removals, renames, duplicates, or stale inventory/runner revisions reject the gate. Any failed control, error or skipped assertion rejects it even when the assertion previously failed. An expected-pass assertion failing is new debt. An expected-fail assertion passing requires baseline reduction. Only the exact reviewed failure identities may remain accepted debt.

## CLI and result

```sh
node scripts/governance/audit-ratchet.mjs \
  --baseline /trusted/audit-baseline.json \
  --report /artifacts/candidate-audits.json \
  --candidate-revision "$CANDIDATE_SHA"

node --test tests/governance/audit-ratchet.test.mjs
```

The CLI prints one structured evaluation to stdout and returns 0 only when the contract matches. Violations, malformed/missing input, invalid arguments and summary-write errors return nonzero. `GITHUB_STEP_SUMMARY` receives an appended human-readable report when set; `--summary PATH` overrides it for local checks. Existing summary content is preserved. A summary path cannot be an input file. Each suite lists its provenance and every assertion's expected/observed status. The heading explicitly distinguishes accepted debt from a security pass or readiness approval. Parser/contract failures produce an error summary instead of fabricated assertion results.

The importable `evaluateAuditReport(baseline, report, candidateRevision)` returns `{ ok, candidateRevision, reportedCandidateRevision, acceptedDebt, suites, violations }`; malformed input throws. `formatAuditSummary(result)` produces Markdown with untrusted detail text escaped. Neither function starts subprocesses, queries a database, fetches a repository or edits files. `main(argv, env)` owns file input and summary output.

## Separate real-audit integration

At governance base `00910940f596d9fe9a7cd416dc741943d1df2cc9`, the three reviewed audit files and native feedback runner are absent from main. Copying historical counts into a baseline would therefore certify no execution. The minimum follow-up is:

1. **Port unchanged assertions with explicit IDs and machine-readable results.** Preserve strict terminal failure behavior and disposable-database guards. Every result row, including positive controls, needs an explicit stable ID; finding families such as CP2 are not unique IDs because they contain several checks. Do not infer results from aggregate counts, error text alone, or a process exit code. Emit the complete result inventory before a terminal SQL exception/rollback; the trusted adapter must report fixture, migration, parser, timeout and cleanup failures as suite `error`, not expected debt. Test missing/corrupt output as well as observed failures.
2. **Consent/privacy:** bring the checked-in `supabase/tests/consent_privacy_review.sql` and its opt-in integration runner from reviewed fork history (audit commit `78f771b`). Historical evidence is 8 failed assertions and 19 passing controls, not a proposed current baseline. It uses actual roles and tests existing purpose/withdrawal/private-note behavior; it does not implement academy-specific consent or the parked zero-consent conversion. Re-run against the exact integration candidate and retain all controls before approving its named debt.
3. **Feedback FS7:** the stronger `supabase/tests/feedback_storage_review.sql` in review history (`b0675d7`, later retained in `5e71caf`) has 48 total assertions, including 33 controls. Do not replace it with Tarek's 16-check suite: deliberate bad grants remained green because an existing publication caused a uniqueness error, draft reads had no valid draft fixture, and unrelated SQL errors counted as denials. Port the stronger assertions and their exact denial-error checks.
4. **Feedback FS8:** retain `scripts/test-feedback-review.mjs` from `b0675d7` as a separate native PostgreSQL suite. Its real academy-admin departure transaction holds a roster lock, verifies an overlapping publisher waits, commits departure, and verifies both rejection and unchanged publication rows. Sequential PGlite cannot reproduce this schedule. Give its positive controls and race assertion separate IDs; missing lock observation, timeout, startup or cleanup failure is an error. The historical run had one unauthorized third revision; that is evidence, not permission to waive all failures in the runner.
5. **Resolve the T2 dependency explicitly.** The feedback migration/feature is not in governance base main. A separate diagnostic integration candidate can contain the exact reviewed, unchanged T2 implementation, identified by its own integration SHA. Do not silently overlay a migration and label the result a test of main; do not treat a missing table as accepted debt. The main release gate can require these suites only when its tested candidate includes their prerequisite contract. No feedback feature repair belongs in the governance PR.
6. **Roster adoption:** the existing red suite reports 3/6 at the reviewed PR40/PR42 heads, but its successful assessment reads run as owner after changing only JWT claims. Pair actor claims with actual SQL roles, add a same-actor successful read control, and preserve both namesake identities/history in the ambiguity assertion. Do not make it pass by guessing which child to attach or deleting another row. Review these test repairs and then establish the real baseline from the new exact candidate, rather than grandfathering `3` as a budget.
7. **Prove discrimination and wire the reviewed inventories.** Deliberately weaken one known protection in disposable candidates, verify the intended named assertion fails, then restore it. Show that fixing old debt while introducing another failure still rejects the gate. Register all required suites through the settled governance workflow interface; require successful controls, complete output and exact revisions. A later approved debt reduction is part of the repair and must be retained when merging.

The recent U7/U8 suite also needs stronger tests before its green result can support an admission gate: its departure RPC failure fell back to manual state changes, and nonexistent-RPC/missing-actor mutations still passed 11/11. These observations justify runner validation; they are not additional production findings or part of this evaluator's synthetic baseline.

Verification for this contract is the Node test command above. It exercises the evaluator and real CLI with temporary local JSON inputs, including unchanged debt, same-count substitutions, baseline reduction/recurrence, wrong revisions, malformed inventories, skipped/error results, failed controls, duplicates, and summary failures. Rollback removes these three contract/test/document files; no runtime data, application behavior or migration changes are included.
