<!-- delivery-policy: historical -->
> Historical record. Development and delivery follow the [current canonical delivery policy](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/blob/main/docs/release/merge-gate.md). Process instructions recorded below are superseded; product facts, explicit scope holds and test observations remain evidence.

# Use-Case Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phases 0 and 1 of the use-case test harness — a product-owner-owned registry of application use cases, a checker that gates commits on them, and tier-1 tests for the six use cases that currently work.

**Architecture:** `docs/use-cases/registry.yaml` is the single source of truth. Test files bind to registry entries by ID via a `useCase()` helper and a filename convention. `scripts/uc-check.mjs` cross-references registry against tests, verifies spec text has not been altered without authority, runs enforced tests blocking and pending tests non-blocking, and appends unanswered questions to `OPEN-QUESTIONS.md`. Tier-1 tests render real routes through the real `AuthContext` and `RouteGuard`, with MSW intercepting Supabase HTTP traffic so the genuine `@supabase/supabase-js` client executes.

**Tech Stack:** Vitest 3 (jsdom), @testing-library/react 16, MSW 2, yaml, husky 9, Node 24.

## Global Constraints

- Registry statuses are exactly `enforced` | `pending` | `parked`. Only `enforced` blocks a commit.
- Test files must be named `UC-<ID>.<slug>.test.tsx` under `tests/usecases/<actor>/`.
- Tier-1 target runtime: under 20 seconds total for the pre-commit stage.
- A `pending` use case with **no** test file is coverage debt, reported but never blocking. An `enforced` use case with no test file **blocks**.
- Never weaken a registry `then:` clause to make a test pass. Changing spec text requires a `spec_version` bump; `registry.lock.json` enforces this.
- Supabase must never be reached over the network in tier 1. `vitest.config.ts` pins `test.env` to `https://test.supabase.co`.
- Do not add rewrites, redirects, or framework keys to `vercel.json` — out of scope here.
- Six use cases become `enforced` in this plan: UC-A02, UC-A03, UC-A04, UC-C02, UC-C03, UC-C04. Everything else stays `pending`.

## Preconditions

- Branch `test/use-case-harness`, cut from `main`.
- **PR #4 (`ci/vercel-deploy-gate`) is independent and may merge before or after this.** Both touch `package.json`; expect a trivial conflict in the `devDependencies` block and resolve by keeping both sides' additions. This branch does **not** inherit PR #4's `typecheck` script or `eslint-plugin-storybook` fix, so `npm run lint` will still crash here — do not add lint to any command in this plan.

## File Structure

| File | Responsibility |
|---|---|
| `docs/use-cases/registry.yaml` | The 21 use-case definitions. Product-owner-owned. |
| `docs/use-cases/registry.lock.json` | SHA-256 per use case; makes spec edits tamper-evident. |
| `docs/use-cases/OPEN-QUESTIONS.md` | Escalation log. Appended by the checker, resolved by a human. |
| `docs/use-cases/README.md` | Generated PO-readable view. Never hand-edited. |
| `tests/support/registry.ts` | Loads and validates the registry. Pure, no I/O beyond one read. |
| `tests/support/use-case.ts` | `useCase(id, fn)` — binds a suite to a registry entry. |
| `tests/support/session.ts` | Seeds a Supabase session into localStorage. |
| `tests/support/render-app.tsx` | Renders `<App />` at a route with providers intact. |
| `tests/msw/supabase.ts` | PostgREST/auth handler factories with faithful response shapes. |
| `tests/msw/server.ts` | The MSW server instance and lifecycle. |
| `tests/setup-usecases.ts` | Vitest setup: jest-dom, MSW lifecycle, localStorage reset. |
| `tests/usecases/<actor>/UC-*.test.tsx` | One file per use case. |
| `scripts/uc-registry.mjs` | Shared registry loading + hashing for the Node scripts. |
| `scripts/uc-check.mjs` | The gate. |
| `scripts/uc-report.mjs` | Regenerates `README.md`. |
| `.husky/pre-commit` | Runs the commit-stage gate. |

---

### Task 1: Registry file and loader

**Files:**
- Create: `docs/use-cases/registry.yaml`
- Create: `tests/support/registry.ts`
- Create: `tests/support/registry.test.ts`
- Modify: `package.json` (add `yaml` devDependency)
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadRegistry(): Registry`, `getUseCase(id: string): UseCase`, and the exported types `UseCase` and `Registry`. `UseCase` has fields `id: string`, `actor: 'athlete' | 'coach' | 'parent' | 'system'`, `title: string`, `requirement: string`, `status: 'enforced' | 'pending' | 'parked'`, `tier: number[]`, `spec_version: number`, `given: string`, `when: string`, `then: string[]`, `source: string`.

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev yaml msw@^2 happy-dom
```

Only `yaml` and `msw` are used by this plan; `happy-dom` is not — omit it if the install is being kept minimal. Verify: `node -e "console.log(require('yaml/package.json').version)"`

- [ ] **Step 2: Write the registry**

Create `docs/use-cases/registry.yaml`. All 21 entries start as `pending`; Task 12 flips six of them.

