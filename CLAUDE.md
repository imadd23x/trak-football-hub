# CLAUDE.md — Trak Football

Quick orientation for AI agents and new contributors.

## Current work and coordination

Read [the September 25 pilot plan](docs/pilot-readiness-2026-09-25.md) and [the release gate](docs/release/merge-gate.md) first. `docs/pm/STATE.md` and `docs/features-outstanding.md` are historical, not current readiness evidence. Read the actual route and callers before fixing a component; `CoachQuickMatchLog` is currently unrouted.

Use task branches (`parent/`, `coach/`, `player/`, `shared/`), never main. Announce migrations and shared-file changes in #coding-agent-reviews before editing. Imad coordinates merges; his own PRs require Kostas or Tarek's approval. Never apply development SQL to the shared live Supabase project. Use a disposable local database and new migrations; production deployment follows reviewed merges.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS (dark theme, DM Sans + DM Mono fonts) |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) |
| Testing | Vitest + React Testing Library |
| Linting | ESLint 9 (flat config) |
| Monitoring | Sentry (PROD only) |

## Key File Locations

| What | Where |
|---|---|
| Auth state + sign-up flow | `src/contexts/AuthContext.tsx` |
| Rating algorithm | `src/lib/rating-engine.ts` |
| Band config (colors, words) | `src/lib/types.ts` — `BANDS` constant |
| Supabase client | `src/integrations/supabase/client.ts` |
| Route definitions | `src/App.tsx` |
| Route guard (role-based) | `src/components/layout/RouteGuard.tsx` |
| Shared components | `src/components/trak/` |
| Navigation bar | `src/components/trak/NavBar.tsx` |
| Error boundary | `src/components/trak/ErrorBoundary.tsx` |
| Database migrations | `supabase/migrations/` (apply in filename order) |
| Coach AI edge function | `supabase/functions/coach-assistant/` |

## Common Patterns

### Supabase queries
Use `.maybeSingle()` when zero or one row is expected. Use arrays for one-to-many relationships such as a parent's children. Always inspect query errors; a failed request is not an empty result.

```tsx
const { data } = await supabase
  .from('profiles')
  .select('full_name')
  .eq('user_id', userId)
  .maybeSingle()   // ← never .single()
```

### Assessments — squad_player_id ≠ user_id
`coach_assessments.squad_player_id` is a row ID in `squad_players`, NOT a `user_id`. To fetch a player's assessments:

```tsx
const { data: squadRows } = await supabase
  .from('squad_players').select('id').eq('linked_player_id', user.id)
const ids = squadRows?.map(r => r.id) ?? []
const { data: assessments } = await supabase
  .from('coach_assessments').select('*').in('squad_player_id', ids)
```

### Match logging for coach
Direct insert to `matches` is blocked by RLS (coach ≠ player). Use the SECURITY DEFINER RPC:

```tsx
await supabase.rpc('log_match_for_player', {
  p_user_id: playerUserId,
  p_opponent: '...',
  // ...
})
```

### Component structure
All pages use `<MobileShell>` as the root wrapper with max-width 430px.
Colours and fonts follow the dark design system — never use hardcoded colour strings outside of the `BANDS` config.

### Band → colour mapping
```tsx
import { BANDS } from '@/lib/types'
import { scoreToBand } from '@/lib/rating-engine'

const band = scoreToBand(score)           // 'steady' | 'good' | etc.
const cfg  = BANDS.find(b => b.word.toLowerCase() === band)
// cfg.color — hex/rgba colour string
// cfg.word  — display word e.g. "Steady"
```

## Running Locally

```bash
npm ci --legacy-peer-deps
cp .env.example .env   # fill in Supabase URL + anon key
npm run dev            # http://localhost:8080
npm test              # source tests, once
npm run test:harness  # MSW and use-case harness contracts
npm run typecheck
npm run uc:check      # enforced use cases block; pending failures are reported
npm run build          # production build
```

## Dev Accounts (local seed)

Use the explicit-target [synthetic demo tooling](docs/demo-data.md). Planning is
read-only; generated passwords stay in a private ignored local file. The legacy
seed/purge scripts are retired. `/dev-setup` still uses outdated provisioning
paths and is not evidence that the current admission or consent gates work.
Its quick-login credentials come from local `VITE_DEV_PASSWORD` and sign-in is
refused when it is unset. A frontend environment variable is not a server secret;
never put a service key or production password there.

This file previously claimed credentials had never been committed. That was not
true: password literals in `LandingPage.tsx`, `DevSetupPage.tsx` and
`DevSwitcher.tsx` shipped to public visitors. Do not reintroduce a literal —
`import.meta.env.DEV` guards which routes register, not which chunks Rollup emits.

## TDD Workflow

Tests live alongside source in `src/**/__tests__/` and `src/__tests__/`.
Run `npm run test:watch` while making changes. Add focused regression coverage for changed security and user journeys.
CI fails for enforced tests/build errors. Pending use-case failures currently do not block CI; review them explicitly. Branch protection must be independently enabled before CI can enforce a merge gate.

## Database Migrations

Create a new migration using the Supabase CLI; never edit existing migration files. Replay migrations in order on a disposable database and test with actual authenticated roles. Do not assume individual historical migrations are safe to rerun. The main CI workflow applies pending migrations and deploys edge functions before the frontend.

Since `20260919120001`, new tables in `public` are born with no privileges for `anon` or `authenticated`. A migration that creates a table must `GRANT` exactly the operations its policies back (see `20260918000002_ai_call_quota.sql` for the pattern); `anon` needs nothing.

Key migrations to be aware of:
- `20260425000001_security_hardening.sql` — RLS policies + performance indexes
- `20260526000002_rls_explicit_operations.sql` — replaces FOR ALL with explicit ops
- `20260526000003_gdpr_delete_account.sql` — `delete_my_account()` RPC

## Deployment

Production is hosted on Vercel at `trakfootball.com` (auto-deploys from `main`).
`vercel.json` holds the SPA rewrite, the long-cache rules for `/assets` and `/fonts`, and the
security headers — the CSP there pins the Supabase and Sentry hosts, so a new external origin
needs adding to `connect-src` or it will be blocked in production.

Supabase project is at `xbykbqolvqyqmipikuae.supabase.co`.

Lovable is no longer the host, but three edge functions still call its AI gateway with
`LOVABLE_API_KEY` — `coach-assistant`, `parse-schedule` and `player-feedback`.
