# Trak Football

Performance tracking app for youth football players, coaches, parents, and club admins.

## Prerequisites

- Node.js 22.15 or later 22.x (matching CI; `.nvmrc` selects the latest 22.x). On 22.14 `npm test` fails with unhandled `BroadcastChannel` errors.
- npm 11.6.0 (the version declared by `packageManager`)
- A [Supabase](https://supabase.com) project (free tier works)

## Local Setup

```bash
# 1. Clone the repo
git clone https://github.com/kostasanastasioubusiness-lang/trak-football-hub.git
cd trak-football-hub

# 2. Select Node 22 and install locked dependencies
# If you use nvm:
nvm install
nvm use
npm ci

# 3. Configure environment
cp .env.example .env
# Edit .env and fill in your Supabase URL and publishable key (sb_publishable_…)

# 4. Apply database migrations
# Open your Supabase project → SQL Editor
# Run each file in supabase/migrations/ in chronological order

# 5. Start the dev server
npm run dev
```

The app runs at http://localhost:8080.

Without nvm, install Node 22 some other way. npm refuses a different Node major (`devEngines` in `package.json`). Don't bypass it: on Node 24 the enforced assessment test (UC-C04) fails because jsdom's AbortSignal is rejected by Node's native `Request`.

## Running Tests

```bash
npm test          # watch mode
npm test -- --run # single run (used in CI)
```

## Linting & Build

```bash
npm run lint      # ESLint — warnings are fine, errors block CI
npm run build     # Vite production build → dist/
```

## Deployment

Production is **trakfootball.com**, hosted on Vercel. Vercel's own Git integration is
disabled (`git.deploymentEnabled: false` in `vercel.json`), so `.github/workflows/ci.yml`
is the only route to a deployment — the `deploy` job needs `test`, meaning nothing
reaches production unless lint, typecheck, tests and build all passed first.

Nothing else auto-deploys. The Supabase half of the app ships separately, and
forgetting this is the usual reason a merged change appears to do nothing:

| What changed | How it ships |
|---|---|
| `src/**` | `deploy` job, on merge to `main` |
| `supabase/migrations/*.sql` | `supabase` job (`db push`), on merge to `main` |
| `supabase/functions/**` | `supabase` job (`functions deploy`), on merge to `main` |
| `email-templates/*.html` | Supabase dashboard → Authentication → Emails → Templates, **by hand**. The files equal the live templates as of 8 Oct 2026; see below. |

Merging to `main` ships the frontend *and* the backend. The `supabase` job runs
before `deploy`, so a build that calls a new RPC can never reach production ahead
of the migration that creates it, and a failed migration stops the frontend from
shipping at all.

The `supabase` job deliberately does not run `supabase link`: linking fetches the
project's API keys, which would mean giving the CI token read access to the
service-role key. It passes `--db-url` and `--project-ref` explicitly instead, so
the token needs only Edge Functions and Migrations. Required secrets:
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_URL`.

### Email templates

The four files in `email-templates/` equal the live Supabase templates as
exported by Kostas on 8 October 2026 (after his 17:19 UTC dashboard fixes;
TRAK-142). The dashboard is where they run: CI does not deploy them. Change a
template in the dashboard and in its file together, in one reviewed PR.

| File | Dashboard template | Subject |
|---|---|---|
| `invite-parent.html` | Invite user | `You're invited to Trak` |
| `magic-link.html` | Magic link / OTP | `{{ if .Data.child_first_name }}{{ .Data.academy_name }} has added {{ .Data.child_first_name }} to Trak{{ else }}Your Trak sign-in code{{ end }}` |
| `reset-password.html` | Reset password | `Reset your Password` |
| `confirm-signup.html` | Confirm signup | `Confirm your Trak Account` |

- **Invite, Magic Link and Reset Password** show `{{ .Token }}` and link only
  to `/auth/code`, where the person types the code. A one-click
  `{{ .ConfirmationURL }}` is what Microsoft's scanner used up before families
  could sign in (TRAK-107).
- **Confirm signup** keeps its separate `/auth/confirm?token_hash=` flow
  (TRAK-117).
- Go evaluates `{{ ... }}` actions even inside HTML comments, so never write
  one in a comment.

`src/__tests__/email-templates.test.ts` fails if any file regains a
`{{ .ConfirmationURL }}` or an `/auth/continue` link, if a code email links
anywhere but `/auth/code`, or if a file contains non-ASCII characters (which
turn into mojibake when Gmail strips the charset).

`supabase/config.toml` is the source of truth for each function's `verify_jwt`;
a value changed in the dashboard is overwritten on the next deploy.

For local work the CLIs need no global install (`npm i -g` fails against a
root-owned prefix on a stock macOS Node):

```bash
npx --yes supabase@latest login
npx --yes supabase@latest migration list
```

`vercel.json` holds the SPA rewrite, asset caching, and the security headers. Its
CSP pins the Supabase and Sentry hosts, so any new external origin must be added
to `connect-src` or it is blocked in production.

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key, `sb_publishable_…` (public; the legacy anon JWT stops working at the end of 2026, TRAK-96) |
| `VITE_SENTRY_DSN` | (Optional) Sentry DSN — only active in `PROD` |

See `.env.example` for the template.

## Project Structure

```
src/
  components/
    trak/           Shared design-system components (MobileShell, NavBar, BandPill, …)
    player/         Player-specific components (RatingTrendChart, CardRevealModal)
    club/           Club-specific components (ClubNavBar)
    icons/          TrakIcons SVG components
  contexts/
    AuthContext.tsx Auth state, sign-up / sign-in, profile creation
  lib/
    rating-engine.ts  computeMatchScore() — core rating algorithm
    types.ts          BANDS, BandType, UserRole
    telemetry.ts      trackEvent() helper
    squad-analytics.ts calculateSquadAnalytics()
  pages/
    player/         PlayerHome, PlayerMatches, PlayerEvolutionCard, PlayerPassport, …
    coach/          CoachHomePage, CoachSquadPage, CoachAssessPage, CoachAssistant, …
    parent/         ParentHome, ParentMatches, ParentAlerts
    club/           ClubHome, ClubSquads, ClubCoaches, ClubRadar
  integrations/
    supabase/       Generated Supabase client + types
supabase/
  migrations/       SQL migration files (apply in order)
  functions/        Edge Functions (coach-assistant, parse-schedule,
                    player-feedback, send-parent-invite)
```

## User Roles

| Role | Sign-up path | Key features |
|---|---|---|
| **Player** | Invite code from coach | Match history, evolution card, passport, coach feedback |
| **Coach** | Direct sign-up | Squad management, assessments, match logging, AI assistant |
| **Parent** | Link token from player | View child's matches, assessments, alerts |
| **Club admin** | Direct sign-up (club role) | Cross-squad overview, movement radar |

## Contributing

1. Create a feature branch off `main`
2. Run `npm test -- --run` and `npm run build` before pushing
3. CI (GitHub Actions) runs lint + test + build automatically on every push