```yaml
# Single source of truth for Trak's application use cases.
# Product-owner-owned. Changing a given/when/then requires bumping that
# entry's spec_version — scripts/uc-check.mjs enforces this via
# registry.lock.json.
version: 1
owner: "@kostasanastasioubusiness-lang"
use_cases:
  - id: UC-A02
    actor: athlete
    title: Log a match with position inputs and live band preview
    requirement: REQ-001
    status: pending
    tier: [1, 2]
    spec_version: 1
    given: A signed-in pilot athlete on mobile web
    when: They complete the match log form and tap save
    then:
      - A matches row is persisted with a computed rating
      - They are taken to the result screen for that match
      - No decimal number is rendered anywhere in the UI
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-A03
    actor: athlete
    title: See band result after saving a match
    requirement: REQ-001
    status: pending
    tier: [1]
    spec_version: 1
    given: An athlete who has just saved a match
    when: The result screen renders
    then:
      - The band word for the computed score is shown
      - The band word is rendered in that band's configured colour
      - No decimal number is rendered anywhere in the UI
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-A04
    actor: athlete
    title: View match history and match detail
    requirement: REQ-001
    status: pending
    tier: [1]
    spec_version: 1
    given: A signed-in athlete with previously logged matches
    when: They open the match history screen
    then:
      - Every logged match appears as a card
      - An athlete with no matches sees an explicit empty message
      - A failed load is distinguishable from an empty history
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-A06
    actor: athlete
    title: Create and track a goal
    requirement: REQ-001
    status: pending
    tier: [1]
    spec_version: 1
    given: A signed-in athlete
    when: They create a goal from the goals screen
    then:
      - The goal is persisted and appears in their goals list
      - The goals screen is reachable from the athlete navigation
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-A07
    actor: athlete
    title: Earn and see medals
    requirement: REQ-001
    status: pending
    tier: [1]
    spec_version: 1
    given: An athlete whose logged matches satisfy a medal rule
    when: They open the medals screen
    then:
      - Every earned medal is shown as earned
      - Medal eligibility is evaluated from their real match history
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-A08
    actor: athlete
    title: Enter a TRK-XXXX code and claim the squad row
    requirement: REQ-003
    status: pending
    tier: [2]
    spec_version: 1
    given: An athlete holding a coach's TRK-XXXX code
    when: They submit the code
    then:
      - The squad row is linked to their account
      - The coach and athlete are genuinely connected in the database
      - An invalid or already-claimed code is rejected with a reason
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-A09
    actor: athlete
    title: See the coach's assessment as band and six category bars
    requirement: REQ-002
    status: pending
    tier: [1, 2]
    spec_version: 1
    given: A linked athlete whose coach has submitted an assessment
    when: They open their profile
    then:
      - The assessment's overall band is shown
      - All six category scores are shown as bars
      - The coach's private note is never shown to the athlete
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-A10
    actor: athlete
    title: Generate a PAR-XXXX code for a parent
    requirement: REQ-003
    status: pending
    tier: [2]
    spec_version: 1
    given: A signed-in athlete
    when: They request a parent invite code
    then:
      - A unique PAR-XXXX code is stored against their account
      - The same code is shown to them until it is redeemed
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-C02
    actor: coach
    title: Add a player to the squad manually
    requirement: REQ-002
    status: pending
    tier: [1, 2]
    spec_version: 1
    given: A signed-in coach on the add-player screen
    when: They enter a player name and save
    then:
      - A squad_players row is persisted against that coach
      - They are returned to the squad screen
      - Saving is refused while the name is empty
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-C03
    actor: coach
    title: View the squad
    requirement: REQ-002
    status: pending
    tier: [1]
    spec_version: 1
    given: A signed-in coach
    when: They open the squad screen
    then:
      - Every player in their squad is listed
      - A coach with an empty squad sees an explicit empty message
      - A failed load is distinguishable from an empty squad
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-C04
    actor: coach
    title: Assess a player on six sliders producing a band
    requirement: REQ-002
    status: pending
    tier: [1, 2]
    spec_version: 1
    given: A signed-in coach with at least one squad player
    when: They select a player, set the six sliders and submit
    then:
      - A coach_assessments row is persisted with all six category scores
      - A band derived from the six scores is shown before submitting
      - Submitting is refused until a player is selected
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-C07
    actor: coach
    title: Receive a real, stored, unique TRK-XXXX code
    requirement: REQ-003
    status: pending
    tier: [2]
    spec_version: 1
    given: A signed-in coach
    when: They view their invite code
    then:
      - The code is persisted, not generated for display only
      - The same code is returned on every subsequent view
      - No two coaches hold the same code
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-C08
    actor: coach
    title: See linked athletes' logged matches, bands only
    requirement: REQ-003
    status: pending
    tier: [2]
    spec_version: 1
    given: A coach linked to an athlete who has logged matches
    when: They open that athlete's profile
    then:
      - Each logged match is shown with its band
      - The athlete's self-rating is never shown to the coach
      - The athlete's body-condition input is never shown to the coach
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-P01
    actor: parent
    title: Redeem PAR-XXXX, create an account and link to the child
    requirement: REQ-003
    status: pending
    tier: [2]
    spec_version: 1
    given: A parent holding a PAR-XXXX code
    when: They redeem it and complete sign-up
    then:
      - The parent account is linked to exactly that child
      - The code cannot be redeemed a second time
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-P02
    actor: parent
    title: See the child's season band
    requirement: REQ-004
    status: pending
    tier: [1, 2]
    spec_version: 1
    given: A linked parent
    when: They open the parent home screen
    then:
      - The child's season band is shown
      - A failed load is distinguishable from a child with no matches
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-P03
    actor: parent
    title: See the child's match feed
    requirement: REQ-004
    status: pending
    tier: [1, 2]
    spec_version: 1
    given: A linked parent
    when: They open the matches screen
    then:
      - Every match the child logged is listed with its band
      - The child's self-rating is never shown to the parent
      - The child's body-condition input is never shown to the parent
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-P06
    actor: parent
    title: See the coach's assessments
    requirement: REQ-004
    status: pending
    tier: [1, 2]
    spec_version: 1
    given: A linked parent whose child has been assessed
    when: They open the parent home screen
    then:
      - The assessment band is shown
      - The coach's private note is never shown to the parent
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-P07
    actor: parent
    title: Give verifiable consent for a 13-14 year old
    requirement: REQ-004
    status: pending
    tier: [2]
    spec_version: 1
    given: A parent linking to a child aged 13 or 14
    when: They complete the link flow
    then:
      - The flow cannot complete without a recorded consent
      - The consent record is retrievable and timestamped
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-T01
    actor: system
    title: Every enforced use case emits telemetry answering the Q4 metric
    requirement: REQ-005
    status: pending
    tier: [2]
    spec_version: 1
    given: A pilot in progress
    when: The founder runs the telemetry query
    then:
      - Weekly logging players can be counted for any given week
      - The count matches a manual count of the underlying rows
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-X01
    actor: system
    title: No role reads data belonging to anyone they are not linked to
    requirement: REQ-004
    status: pending
    tier: [2]
    spec_version: 1
    given: Two unlinked accounts of any roles
    when: One attempts to read the other's rows
    then:
      - The read is rejected rather than returning an empty result
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md

  - id: UC-X02
    actor: system
    title: A failed load never renders as a false empty state
    requirement: REQ-004
    status: pending
    tier: [1]
    spec_version: 1
    given: Any data-backed screen
    when: The request fails or the network is unavailable
    then:
      - A retryable error is shown
      - The error is visibly different from the genuine empty state
    source: docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md
```

- [ ] **Step 3: Point vitest at the tests directory and pin the Supabase host**

