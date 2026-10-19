<!-- delivery-policy: historical -->
> Historical record. Development and delivery follow the [current canonical delivery policy](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/blob/main/docs/release/merge-gate.md). Process instructions recorded below are superseded; product facts, explicit scope holds and test observations remain evidence.

# Design: Use-Case Test Harness with Pre-Commit Gate

Date: 2026-09-07
Repo: trak-football-hub
Status: Approved for planning

---

## Problem

The pilot build has 34 passing tests. All of them cover `src/lib/` pure
functions: `rating-engine`, `medals`, `invite-codes`. Even
`src/__tests__/pilot-e2e.test.ts`, named "e2e", is arithmetic — it renders
nothing and touches no backend.

The consequence is visible in `lib/medals.ts`: fully unit-tested, and never
called from anywhere in the application. A green suite over a feature that
does not exist for any user. Every defect in the 2026-07-27 audit lives in
this gap, because nothing in the harness tests what a coach, athlete or
parent can actually do.

There is no git hook and no CI workflow, so no change is gated on anything.

## Goal

Every application use case is expressed as an executable test bound to a
versioned, product-owner-owned definition. Changes cannot be committed if
they break a use case that is currently enforced. When a use case is broken,
ambiguous, or missing, the product owner is asked — through a tracked
artifact, not a verbal handoff — to clarify or update it.

## Non-goals

- Testing the PARKED surface (sessions, attendance, meeting requests, coach
  progress dashboard, standalone wellness, parent alerts, profile depth,
  child switcher, training log, highlights, CV export). Parked use cases are
  registered as `parked` and never run.
- Unit-test coverage targets. This harness measures use cases, not lines.
- Resolving the divergent root vs `docs/pm/` document copies. The registry
  becomes the single source for *use cases*; the wider duplication is
  untouched and remains open process debt.
- Fixing the tracked `.env` credential exposure. Flagged, handled separately.

---

## Architecture

### Layout

```
docs/use-cases/
  registry.yaml         single source of truth, product-owner-owned
  registry.lock.json    SHA-256 of each use case's spec text
  OPEN-QUESTIONS.md     escalation log, machine-appended, human-resolved
  README.md             generated, PO-readable view of the registry
tests/
  support/use-case.ts   the useCase() binding helper
  fixtures/             seed data: coach, athlete, parent, squad, matches
  msw/handlers.ts       Supabase REST + auth interceptors
  msw/server.ts
  usecases/             TIER 1 — Vitest + Testing Library + MSW
    athlete/ coach/ parent/
  e2e/                  TIER 2 — Playwright + local Supabase
    rls/
scripts/
  uc-check.mjs          registry-test cross-reference and gate runner
  uc-report.mjs         regenerates docs/use-cases/README.md
.husky/
  pre-commit
  pre-push
```

Test files carry their use-case ID in the filename —
`tests/usecases/athlete/UC-A02.log-match.test.tsx`. The checker maps registry
entries to tests by that convention, so there is no second manifest to drift.

### Registry schema

```yaml
version: 1
owner: "@kostasanastasioubusiness-lang"
use_cases:
  - id: UC-A02
    actor: athlete
    title: Log a match with position inputs and live band preview
    requirement: REQ-001
    status: enforced          # enforced | pending | parked
    tier: [1, 2]
    spec_version: 1
    given: A signed-in pilot athlete on mobile web
    when: They complete the match log form and tap save
    then:
      - A matches row is persisted with computed_score and band
      - The result screen shows the band word in the correct band colour
      - No decimal number is rendered anywhere in the UI
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md
```

Field meanings:

- `status` drives the ratchet. `enforced` blocks a commit on failure.
  `pending` runs and reports but never blocks. `parked` is excluded from
  every run.
- `tier` selects the harness: `1` in-process, `2` real stack, `[1, 2]` both.
- `spec_version` is the product owner's authority marker. See Escalation.
- `requirement` links back to REQ-001 through REQ-005 in `REQUIREMENTS.md`.
- `source` records where the use case was decided, for audit.

### Binding

```ts
import { useCase } from '../../support/use-case'

useCase('UC-A02', () => {
  it('persists the match and shows the band word', async () => {
    // ...
  })
})
```

`useCase()` looks the ID up in the registry and throws immediately if it is
unknown, so a typo cannot silently produce an untracked test. It tags the
suite with the ID and actor for reporting.

### Tier 1 — pre-commit, target under 20 seconds

Vitest with the existing jsdom environment, rendering real routes through the
real `AuthContext` and `RouteGuard`, with MSW intercepting Supabase REST and
auth traffic at the HTTP boundary.

