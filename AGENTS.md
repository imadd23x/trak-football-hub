# AGENTS.md — Trak Football

## Before changing the product

**Delivery policy:** before starting work on any branch, read the [current canonical delivery policy](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/blob/main/docs/release/merge-gate.md). It governs branch work, completion, merging and deployment across Linear, PR descriptions and historical plans. Use issue descriptions for product acceptance and explicit scope holds. Historical process instructions are reference material, not delivery requirements.

Read the assigned issue’s current description and relevant requirements in
[MVP Requirements](MVP%20Requirements). Fetch comments only to resolve a
specific missing fact; follow links on demand instead of loading their history.
The first real-child pilot requires J1–J8 and G1–G7; J8 events are required
but still await implementation and rehearsal. A configured date never admits
children. [PILOT-INDEX](docs/use-cases/PILOT-INDEX.md) separates required scope
from recorded deployment evidence.

Agents work their human's assigned issues. Use a task branch and one PR per
issue, with its `TRAK-#` and J/G or scope/launch-gate purpose in the title.
Work and commit freely on personal branches. Local tests are optional debugging
tools. Draft PRs are work in progress; mark ready when submitting the final
candidate to the [automated merge gate](docs/release/merge-gate.md). No teammate,
non-author, agent-review or verification sign-off is required. These project
rules replace generic skill requirements for per-step tests and approval loops.
Credential checks block pushes, including secrets removed in a later commit.

Mark an issue **Done when implementation is complete**, with a short result,
PR/commit link and honest merge/deployment status. Live-test afterward. A failure
gets a **new linked bug issue** with its own reproduction and acceptance; the
completed issue stays Done. Verifying is retired from the delivery workflow.
Coordinate actual shared-file collisions without waiting for routine sign-off.

This repository is public. Keep academy identities, competitor analysis and
private meeting/artifact links out of new documentation and evidence. Use
synthetic identities in public test records. Current unresolved decisions stay
explicitly open; an issue being Done does not prove a newer requirement passed.

## Find the implementation

| Task | Start here |
|---|---|
| Routes, parked screens and callers | `src/App.tsx`, then the routed component |
| Role guard | `src/components/layout/RouteGuard.tsx` |
| Authentication and admission | `src/contexts/AuthContext.tsx`, `src/lib/parent-consent.ts` |
| Database client and generated types | `src/integrations/supabase/` |
| Rating and bands | `src/lib/rating-engine.ts`, `src/lib/types.ts` (`BANDS`) |
| Shared UI | `src/components/trak/` |
| Backend permissions and RPCs | `supabase/migrations/` in filename order |
| Pilot operations and recovery | `docs/pilot-runbook.md`, `docs/release/s5-restore-rehearsal.md` |
| Use-case contracts | `docs/use-cases/registry.yaml`, `docs/use-cases/OPEN-QUESTIONS.md` |

Read the actual route and its callers before editing a component.
`CoachQuickMatchLog` is not the routed J4 match entry. `/coach/quick-assess`
remains hidden; the pilot uses `/coach/assess`. Existing AI handlers return
`PILOT_FEATURE_DISABLED`; their presence is not permission to enable them.

## Data and UI conventions

- Use `.maybeSingle()` when zero or one row is expected, arrays for one-to-many
  relationships, and handle errors separately from empty results.
- `coach_assessments.squad_player_id` refers to a `squad_players` row, not an
  Auth user ID. Resolve the player's squad rows before querying assessments.
- Coach match logging uses `log_match_for_player`; direct inserts do not
  substitute for its consent and assignment checks.
- Follow the existing mobile shell and design tokens. Use `BANDS` for band
  wording and colors; keep player-visible messages separate from private notes.
- The roster owns the child's name. A child email is optional. Use the existing
  guardian-created login/recovery flow for a child without email (TRAK-84).
- The consent screen must offer only choices the backend enforces. The
  unenforced "I can see their progress" box was removed for that reason
  (TRAK-145, notice `2026-10-09.1`); bump `CONSENT_NOTICE_VERSION` whenever the
  wording changes. Family reads follow active consent; the known gap is a
  withdrawn child's own attendance (TRAK-147). Squad events follow consent
  since J8.2 (TRAK-125, #254). A published event is cancelled, never deleted.

## Local work and checks

Use Node 22.15+ within 22.x and the npm version in `package.json`.

Install with `npm ci --legacy-peer-deps`; start with `npm run dev`.
See README for setup and `package.json` for optional checks.

`package.json` lists optional local commands. `.github/workflows/ci.yml` runs
the complete required suite once for the final non-draft PR candidate. Reuse
that result rather than running a separate author/reviewer/verification suite.
Workflow actions must run on Node 24: `ci-action-runtimes.test.ts` lists each
action's first such major, and Dependabot opens a weekly grouped PR for newer
ones, reviewed like any other change.
Pending use cases report failures without blocking; they are not passes.
Edit `registry.yaml`, then regenerate its README with `npm run uc:report`.
Preserve enforced contracts and the registry lock/version rules.

Local dev accounts read `VITE_DEV_PASSWORD`. Keep credentials out of source,
evidence and built assets; a DEV-only route does not guarantee its chunk is
excluded from a production bundle.

## Database and deployment

Create new migrations; keep applied migration history unchanged. Replay on a
disposable database and test permissions under real authenticated roles. Some
historical migrations cannot safely be rerun. New public tables start without
`anon`/`authenticated` privileges; grant only operations backed by policies.

Production is `trakfootball.com` on Vercel, with Supabase as the backend.
The canonical main workflow first matches its contents to successful final-PR
test evidence, then applies pending migrations and deploys functions before
the frontend. It reuses the merge-gate result instead of rerunning the suite.
Vercel's Git integration and Supabase's automatic Git deployment stay disabled.
A PR preview shares the backend; there is no separate staging environment.
Use the deployment workflow for production changes, never development SQL on
the shared project. Operational recovery lives in the release runbooks.

`supabase/config.toml` controls function JWT settings. `vercel.json` controls
rewrites, caching and CSP; verify allowed origins when adding an integration.
The one CSP exception is `/trainings/*`: the static training pages there may
run inline scripts and be framed by this site only, for the Trainings tab
(`src/pages/TrainingsPage.tsx`). The rest of the site still blocks inline
scripts and refuses to be framed; a test in
`src/pages/__tests__/trainings-tab.test.tsx` guards both.
Email templates run in the Supabase dashboard; CI never deploys them. Read the
email-template notes in the [README](README.md) before touching them. Since
TRAK-142 (#252) the repository copies equal the live ones, and a test guards
them; change both together. Never use
`{{ .ConfirmationURL }}`: Microsoft's link scanner uses up one-click links
(TRAK-107). Signup confirmation has a different flow from the three code emails.