Replace `vitest.config.ts` entirely:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts", "./tests/setup-usecases.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "tests/**/*.{test,spec}.{ts,tsx}",
    ],
    // The repo's tracked .env points at the real Supabase project. Pinning
    // these here guarantees tier-1 tests can never reach production, and
    // fixes the localStorage auth key at sb-test-auth-token.
    env: {
      VITE_SUPABASE_URL: "https://test.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 4: Write the failing loader test**

Create `tests/support/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadRegistry, getUseCase } from './registry'

describe('use-case registry', () => {
  it('loads every use case with the required fields', () => {
    const registry = loadRegistry()
    expect(registry.use_cases.length).toBeGreaterThan(0)
    for (const uc of registry.use_cases) {
      expect(uc.id).toMatch(/^UC-[A-Z]\d{2}$/)
      expect(['athlete', 'coach', 'parent', 'system']).toContain(uc.actor)
      expect(['enforced', 'pending', 'parked']).toContain(uc.status)
      expect(uc.title.length).toBeGreaterThan(0)
      expect(uc.given.length).toBeGreaterThan(0)
      expect(uc.when.length).toBeGreaterThan(0)
      expect(uc.then.length).toBeGreaterThan(0)
      expect(uc.spec_version).toBeGreaterThanOrEqual(1)
      expect(Array.isArray(uc.tier)).toBe(true)
    }
  })

  it('has no duplicate ids', () => {
    const ids = loadRegistry().use_cases.map(uc => uc.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('resolves a known use case by id', () => {
    expect(getUseCase('UC-A02').requirement).toBe('REQ-001')
  })

  it('throws on an unknown id', () => {
    expect(() => getUseCase('UC-Z99')).toThrow(/UC-Z99/)
  })
})
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npx vitest run tests/support/registry.test.ts`
Expected: FAIL — `Failed to resolve import "./registry"`.

- [ ] **Step 6: Implement the loader**

Create `tests/support/registry.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

export type UseCaseStatus = 'enforced' | 'pending' | 'parked'
export type Actor = 'athlete' | 'coach' | 'parent' | 'system'

export interface UseCase {
  id: string
  actor: Actor
  title: string
  requirement: string
  status: UseCaseStatus
  tier: number[]
  spec_version: number
  given: string
  when: string
  then: string[]
  source: string
}

export interface Registry {
  version: number
  owner: string
  use_cases: UseCase[]
}

export const REGISTRY_PATH = resolve(process.cwd(), 'docs/use-cases/registry.yaml')

let cached: Registry | null = null

export function loadRegistry(): Registry {
  if (cached) return cached
  cached = parse(readFileSync(REGISTRY_PATH, 'utf8')) as Registry
  return cached
}

export function getUseCase(id: string): UseCase {
  const found = loadRegistry().use_cases.find(uc => uc.id === id)
  if (!found) {
    throw new Error(
      `Unknown use case "${id}". Every test must bind to an entry in docs/use-cases/registry.yaml.`,
    )
  }
  return found
}
```

- [ ] **Step 7: Create the setup file the config references**

Create `tests/setup-usecases.ts` (MSW is wired in Task 4; this keeps the config valid now):

```ts
import { beforeEach } from 'vitest'

beforeEach(() => {
  localStorage.clear()
})
```

- [ ] **Step 8: Run the test and confirm it passes**

Run: `npx vitest run tests/support/registry.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Confirm the existing suite still passes**

Run: `npm test`
Expected: PASS — 34 existing tests plus 4 new.

- [ ] **Step 10: Commit**

```bash
git add docs/use-cases/registry.yaml tests/support/registry.ts tests/support/registry.test.ts tests/setup-usecases.ts vitest.config.ts package.json package-lock.json
git commit -m "Add use-case registry and loader"
```

---

### Task 2: The useCase() binding helper

**Files:**
- Create: `tests/support/use-case.ts`
- Create: `tests/support/use-case.test.ts`

**Interfaces:**
- Consumes: `getUseCase` from Task 1.
- Produces: `useCase(id: string, fn: () => void): void` — wraps `describe`, titles the suite `<id> · <title>`, and skips entirely when the entry's status is `parked`.

- [ ] **Step 1: Write the failing test**

Create `tests/support/use-case.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { useCase } from './use-case'

describe('useCase binding', () => {
  it('throws on an unknown use-case id', () => {
    expect(() => useCase('UC-Z99', () => {})).toThrow(/UC-Z99/)
  })
})

useCase('UC-A02', () => {
  it('runs inside a suite bound to a real registry entry', () => {
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/support/use-case.test.ts`
Expected: FAIL — `Failed to resolve import "./use-case"`.

- [ ] **Step 3: Implement the helper**

Create `tests/support/use-case.ts`:

```ts
import { describe } from 'vitest'
import { getUseCase } from './registry'

/**
 * Binds a test suite to a use case in docs/use-cases/registry.yaml.
 * Throws immediately on an unknown id so a typo cannot silently create an
 * untracked test. Parked use cases are skipped rather than run.
 */
export function useCase(id: string, fn: () => void): void {
  const uc = getUseCase(id)
  const title = `${uc.id} · ${uc.title}`
  if (uc.status === 'parked') {
    describe.skip(title, fn)
    return
  }
  describe(title, fn)
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/support/use-case.test.ts`
Expected: PASS, 2 tests. The second appears under `UC-A02 · Log a match with position inputs and live band preview`.

- [ ] **Step 5: Commit**

```bash
git add tests/support/use-case.ts tests/support/use-case.test.ts
git commit -m "Add useCase() registry binding helper"
```

---

### Task 3: MSW Supabase handlers and the app render helper

**Files:**
- Create: `tests/msw/supabase.ts`
- Create: `tests/msw/server.ts`
- Create: `tests/support/session.ts`
- Create: `tests/support/render-app.tsx`
- Create: `tests/msw/supabase.test.ts`
- Modify: `tests/setup-usecases.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `SUPABASE_URL: string` — `'https://test.supabase.co'`
  - `table(name: string, rows: unknown[]): HttpHandler` — GET returning rows, honouring PostgREST's single-object Accept header
  - `tableError(name: string, status: number, body: object): HttpHandler` — GET returning a failure
  - `tableNetworkError(name: string): HttpHandler` — GET that never connects
  - `insertInto(name: string, makeRow: (body: any) => any): HttpHandler` — POST returning the created row
  - `authHandlers(): HttpHandler[]` — covers `GET /auth/v1/user` used by `trackEvent`
  - `server` — the MSW `setupServer` instance
  - `signInAs(user: { id: string; email?: string }): void` — seeds the session into localStorage
  - `renderApp(route: string): RenderResult` — renders `<App />` at a route

- [ ] **Step 1: Write the failing handler test**

Create `tests/msw/supabase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { supabase } from '@/integrations/supabase/client'
import { server } from './server'
import { table, tableError } from './supabase'

describe('supabase MSW handlers', () => {
  it('returns rows for a list query', async () => {
    server.use(table('squad_players', [{ id: 's1', player_name: 'Ana' }]))
    const { data, error } = await supabase.from('squad_players').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([{ id: 's1', player_name: 'Ana' }])
  })

  it('returns a single object when the client asks for one', async () => {
    server.use(table('profiles', [{ id: 'p1', role: 'coach' }]))
    const { data } = await supabase.from('profiles').select('*').maybeSingle()
    expect(data).toEqual({ id: 'p1', role: 'coach' })
  })

  it('resolves maybeSingle to null when there are no rows', async () => {
    server.use(table('profiles', []))
    const { data, error } = await supabase.from('profiles').select('*').maybeSingle()
    expect(data).toBeNull()
    expect(error).toBeNull()
  })

  it('surfaces a permission failure as an error, not an empty list', async () => {
    server.use(
      tableError('matches', 401, { code: '42501', message: 'permission denied' }),
    )
    const { data, error } = await supabase.from('matches').select('*')
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/msw/supabase.test.ts`
Expected: FAIL — `Failed to resolve import "./server"`.

- [ ] **Step 3: Implement the handlers**

Create `tests/msw/supabase.ts`:

```ts
import { http, HttpResponse, type HttpHandler } from 'msw'

export const SUPABASE_URL = 'https://test.supabase.co'

const SINGLE_OBJECT_ACCEPT = 'application/vnd.pgrst.object+json'

/**
 * PostgREST returns a bare object (not an array) when the client sends the
 * pgrst.object Accept header, and a 406/PGRST116 when it asks for one object
 * and finds none. supabase-js turns that 406 into `data: null` for
 * .maybeSingle() and into an error for .single(). Reproducing this exactly is
 * the whole reason for using MSW over a hand-written fake client.
 */
function respond(rows: unknown[], accept: string) {
  if (!accept.includes(SINGLE_OBJECT_ACCEPT)) return HttpResponse.json(rows)
  if (rows.length === 0) {
    return HttpResponse.json(
      {
        code: 'PGRST116',
        details: 'Results contain 0 rows',
        hint: null,
        message: 'JSON object requested, multiple (or no) rows returned',
      },
      { status: 406 },
    )
  }
  return HttpResponse.json(rows[0])
}

export function table(name: string, rows: unknown[]): HttpHandler {
  return http.get(`${SUPABASE_URL}/rest/v1/${name}`, ({ request }) =>
    respond(rows, request.headers.get('Accept') ?? ''),
  )
}

export function tableError(name: string, status: number, body: object): HttpHandler {
  return http.get(`${SUPABASE_URL}/rest/v1/${name}`, () =>
    HttpResponse.json(body, { status }),
  )
}

export function tableNetworkError(name: string): HttpHandler {
  return http.get(`${SUPABASE_URL}/rest/v1/${name}`, () => HttpResponse.error())
}

export function insertInto(
  name: string,
  makeRow: (body: Record<string, unknown>) => Record<string, unknown>,
): HttpHandler {
  return http.post(`${SUPABASE_URL}/rest/v1/${name}`, async ({ request }) => {
    const raw = await request.json()
    const body = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>
    const row = makeRow(body)
    const accept = request.headers.get('Accept') ?? ''
    const prefer = request.headers.get('Prefer') ?? ''
    if (!prefer.includes('return=representation')) {
      return new HttpResponse(null, { status: 201 })
    }
    return respond([row], accept)
  })
}

/** trackEvent() calls supabase.auth.getUser(), which is a real network call. */
export function authHandlers(): HttpHandler[] {
  return [
    http.get(`${SUPABASE_URL}/auth/v1/user`, () =>
      HttpResponse.json({ id: 'test-user', aud: 'authenticated' }),
    ),
    http.post(`${SUPABASE_URL}/auth/v1/token`, () =>
      HttpResponse.json({ error: 'not_implemented' }, { status: 400 }),
    ),
    http.post(`${SUPABASE_URL}/rest/v1/telemetry_events`, () =>
      new HttpResponse(null, { status: 201 }),
    ),
  ]
}
```

Create `tests/msw/server.ts`:

```ts
import { setupServer } from 'msw/node'
import { authHandlers } from './supabase'

export const server = setupServer(...authHandlers())
```

- [ ] **Step 4: Wire MSW into the vitest setup**

Replace `tests/setup-usecases.ts`:

```ts
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { server } from './msw/server'

// onUnhandledRequest: 'error' is deliberate. A Supabase call this suite does
// not model should fail loudly rather than silently reach the network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => {
  localStorage.clear()
})
```

- [ ] **Step 5: Run the handler test and confirm it passes**

Run: `npx vitest run tests/msw/supabase.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Implement the session and render helpers**

Create `tests/support/session.ts`:

```ts
/**
 * supabase-js derives its storage key from the project URL's first hostname
 * label. vitest.config.ts pins VITE_SUPABASE_URL to https://test.supabase.co,
 * so the key is always sb-test-auth-token. Seeding a non-expired session here
 * means getSession() resolves from localStorage with no network call.
 */
const STORAGE_KEY = 'sb-test-auth-token'

export function signInAs(user: { id: string; email?: string }): void {
  const now = Math.floor(Date.now() / 1000)
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      user: {
        id: user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: user.email ?? `${user.id}@example.test`,
        app_metadata: {},
        user_metadata: {},
        created_at: new Date(now * 1000).toISOString(),
      },
    }),
  )
}
```

Create `tests/support/render-app.tsx`:

```tsx
import { render, type RenderResult } from '@testing-library/react'
import App from '@/App'

/** Renders the real App — providers, router and RouteGuard intact. */
export function renderApp(route: string): RenderResult {
  window.history.pushState({}, '', route)
  return render(<App />)
}
```

- [ ] **Step 7: Verify the whole suite still passes**

Run: `npm test`
Expected: PASS — 34 existing plus 10 new.

- [ ] **Step 8: Commit**

```bash
git add tests/msw tests/support/session.ts tests/support/render-app.tsx tests/setup-usecases.ts
git commit -m "Add MSW Supabase handlers and app render helpers"
```

---

### Task 4: The gate script

**Files:**
- Create: `scripts/uc-registry.mjs`
- Create: `scripts/uc-check.mjs`
- Create: `docs/use-cases/OPEN-QUESTIONS.md`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `docs/use-cases/registry.yaml`.
- Produces: `scripts/uc-registry.mjs` exporting `loadRegistry()`, `hashUseCase(uc)`, `LOCK_PATH`, `readLock()`, `writeLock(map)`. `scripts/uc-check.mjs` is a CLI accepting `--stage=commit|ci` and `--write-lock`.

- [ ] **Step 1: Create the escalation log**

Create `docs/use-cases/OPEN-QUESTIONS.md`:

```markdown
# Open Questions for the Product Owner

Entries are appended by `scripts/uc-check.mjs` when a use case fails, drifts,
or is edited without authority. Resolve one by picking an option, doing it,
and changing `Status: OPEN` to `Status: RESOLVED <date>`.

Never resolve a question by weakening the assertion in the test.

---

## Q-2026-09-07-01 · UC-P02, UC-P03, UC-P06 · Parent visibility of the child's goals
Raised: 2026-09-07 · seeded during harness design · REQ-004

IN use case 12 of the 2026-07-27 pilot scope reads "Parent sees child's season
band, match feed and coach assessments". The role inventory in the same
document also lists P4, "See child's goals". These disagree.

The registry currently follows the IN list: **parent goal visibility is not a
use case** and `src/pages/parent/ParentGoals.tsx` is therefore untested and
unenforced, despite the route existing.

PO decision needed — one of:
  [ ] IN list stands -> parent goals are out of pilot scope; remove the route
  [ ] Inventory stands -> add UC-P04 to the registry and build it properly
  [ ] Ambiguous -> restate what a parent should see, and the registry follows

Status: OPEN
```

- [ ] **Step 2: Implement the shared registry module**

Create `scripts/uc-registry.mjs`:

```js
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

export const REGISTRY_PATH = resolve('docs/use-cases/registry.yaml')
export const LOCK_PATH = resolve('docs/use-cases/registry.lock.json')
export const QUESTIONS_PATH = resolve('docs/use-cases/OPEN-QUESTIONS.md')

export function loadRegistry() {
  return parse(readFileSync(REGISTRY_PATH, 'utf8'))
}

/**
 * Hashes the product owner's words plus the status. Any edit to given/when/
 * then without a spec_version bump changes this hash and is refused.
 */
export function hashUseCase(uc) {
  const material = JSON.stringify({
    given: uc.given,
    when: uc.when,
    then: uc.then,
    status: uc.status,
  })
  return createHash('sha256').update(material).digest('hex')
}

export function readLock() {
  if (!existsSync(LOCK_PATH)) return null
  return JSON.parse(readFileSync(LOCK_PATH, 'utf8'))
}

export function writeLock(registry) {
  const lock = {}
  for (const uc of registry.use_cases) {
    lock[uc.id] = { spec_version: uc.spec_version, hash: hashUseCase(uc) }
  }
  writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n')
  return lock
}
```

- [ ] **Step 3: Implement the checker**

Create `scripts/uc-check.mjs`:

```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  QUESTIONS_PATH,
  hashUseCase,
  loadRegistry,
  readLock,
  writeLock,
} from './uc-registry.mjs'

const args = process.argv.slice(2)
const stage = (args.find(a => a.startsWith('--stage=')) ?? '--stage=commit').split('=')[1]
const writeLockMode = args.includes('--write-lock')

const TESTS_ROOT = resolve('tests/usecases')
const failures = []

function fail(message) {
  failures.push(message)
  console.error(`  ✗ ${message}`)
}

function findTestFiles() {
  const found = new Map()
  if (!existsSync(TESTS_ROOT)) return found
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      const match = entry.name.match(/^(UC-[A-Z]\d{2})\./)
      if (!match) continue
      const list = found.get(match[1]) ?? []
      list.push(full)
      found.set(match[1], list)
    }
  }
  walk(TESTS_ROOT)
  return found
}

