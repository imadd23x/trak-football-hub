# AGENTS.md — Trak Football

Quick orientation for AI agents and new contributors.

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
| Route guard (role-based) | `src/components/RouteGuard.tsx` |
| Shared components | `src/components/trak/` |
| Navigation bar | `src/components/trak/NavBar.tsx` |
| Error boundary | `src/components/trak/ErrorBoundary.tsx` |
| Database migrations | `supabase/migrations/` (apply in filename order) |
| Coach AI edge function | `supabase/functions/coach-assistant/` |
| Pilot scope: P0 journeys, coming soon, launch gate | `MVP Requirements` (progress: `docs/use-cases/PILOT-INDEX.md`) |
| Strategic review — workshop outputs and prototype bet | `StrategicReview/` (start at `README.md`) |

## Common Patterns

### Supabase queries
Always use `.maybeSingle()` (not `.single()`) when a row might not exist — `.single()` throws on no row.

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
npm install
cp .env.example .env   # fill in Supabase URL + anon key
npm run dev            # http://localhost:8080
npm test -- --run      # run tests once
npm run build          # production build
```

## Dev Accounts (local seed)

Use the DevSetupPage (`/dev-setup`, PIN: `013`) to quick-login as any test role.
Real credentials live in your local Supabase project — never committed.

## TDD Workflow

Tests live alongside source in `src/**/__tests__/` and `src/__tests__/`.
Run `npm test` (watch mode) while making changes.
CI blocks merges if any test fails or the build errors.

## Database Migrations

Apply migrations in filename order via Supabase SQL Editor (Supabase CLI not required).
All migrations use `IF NOT EXISTS` / `IF EXISTS` guards — safe to re-run.

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
