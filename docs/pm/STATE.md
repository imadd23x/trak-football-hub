# State: Trak Football
> **Historical — superseded September 18, 2026.** This May status is not a readiness assessment. Use [the current pilot plan](../pilot-readiness-2026-09-25.md), current source and deployment evidence. Completion claims below are preserved as history only.

Last Updated: 2026-05-26

## Summary

The core loop for all 4 user roles is built and working. The codebase is in a
production-readiness pass before the pilot launch (~15 players, 2 coaches, 15 parents).

| Milestone | Status |
|---|---|
| Foundation (scaffold, Tailwind, fonts, Supabase, rating engine, UI) | ✅ Complete |
| Auth + Onboarding (all 4 roles) | ✅ Complete |
| Player Core (match log, home, history, evolution card, passport) | ✅ Complete |
| Coach Core (squad, assessments, session log, awards, AI assistant, calendar) | ✅ Complete |
| Parent Core (home, matches, alerts) | ✅ Complete — parent auto-linking fixed |
| Club Admin (squads, coaches, players, movement radar) | ✅ Complete |
| Production Readiness (indexes, RLS hardening, GDPR, Sentry, CI) | ✅ Stage 1–7 complete |

---

## What Each User Can Do

### PLAYER ✅
- Sign up via coach invite code (TRK-XXXX)
- Home screen — season band, stats grid, recent matches, card reveal modal
- Match history + individual match detail
- Player evolution card (OVR, quests, tier progress, shimmer animation)
- Player passport (shareable career doc, PNG export)
- Profile page with trend chart + coach assessment bars
- Invite parent (enter parent email during onboarding)
- How TRAK Works explainer
- Settings — edit position, shirt number, name, avatar

### COACH ✅
- Sign up + onboard (club, team, age group, role)
- Generate invite code for players
- Add squad players (name, position, age group, shirt #)
- Log a match — quick log OR full session with per-player stats
- Log a training session
- Full player assessment (6 dimensions)
- Quick assess
- Award a player (POTW, POTM, POTS, Most Improved, Top Scorer)
- View squad list with latest band per player
- View individual player profile
- AI assistant (session plans, drill suggestions)
- Schedule / smart calendar
- Settings — edit club, team, coach role

### PARENT ✅
- Sign up and auto-link to child (via parent_invites → player_parent_links)
- View child's home / season summary / recent matches
- View child's full match history
- In-app alerts (new match, new assessment)
- Settings

### CLUB ADMIN ✅
- Sign up as club admin
- View all coaches across the academy
- View all players across all squads
- View assessment activity (read-only)
- Copy coach invite codes
- Movement radar — players consistently outperforming their age group

---

## Production Readiness Stages

| Stage | Description | Status |
|---|---|---|
| 1 | DB indexes on all FK + query columns | ✅ Committed `3169d9f` |
| 2 | .env.example, rejection handler, onboarding cache expiry | ✅ Committed `2fe9422` |
| 3 | Sentry error monitoring wired into ErrorBoundary | ✅ Committed `f3dfe3e` |
| 4 | RLS: replace FOR ALL with explicit ops, block assessment deletion | ✅ Committed `1c58ee5` |
| 5 | GDPR: delete_my_account RPC + Settings button | ✅ Committed `dfae8d3` |
| 6 | CI/CD: GitHub Actions (lint + test + build) | ✅ Committed `31158d5` |
| 7 | Docs: README.md, CLAUDE.md, STATE.md | ✅ In progress |
| 8 | TypeScript strictness (noImplicitAny → strictNullChecks) | ⏳ Pending |

---

## Known Gaps (v2)

- Player self-logging matches (coach logs on their behalf today)
- Coach → player messaging
- Push notifications (native)
- Multiple children per parent
- Public player profile links
- Advanced club analytics / exports
- Payment / subscription layer
- Storybook component library
- PWA manifest / install prompt

---

## Migrations Applied to Production

Apply all files in `supabase/migrations/` in filename order.
All migrations use IF NOT EXISTS / IF EXISTS guards.

**Critical migrations not to skip:**
- `20260425000001_security_hardening.sql` — base RLS + indexes
- `20260526000001_supplemental_indexes.sql` — 4 additional indexes
- `20260526000002_rls_explicit_operations.sql` — block assessment deletion
- `20260526000003_gdpr_delete_account.sql` — GDPR delete RPC