const registry = loadRegistry()

if (writeLockMode) {
  writeLock(registry)
  console.log('registry.lock.json written.')
  process.exit(0)
}

const tests = findTestFiles()

// --- 1. Registry integrity -------------------------------------------------
console.log('Registry integrity')
const seen = new Set()
for (const uc of registry.use_cases) {
  if (seen.has(uc.id)) fail(`Duplicate use-case id ${uc.id}`)
  seen.add(uc.id)
  for (const field of ['actor', 'title', 'requirement', 'status', 'given', 'when', 'then', 'spec_version', 'source']) {
    if (uc[field] === undefined || uc[field] === null || uc[field] === '') {
      fail(`${uc.id} is missing required field "${field}"`)
    }
  }
  if (uc.status === 'enforced' && !tests.has(uc.id)) {
    fail(`${uc.id} is enforced but has no test file under tests/usecases/`)
  }
}
for (const id of tests.keys()) {
  if (!seen.has(id)) fail(`Test file names ${id}, which is not in the registry`)
}
const debt = registry.use_cases.filter(uc => uc.status === 'pending' && !tests.has(uc.id))
if (debt.length) {
  console.log(`  ${debt.length} pending use case(s) with no test yet — coverage debt, not blocking`)
}

// --- 2. Lock check ---------------------------------------------------------
console.log('Lock check')
const lock = readLock()
if (!lock) {
  console.log('  no lock file yet — run: node scripts/uc-check.mjs --write-lock')
} else {
  for (const uc of registry.use_cases) {
    const previous = lock[uc.id]
    if (!previous) continue
    const changed = previous.hash !== hashUseCase(uc)
    if (changed && previous.spec_version === uc.spec_version) {
      fail(
        `${uc.id} spec text changed but spec_version is still ${uc.spec_version}.\n` +
        `      You are editing the product owner's words. Either revert, or have\n` +
        `      the PO bump spec_version and add a changelog entry.`,
      )
    }
  }
}