MSW rather than a hand-written fake client is a deliberate choice.
`src/integrations/supabase/client.ts` constructs a single module-level client,
so intercepting below it requires no dependency injection and no change to
application code. More importantly, the genuine `@supabase/supabase-js`
client, the real query-builder chains and the real error handling all execute.
That is what catches the defect class the audit named: PostgREST returning an
empty array versus erroring, currently rendering identically as "nothing yet".

Every tier-1 data-reading test asserts that three states are visually
distinguishable: genuinely empty, permission-blocked, and network-failed.

### Tier 2 — pre-push, minutes

`supabase start` against local Docker (available; five migrations exist under
`supabase/migrations/`), `supabase db reset`, seeded fixtures, then Playwright
at 430px viewport width.

Tier 2 owns what tier 1 structurally cannot prove: real `TRK-XXXX` and
`PAR-XXXX` redemption, real persistence, and the RLS suite the Definition of
Done requires — each role attempting reads across every link it does not
have, asserting rejection rather than empty.

The split is a rule, not a preference: **if a use case's truth depends on a
database policy, it is tier 2.**

---

## Gate mechanics

`pre-commit` runs `node scripts/uc-check.mjs --stage=commit`, cheapest check
first:

1. **Registry integrity.** Every use case has all required fields. Every
   `enforced` use case has a matching test file. Every test file's ID exists
   in the registry. Blocks. A `pending` use case with no test file is
   reported as coverage debt, not blocked — this is what lets Phase 0 seed
   the full registry before any test exists.
2. **Lock check.** See Escalation, trigger T3. Blocks.
3. **Enforced tier-1 suite.** Vitest invoked with an explicit file list
   derived from the registry. Blocks.
4. **Pending tier-1 suite.** The same, with exit code ignored. Prints the
   promotion nudge on any newly-passing entry:
   `UC-A06 now PASSES — flip to enforced in registry.yaml`.
5. **Untracked-surface warning.** The commit touches `src/pages/**` or
   `src/components/trak/**` but no use-case test changed. Warns, never
   blocks. A blocking version of this rule trains people to bypass the hook.

`pre-push` runs `node scripts/uc-check.mjs --stage=push`: tier 2 for enforced
use cases plus the full RLS suite.

CI runs both tiers on every pull request. This matters: `--no-verify` exists
and always will. The hook provides fast local feedback; CI is the actual
backstop. Anything that must not merge has to be enforced in CI, not only in
the hook.

---

## Escalation

Three triggers reach the product owner.

**T1 — an enforced test fails.** Block the commit, append an OPEN-QUESTIONS
entry.

**T2 — registry/test drift.** An enforced use case has no test, or a test
names an unknown ID. Block.

**T3 — a use case's spec text changed without authority.** Block.

T3 is the load-bearing one. `registry.lock.json` stores a SHA-256 of each use
case's `given`, `when`, `then` and `status`. If that hash changes while
`spec_version` is unchanged, the gate stops the commit:

```
UC-A02 spec text changed but spec_version is still 1.
You are editing the product owner's words. Either revert,
or have the PO bump spec_version and add a changelog entry.
```

This closes the failure mode the whole system exists to prevent: a developer
meeting a red test and quietly weakening the assertion until it passes. Under
this design, weakening a use case cannot be done silently — it appears in the
diff as a versioned spec change with a named owner.

### Escalation artifact

Appended to `docs/use-cases/OPEN-QUESTIONS.md`, structured so the product
owner can answer without reading code:

```markdown
## Q-2026-09-07-01 · UC-A02 · Log a match with live band preview
Raised: 2026-09-07 · commit blocked · REQ-001
Spec (v1) says: THEN "No decimal number is rendered anywhere in the UI"
Observed:        result screen renders "7.4" in the band chip

PO decision needed — one of:
  [ ] Spec stands -> code bug, fix the code, no registry change
  [ ] Spec changes -> bump spec_version, add changelog entry, dev updates test
  [ ] Spec ambiguous -> rewrite given/when/then, bump spec_version
Status: OPEN
```

The three options are deliberately asymmetric. "Spec stands" requires nothing
from the product owner, so the path of least resistance is the correct one:
fix the code. Changing the specification costs a version bump and a changelog
line.

`uc-check.mjs` refuses to append a duplicate entry for a use case that already
has an `OPEN` question, so a repeatedly-failing test produces one question,
not a hundred.

---

## Seed registry

Twenty-one entries, derived from the fourteen IN use cases and the role
inventory in `docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md`.
Registry granularity is finer than the fourteen-item list: four of the
fourteen IN use cases are already working, and they expand to six registry
entries.

All twenty-one are seeded as `pending` in Phase 0, because a use case cannot
be enforced before its test exists. The six below are the Phase 1 target —
they are enforced as soon as their tier-1 tests are written and passing.

### Enforceable after Phase 1 — 6 entries