// --- 3 & 4. Run the tests --------------------------------------------------
function runVitest(files, { blocking }) {
  if (files.length === 0) return true
  try {
    execFileSync('npx', ['vitest', 'run', ...files], { stdio: 'inherit', shell: true })
    return true
  } catch {
    if (blocking) fail('Enforced use-case tests failed')
    return false
  }
}

const enforcedFiles = registry.use_cases
  .filter(uc => uc.status === 'enforced')
  .flatMap(uc => tests.get(uc.id) ?? [])

const pendingFiles = registry.use_cases
  .filter(uc => uc.status === 'pending')
  .flatMap(uc => tests.get(uc.id) ?? [])

console.log(`Enforced use-case tests (${enforcedFiles.length} file(s))`)
runVitest(enforcedFiles, { blocking: true })

if (pendingFiles.length) {
  console.log(`Pending use-case tests (${pendingFiles.length} file(s)) — reporting only`)
  const passed = runVitest(pendingFiles, { blocking: false })
  if (passed) {
    console.log('  All pending use-case tests PASS — flip them to enforced in registry.yaml')
  }
}

// --- Escalation ------------------------------------------------------------
function alreadyOpen(id) {
  if (!existsSync(QUESTIONS_PATH)) return false
  const text = readFileSync(QUESTIONS_PATH, 'utf8')
  const section = text.split('\n## ').find(s => s.includes(id))
  return Boolean(section && /Status: OPEN/.test(section))
}

if (failures.length) {
  const failing = registry.use_cases.filter(
    uc => uc.status === 'enforced' && failures.some(f => f.includes(uc.id)),
  )
  const date = new Date().toISOString().slice(0, 10)
  for (const uc of failing) {
    if (alreadyOpen(uc.id)) continue
    appendFileSync(
      QUESTIONS_PATH,
      [
        '',
        `## Q-${date}-${uc.id} · ${uc.id} · ${uc.title}`,
        `Raised: ${date} · commit blocked · ${uc.requirement}`,
        `Spec (v${uc.spec_version}) says:`,
        ...uc.then.map(t => `  THEN ${t}`),
        '',
        'PO decision needed — one of:',
        '  [ ] Spec stands -> code bug, fix the code, no registry change',
        '  [ ] Spec changes -> bump spec_version, add changelog entry, dev updates test',
        '  [ ] Spec ambiguous -> rewrite given/when/then, bump spec_version',
        'Status: OPEN',
        '',
      ].join('\n'),
    )
    console.error(`  → question appended to docs/use-cases/OPEN-QUESTIONS.md for ${uc.id}`)
  }
  console.error(`\n${failures.length} problem(s). Commit blocked.`)
  process.exit(1)
}

console.log(`\nOK — ${enforcedFiles.length} enforced, ${debt.length} pending without tests. Stage: ${stage}.`)
process.exit(0)
```

- [ ] **Step 4: Add the npm scripts**

In `package.json`, add to `scripts`:

```json
    "uc:check": "node scripts/uc-check.mjs --stage=commit",
    "uc:lock": "node scripts/uc-check.mjs --write-lock",
    "uc:report": "node scripts/uc-report.mjs",
```

- [ ] **Step 5: Generate the lock and run the gate**

```bash
npm run uc:lock
npm run uc:check
```

Expected: lock written; gate prints `0 enforced, 21 pending without tests` and exits 0.

- [ ] **Step 6: Verify the tamper check actually blocks**

```bash
node -e "const f='docs/use-cases/registry.yaml';const s=require('fs').readFileSync(f,'utf8');require('fs').writeFileSync(f,s.replace('No decimal number is rendered anywhere in the UI','Decimals are fine'))"
npm run uc:check
```

Expected: FAIL, exit 1, with `UC-A02 spec text changed but spec_version is still 1`.

Now revert it: `git checkout docs/use-cases/registry.yaml` and re-run `npm run uc:check` — expect exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/uc-registry.mjs scripts/uc-check.mjs docs/use-cases/OPEN-QUESTIONS.md docs/use-cases/registry.lock.json package.json
git commit -m "Add use-case gate script with lock-based tamper evidence"
```

---

### Task 5: The report generator and the pre-commit hook

**Files:**
- Create: `scripts/uc-report.mjs`
- Create: `.husky/pre-commit`
- Modify: `package.json`

**Interfaces:**
- Consumes: `scripts/uc-registry.mjs` from Task 4.
- Produces: `docs/use-cases/README.md`, regenerated on demand.

- [ ] **Step 1: Implement the report generator**

Create `scripts/uc-report.mjs`:

```js
#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadRegistry } from './uc-registry.mjs'

const registry = loadRegistry()
const byStatus = s => registry.use_cases.filter(uc => uc.status === s)

const section = (heading, rows) => [
  `## ${heading} — ${rows.length}`,
  '',
  '| ID | Actor | Use case | Requirement | Tier |',
  '|----|-------|----------|-------------|------|',
  ...rows.map(uc => `| ${uc.id} | ${uc.actor} | ${uc.title} | ${uc.requirement} | ${uc.tier.join(', ')} |`),
  '',
].join('\n')

const out = [
  '<!-- Generated by scripts/uc-report.mjs. Do not edit by hand. -->',
  '',
  '# Trak Use Cases',
  '',
  `Owner: ${registry.owner}`,
  '',
  'Enforced use cases block commits when they fail. Pending ones are reported',
  'but do not block. Parked ones never run.',
  '',
  section('Enforced', byStatus('enforced')),
  section('Pending', byStatus('pending')),
  section('Parked', byStatus('parked')),
].join('\n')

writeFileSync(resolve('docs/use-cases/README.md'), out)
console.log('docs/use-cases/README.md regenerated.')
```

- [ ] **Step 2: Generate and eyeball it**

```bash
npm run uc:report
head -20 docs/use-cases/README.md
```

Expected: a table with 21 pending entries and empty enforced/parked sections.

- [ ] **Step 3: Install husky and add the hook**

```bash
npm install --save-dev husky
npx husky init
```

`npx husky init` writes a `.husky/pre-commit` containing `npm test` and adds a `prepare` script. Replace the hook body:

```sh
npm run uc:check
```

- [ ] **Step 4: Verify the hook fires**

```bash
git add -A
git commit -m "chore: verify hook fires"
```

Expected: the gate output appears before the commit succeeds. If it does not, check that `.git/hooks` is not overriding `core.hooksPath` — run `git config core.hooksPath` and expect `.husky/_`.

- [ ] **Step 5: Commit**

```bash
git add scripts/uc-report.mjs docs/use-cases/README.md .husky package.json package-lock.json
git commit -m "Add use-case report generator and pre-commit hook"
```

---

### Task 6: UC-C02 — coach adds a player to the squad

**Files:**
- Create: `tests/usecases/coach/UC-C02.add-player.test.tsx`

**Interfaces:**
- Consumes: `useCase` (Task 2); `renderApp`, `signInAs`, `server`, `table`, `insertInto` (Task 3).
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `tests/usecases/coach/UC-C02.add-player.test.tsx`:

```tsx
import { it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { table, insertInto } from '../../msw/supabase'

const COACH = { id: 'coach-1' }

function signedInCoach() {
  signInAs(COACH)
  server.use(
    table('profiles', [
      { id: 'p-coach', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', nationality: 'GR' },
    ]),
  )
}

useCase('UC-C02', () => {
  it('persists a squad_players row against that coach', async () => {
    signedInCoach()
    const inserted: Record<string, unknown>[] = []
    server.use(
      insertInto('squad_players', body => {
        inserted.push(body)
        return { id: 'squad-1', ...body }
      }),
      table('squad_players', []),
    )

    renderApp('/coach/squad/add')
    const user = userEvent.setup()

    const nameInput = await screen.findByRole('textbox')
    await user.type(nameInput, 'Nikos Papadopoulos')
    await user.click(screen.getByRole('button', { name: /add to squad/i }))

    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toMatchObject({
      coach_user_id: COACH.id,
      player_name: 'Nikos Papadopoulos',
    })
  })

  it('returns the coach to the squad screen after saving', async () => {
    signedInCoach()
    server.use(
      insertInto('squad_players', body => ({ id: 'squad-1', ...body })),
      table('squad_players', [
        { id: 'squad-1', coach_user_id: COACH.id, player_name: 'Nikos Papadopoulos', position: null, shirt_number: null },
      ]),
    )

    renderApp('/coach/squad/add')
    const user = userEvent.setup()

    await user.type(await screen.findByRole('textbox'), 'Nikos Papadopoulos')
    await user.click(screen.getByRole('button', { name: /add to squad/i }))

    expect(await screen.findByText('SQUAD')).toBeInTheDocument()
  })

  it('refuses to save while the name is empty', async () => {
    signedInCoach()
    const inserted: unknown[] = []
    server.use(
      insertInto('squad_players', body => { inserted.push(body); return { id: 'x', ...body } }),
    )

    renderApp('/coach/squad/add')
    const save = await screen.findByRole('button', { name: /add to squad/i })

    expect(save).toBeDisabled()
    expect(inserted).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Install the user-event dependency**

```bash
npm install --save-dev @testing-library/user-event
```

- [ ] **Step 3: Run it and watch it fail or pass**

Run: `npx vitest run tests/usecases/coach/UC-C02.add-player.test.tsx`

UC-C02 is one of the six believed to work, so this may pass first time. That is acceptable here — the test is being written against the registry's words, not against a change. **If it fails, do not edit the test to match the code.** Read the failure: if the app genuinely does not satisfy the registry text, that is a real finding — record it and raise it rather than softening the assertion.

- [ ] **Step 4: Confirm no unhandled Supabase requests**

The setup uses `onUnhandledRequest: 'error'`. If the run reports one, add the missing handler to the test rather than relaxing the setting.

- [ ] **Step 5: Commit**

```bash
git add tests/usecases/coach/UC-C02.add-player.test.tsx package.json package-lock.json
git commit -m "Add UC-C02 tier-1 test: coach adds a squad player"
```

---

### Task 7: UC-C03 — coach views the squad, with empty and failed states distinguished

**Files:**
- Create: `tests/usecases/coach/UC-C03.view-squad.test.tsx`

**Interfaces:**
- Consumes: the same helpers as Task 6, plus `tableError` from `tests/msw/supabase.ts`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `tests/usecases/coach/UC-C03.view-squad.test.tsx`:

```tsx
import { it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { table, tableError } from '../../msw/supabase'

const COACH = { id: 'coach-1' }

function signedInCoach() {
  signInAs(COACH)
  server.use(
    table('profiles', [
      { id: 'p-coach', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', nationality: 'GR' },
    ]),
  )
}

useCase('UC-C03', () => {
  it('lists every player in the coach squad', async () => {
    signedInCoach()
    server.use(
      table('squad_players', [
        { id: 's1', coach_user_id: COACH.id, player_name: 'Nikos Papadopoulos', position: 'Midfielder', shirt_number: 8 },
        { id: 's2', coach_user_id: COACH.id, player_name: 'Giorgos Andreou', position: 'Defender', shirt_number: 4 },
      ]),
    )

    renderApp('/coach/squad')

    expect(await screen.findByText('Nikos Papadopoulos')).toBeInTheDocument()
    expect(screen.getByText('Giorgos Andreou')).toBeInTheDocument()
  })

  it('shows an explicit empty message for a coach with no players', async () => {
    signedInCoach()
    server.use(table('squad_players', []))

    renderApp('/coach/squad')

    expect(await screen.findByText(/no players in your squad yet/i)).toBeInTheDocument()
  })

  // This is the assertion the audit's "false empty state" defect fails.
  // A permission-denied read currently renders identically to an empty squad.
  it('distinguishes a failed load from an empty squad', async () => {
    signedInCoach()
    server.use(
      tableError('squad_players', 401, { code: '42501', message: 'permission denied for table squad_players' }),
    )

    renderApp('/coach/squad')

    const emptyMessage = await screen.findByText(/no players in your squad yet/i).catch(() => null)
    expect(
      emptyMessage,
      'A failed load must not render the empty-squad message. ' +
      'See UC-C03 and UC-X02 in docs/use-cases/registry.yaml.',
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/usecases/coach/UC-C03.view-squad.test.tsx`

Expected: the first two PASS, **the third FAILS**. `CoachSquadPage` destructures only `{ data }` and falls back to `[]`, so an error renders the empty message. This is a genuine defect the registry text forbids.

- [ ] **Step 3: Do not fix the app in this task**

This plan's scope is the harness, not the application. The third assertion documents a real defect. Set UC-C03's status to `pending` — not `enforced` — in Task 12, and record the finding. Fixing `CoachSquadPage` (and the identical pattern in `PlayerMatches`, `ParentHome`, `ParentMatches`) is separate work.

Add this line to `docs/use-cases/OPEN-QUESTIONS.md` under a new heading:

```markdown
## Q-2026-09-07-02 · UC-C03, UC-X02 · Failed loads render as empty states
Raised: 2026-09-07 · found while writing UC-C03 · REQ-004

Every list screen destructures only `{ data }` from Supabase and falls back to
`[]`, so a permission failure, a network failure and a genuinely empty result
render the same message. Confirmed in `src/pages/coach/CoachSquadPage.tsx:19`;
the same pattern is in `PlayerMatches.tsx`, `ParentHome.tsx`, `ParentMatches.tsx`.

UC-C03 and UC-X02 both forbid this. UC-C03 therefore stays `pending`.

PO decision needed — one of:
  [ ] Spec stands -> fix the four screens to show a retryable error
  [ ] Spec changes -> bump spec_version and state what a failed load may show
Status: OPEN
```

- [ ] **Step 4: Commit**

```bash
git add tests/usecases/coach/UC-C03.view-squad.test.tsx docs/use-cases/OPEN-QUESTIONS.md
git commit -m "Add UC-C03 tier-1 test; record false-empty-state defect"
```

---

### Task 8: UC-C04 — coach assesses a player on six sliders

**Files:**
- Create: `tests/usecases/coach/UC-C04.assess-player.test.tsx`

**Interfaces:**
- Consumes: the same helpers as Task 6.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `tests/usecases/coach/UC-C04.assess-player.test.tsx`:

```tsx
import { it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { table, insertInto } from '../../msw/supabase'

const COACH = { id: 'coach-1' }
const SQUAD = [
  { id: 'squad-1', coach_user_id: COACH.id, player_name: 'Nikos Papadopoulos', position: 'Midfielder', shirt_number: 8 },
]

function signedInCoachWithSquad() {
  signInAs(COACH)
  server.use(
    table('profiles', [
      { id: 'p-coach', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', nationality: 'GR' },
    ]),
    table('squad_players', SQUAD),
  )
}

useCase('UC-C04', () => {
  it('persists all six category scores', async () => {
    signedInCoachWithSquad()
    const inserted: Record<string, unknown>[] = []
    server.use(
      insertInto('coach_assessments', body => {
        inserted.push(body)
        return { id: 'assess-1', ...body }
      }),
    )

    renderApp('/coach/assess')
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByRole('combobox'), 'squad-1')
    await user.click(screen.getByRole('button', { name: /submit assessment/i }))

    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toMatchObject({
      coach_user_id: COACH.id,
      squad_player_id: 'squad-1',
      work_rate: 5,
      tactical: 5,
      attitude: 5,
      technical: 5,
      physical: 5,
      coachability: 5,
    })
  })

  it('shows a band derived from the six scores before submitting', async () => {
    signedInCoachWithSquad()
    renderApp('/coach/assess')

    // All six sliders default to 5, which maps to the Mixed band.
    expect(await screen.findByText('Mixed')).toBeInTheDocument()
  })

  it('refuses to submit until a player is selected', async () => {
    signedInCoachWithSquad()
    renderApp('/coach/assess')

    expect(await screen.findByRole('button', { name: /submit assessment/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/usecases/coach/UC-C04.assess-player.test.tsx`
Expected: PASS, 3 tests. If the band assertion fails, read `scoreToBand(5)` against `BANDS` in `src/lib/types.ts:23` and use the band the engine actually returns — the registry says "a band derived from the six scores", not which one.

- [ ] **Step 3: Commit**

```bash
git add tests/usecases/coach/UC-C04.assess-player.test.tsx
git commit -m "Add UC-C04 tier-1 test: coach assessment persists six scores"
```

---

### Task 9: UC-A02 — athlete logs a match

**Files:**
- Create: `tests/usecases/athlete/UC-A02.log-match.test.tsx`

**Interfaces:**
- Consumes: the same helpers as Task 6.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `tests/usecases/athlete/UC-A02.log-match.test.tsx`:

```tsx
import { it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { table, insertInto } from '../../msw/supabase'

const ATHLETE = { id: 'athlete-1' }

function signedInAthlete() {
  signInAs(ATHLETE)
  server.use(
    table('profiles', [
      { id: 'p-athlete', user_id: ATHLETE.id, role: 'player', full_name: 'Nikos Papadopoulos', nationality: 'GR' },
    ]),
  )
}

async function fillAndSave() {
  const user = userEvent.setup()
  await user.type(await screen.findByPlaceholderText(/arsenal u18/i), 'Olympiacos U17')
  await user.click(screen.getByRole('button', { name: /^save match$/i }))
  return user
}

useCase('UC-A02', () => {
  it('persists a matches row with a computed rating', async () => {
    signedInAthlete()
    const inserted: Record<string, unknown>[] = []
    server.use(
      insertInto('matches', body => {
        inserted.push(body)
        return { id: 'match-1', created_at: new Date().toISOString(), ...body }
      }),
    )

    renderApp('/player/log')
    await fillAndSave()

    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toMatchObject({ user_id: ATHLETE.id })
    expect(typeof inserted[0].computed_rating).toBe('number')
  })

  it('takes the athlete to the result screen for that match', async () => {
    signedInAthlete()
    server.use(
      insertInto('matches', body => ({
        id: 'match-1',
        created_at: new Date().toISOString(),
        ...body,
      })),
    )

    renderApp('/player/log')
    await fillAndSave()

    expect(await screen.findByRole('button', { name: /^done$/i })).toBeInTheDocument()
  })

  it('renders no decimal number anywhere in the UI', async () => {
    signedInAthlete()
    server.use(
      insertInto('matches', body => ({
        id: 'match-1',
        created_at: new Date().toISOString(),
        ...body,
      })),
    )

    const { container } = renderApp('/player/log')
    await fillAndSave()
    await screen.findByRole('button', { name: /^done$/i })

    const visibleText = container.textContent ?? ''
    expect(
      visibleText,
      'UC-A02 forbids showing the hidden score. Found a decimal in the rendered output.',
    ).not.toMatch(/\d+\.\d+/)
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/usecases/athlete/UC-A02.log-match.test.tsx`
Expected: PASS, 3 tests. The form's save button is disabled until `opponent` is non-empty, which is why the helper types an opponent first.

- [ ] **Step 3: Commit**

```bash
git add tests/usecases/athlete/UC-A02.log-match.test.tsx
git commit -m "Add UC-A02 tier-1 test: athlete logs a match"
```

---

### Task 10: UC-A03 — athlete sees the band result

**Files:**
- Create: `tests/usecases/athlete/UC-A03.band-result.test.tsx`

**Interfaces:**
- Consumes: the same helpers as Task 6, plus `BANDS` from `@/lib/types`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `tests/usecases/athlete/UC-A03.band-result.test.tsx`:

```tsx
import { it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { table, insertInto } from '../../msw/supabase'
import { BANDS } from '@/lib/types'
import { scoreToBand } from '@/lib/rating-engine'

const ATHLETE = { id: 'athlete-1' }

function signedInAthlete() {
  signInAs(ATHLETE)
  server.use(
    table('profiles', [
      { id: 'p-athlete', user_id: ATHLETE.id, role: 'player', full_name: 'Nikos Papadopoulos', nationality: 'GR' },
    ]),
  )
}

async function logAMatch() {
  let saved: Record<string, unknown> | null = null
  server.use(
    insertInto('matches', body => {
      saved = { id: 'match-1', created_at: new Date().toISOString(), ...body }
      return saved
    }),
  )
  renderApp('/player/log')
  const user = userEvent.setup()
  await user.type(await screen.findByPlaceholderText(/arsenal u18/i), 'Olympiacos U17')
  await user.click(screen.getByRole('button', { name: /^save match$/i }))
  await screen.findByRole('button', { name: /^done$/i })
  return () => saved
}

useCase('UC-A03', () => {
  it('shows the band word for the computed score', async () => {
    signedInAthlete()
    const getSaved = await logAMatch()

    const score = getSaved()!.computed_rating as number
    const expectedWord = BANDS.find(b => b.word.toLowerCase() === scoreToBand(score))!.word

    expect(screen.getAllByText(expectedWord).length).toBeGreaterThan(0)
  })

  it('renders the band word in that band configured colour', async () => {
    signedInAthlete()
    const getSaved = await logAMatch()

    const score = getSaved()!.computed_rating as number
    const config = BANDS.find(b => b.word.toLowerCase() === scoreToBand(score))!
    const headline = screen.getAllByText(config.word)[0]

    expect(headline).toHaveStyle({ color: config.color })
  })

  it('renders no decimal number anywhere in the UI', async () => {
    signedInAthlete()
    const { container } = renderApp('/player/log')
    const user = userEvent.setup()
    server.use(
      insertInto('matches', body => ({ id: 'match-1', created_at: new Date().toISOString(), ...body })),
    )
    await user.type(await screen.findByPlaceholderText(/arsenal u18/i), 'Olympiacos U17')
    await user.click(screen.getByRole('button', { name: /^save match$/i }))
    await screen.findByRole('button', { name: /^done$/i })

    expect(container.textContent ?? '').not.toMatch(/\d+\.\d+/)
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/usecases/athlete/UC-A03.band-result.test.tsx`
Expected: PASS, 3 tests. `PlayerResult` renders the band word twice — once as the large headline with an inline `color` style and once inside `BandPill` — hence `getAllByText`.

- [ ] **Step 3: Commit**

```bash
git add tests/usecases/athlete/UC-A03.band-result.test.tsx
git commit -m "Add UC-A03 tier-1 test: band result screen"
```

---

### Task 11: UC-A04 — athlete views match history

**Files:**
- Create: `tests/usecases/athlete/UC-A04.match-history.test.tsx`

**Interfaces:**
- Consumes: the same helpers as Task 6, plus `tableError`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `tests/usecases/athlete/UC-A04.match-history.test.tsx`:

```tsx
import { it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { table, tableError } from '../../msw/supabase'

const ATHLETE = { id: 'athlete-1' }

function signedInAthlete() {
  signInAs(ATHLETE)
  server.use(
    table('profiles', [
      { id: 'p-athlete', user_id: ATHLETE.id, role: 'player', full_name: 'Nikos Papadopoulos', nationality: 'GR' },
    ]),
  )
}

const MATCH = {
  id: 'match-1',
  user_id: ATHLETE.id,
  created_at: '2026-09-01T18:00:00.000Z',
  team_score: 2,
  opponent_score: 1,
  computed_rating: 7.4,
}

useCase('UC-A04', () => {
  it('shows every logged match as a card', async () => {
    signedInAthlete()
    server.use(table('matches', [MATCH]))

    renderApp('/player/matches')

    expect(await screen.findByText('MATCH HISTORY')).toBeInTheDocument()
    expect(screen.getByText('2-1')).toBeInTheDocument()
  })

  it('shows an explicit empty message when nothing has been logged', async () => {
    signedInAthlete()
    server.use(table('matches', []))

    renderApp('/player/matches')

    expect(await screen.findByText(/no matches yet/i)).toBeInTheDocument()
  })

  it('distinguishes a failed load from an empty history', async () => {
    signedInAthlete()
    server.use(tableError('matches', 401, { code: '42501', message: 'permission denied for table matches' }))

    renderApp('/player/matches')

    await screen.findByText('MATCH HISTORY')
    const emptyMessage = screen.queryByText(/no matches yet/i)
    expect(
      emptyMessage,
      'A failed load must not render the empty-history message. See UC-A04 and UC-X02.',
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/usecases/athlete/UC-A04.match-history.test.tsx`
Expected: the first two PASS, **the third FAILS** — the same false-empty-state defect as UC-C03, in `PlayerMatches.tsx:18`.

- [ ] **Step 3: Leave the defect recorded, not fixed**

Q-2026-09-07-02 in `OPEN-QUESTIONS.md` already names `PlayerMatches.tsx`. UC-A04 therefore stays `pending` in Task 12 alongside UC-C03.

- [ ] **Step 4: Commit**

```bash
git add tests/usecases/athlete/UC-A04.match-history.test.tsx
git commit -m "Add UC-A04 tier-1 test: athlete match history"
```

---

### Task 12: Enforce what passes, regenerate the lock, verify the gate

**Files:**
- Modify: `docs/use-cases/registry.yaml`
- Modify: `docs/use-cases/registry.lock.json`
- Modify: `docs/use-cases/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a gate with four enforced use cases.

- [ ] **Step 1: Confirm which use cases actually pass**

Run: `npx vitest run tests/usecases`
Expected: UC-A02, UC-A03, UC-C02, UC-C04 fully pass. UC-C03 and UC-A04 each have one failing assertion, both from the false-empty-state defect.

- [ ] **Step 2: Set status to enforced for the four that pass**

In `docs/use-cases/registry.yaml`, change `status: pending` to `status: enforced` for exactly `UC-A02`, `UC-A03`, `UC-C02`, `UC-C04`.

Leave `UC-C03` and `UC-A04` as `pending`. Their tests still run and report; they simply do not block until the defect is fixed. This is the ratchet working as designed — a use case is enforced only once the application actually satisfies it.

- [ ] **Step 3: Regenerate lock and report**

```bash
npm run uc:lock
npm run uc:report
```

The status field is part of the hash, so the lock must be regenerated whenever a status changes. `spec_version` does not need bumping for a status change — only for edits to `given`/`when`/`then`.

- [ ] **Step 4: Verify the gate is green**

Run: `npm run uc:check`
Expected: exit 0. Output reports 4 enforced files run and passing, 2 pending files reporting one failure each, and 15 pending use cases with no test.

- [ ] **Step 5: Verify the gate actually blocks a regression**

```bash
node -e "const f='src/lib/rating-engine.ts';const s=require('fs').readFileSync(f,'utf8');require('fs').writeFileSync(f,s.replace('export function computeMatchScore','export function computeMatchScore_DISABLED'))"
npm run uc:check
```

Expected: FAIL, exit 1, and a `Q-<date>-UC-A02` entry appended to `OPEN-QUESTIONS.md`.

Run `npm run uc:check` a second time and confirm **no duplicate** question is appended.

Then restore: `git checkout src/lib/rating-engine.ts` and remove the generated question block from `OPEN-QUESTIONS.md`. Re-run `npm run uc:check` — expect exit 0.

- [ ] **Step 6: Verify the full suite and the timing budget**

```bash
npm test
```

Expected: all pre-existing 34 tests still pass alongside the new ones.

Time the gate: `node -e "const t=Date.now();require('child_process').execSync('npm run uc:check',{stdio:'inherit'});console.error('elapsed ms', Date.now()-t)"`
Expected: under 20000. If it exceeds that, report the number rather than silently accepting it.

- [ ] **Step 7: Commit**

```bash
git add docs/use-cases/registry.yaml docs/use-cases/registry.lock.json docs/use-cases/README.md
git commit -m "Enforce UC-A02, UC-A03, UC-C02 and UC-C04"
```

---

## Self-Review

**Spec coverage.** Registry schema → Task 1. `useCase()` binding → Task 2. MSW at the HTTP boundary and the empty/blocked/offline distinction → Tasks 3, 7, 11. Gate mechanics steps 1–4 → Task 4. Report generator and hook → Task 5. Escalation artifact and duplicate suppression → Task 4 plus Task 12 step 5. `registry.lock.json` tamper evidence → Task 4 steps 2, 6. Six Phase-1 tests → Tasks 6–11. Status ratchet → Task 12.

**Deviations from the spec, deliberate and stated:**
- The spec projected **six** enforced entries after Phase 1. This plan enforces **four**. UC-C03 and UC-A04 each assert the empty/blocked distinction that the spec's own tier-1 rule requires, and the application fails it. Enforcing them would make the gate red on arrival, which the design explicitly forbids. The defect is recorded as Q-2026-09-07-02 instead.
- Gate step 5, the untracked-surface warning, is **not** implemented. It warns only and never blocks, so it carries no protective value in Phase 0/1; it belongs with the Phase 3 CI work where the report has somewhere to surface.
- Tier-2 (Playwright, local Supabase, RLS) is Phase 2 and out of scope here, as is the CI step, which lands with PR #4's workflow.

**Placeholder scan.** No TBDs. Every code step carries complete code. Every command has an expected result.

**Type consistency.** `UseCase`/`Registry` from Task 1 are used unchanged in Tasks 2 and 4. `table`, `tableError`, `tableNetworkError`, `insertInto`, `authHandlers` defined in Task 3 are used with those exact names in Tasks 6–11. `signInAs` and `renderApp` are consistent throughout. `hashUseCase` covers `given`/`when`/`then`/`status`, which is why Task 12 step 3 regenerates the lock after a status change — consistent with Task 4's implementation.

**Known risk.** `tableNetworkError` is exported in Task 3 but not consumed by any task. It is the handler UC-X02 will need. Either use it in a UC-X02 test or drop it — do not leave dead exports.