| ID | Actor | Use case | REQ | Tier |
|----|-------|----------|-----|------|
| UC-A02 | athlete | Log a match with position inputs and live band preview | REQ-001 | 1, 2 |
| UC-A03 | athlete | See band result after saving a match | REQ-001 | 1 |
| UC-A04 | athlete | View match history and match detail | REQ-001 | 1 |
| UC-C02 | coach | Add a player to the squad manually | REQ-002 | 1, 2 |
| UC-C03 | coach | View the squad | REQ-002 | 1 |
| UC-C04 | coach | Assess a player on 6 sliders producing a band | REQ-002 | 1, 2 |

### Remaining pending after Phase 1 — 15 entries

| ID | Actor | Use case | REQ | Tier | Audit |
|----|-------|----------|-----|------|-------|
| UC-C07 | coach | Receive a real, stored, unique `TRK-XXXX` code | REQ-003 | 2 | cosmetic |
| UC-C08 | coach | See linked athletes' logged matches, bands only, private inputs excluded | REQ-003 | 2 | not built |
| UC-A06 | athlete | Create and track a goal | REQ-001 | 1 | unrouted |
| UC-A07 | athlete | Earn and see medals | REQ-001 | 1 | never called |
| UC-A08 | athlete | Enter a `TRK-XXXX` code and claim the squad row | REQ-003 | 2 | not built |
| UC-A09 | athlete | See the coach's assessment: band and 6 category bars | REQ-002 | 1, 2 | not built |
| UC-A10 | athlete | Generate a `PAR-XXXX` code for a parent | REQ-003 | 2 | partial |
| UC-P01 | parent | Redeem `PAR-XXXX`, create an account, link to the child | REQ-003 | 2 | partial |
| UC-P02 | parent | See the child's season band | REQ-004 | 1, 2 | blocked query |
| UC-P03 | parent | See the child's match feed | REQ-004 | 1, 2 | blocked query |
| UC-P06 | parent | See the coach's assessments | REQ-004 | 1, 2 | not built |
| UC-P07 | parent | Give verifiable consent for a 13-14 year old, consent record held | REQ-004 | 2 | not built |
| UC-T01 | system | Every enforced use case emits telemetry answering the Q4 metric | REQ-005 | 2 | not built |
| UC-X01 | system | No role reads data belonging to anyone they are not linked to | REQ-004 | 2 | unverified |
| UC-X02 | system | Network failure shows "couldn't connect - retry", never a false empty state | REQ-004 | 1 | not built |

Six of twenty-one enforced at the end of Phase 1. The gate is green
throughout, and that ratio is the project's real progress bar.

### Resolved ambiguity

IN use case 12 reads "Parent sees child's season band, match feed and coach
assessments", but the role inventory also lists P4, "See child's goals".
**Decision: parent goal visibility is excluded from the registry**, following
the IN list rather than the inventory. This is seeded into
`OPEN-QUESTIONS.md` as Q-2026-09-07-01 for the product owner to confirm or
overturn — and serves as the worked example of the escalation flow.

---

## Rollout

**Phase 0 — scaffold.** Registry, `use-case.ts` helper, `uc-check.mjs`,
`uc-report.mjs`, MSW server and handlers, husky hooks, all 21 entries seeded
as `pending`. No use-case tests yet; the gate runs, reports 21 entries of
coverage debt, and exits 0.

**Phase 1 — enforce what works.** Tier-1 tests for the six working entries,
written against the registry text, then flipped to `enforced`. This is the
point at which the system starts protecting the application.

**Phase 2 — real stack.** Playwright fixtures, local Supabase seeding, the
RLS suite (UC-X01), and tier-2 tests for the connect and parent use cases as
those features land.

**Phase 3 — CI.** GitHub Actions running both tiers on pull requests, plus
publishing the generated `docs/use-cases/README.md` as a build artifact.

Phases 0 and 1 deliver the capability. Phases 2 and 3 harden it.

---

## Verification

The design is correctly implemented when all of the following hold:

1. `node scripts/uc-check.mjs --stage=commit` exits 0 on a clean tree and
   completes in under 20 seconds.
2. Deleting an assertion from an enforced tier-1 test causes CI to fail.
3. Editing a `then:` line in `registry.yaml` without bumping `spec_version`
   blocks the commit with the T3 message.
4. Breaking `computeMatchScore` so UC-A02 fails blocks the commit and appends
   exactly one `OPEN` entry to `OPEN-QUESTIONS.md`.
5. Repeating step 4 a second time appends no further entry.
6. Flipping a passing `pending` entry to `enforced` requires no code change.
7. `supabase db reset` followed by the tier-2 run passes the RLS suite with
   every cross-link read rejected rather than empty.
