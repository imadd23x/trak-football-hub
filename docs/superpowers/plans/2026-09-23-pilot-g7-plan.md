# Pilot G7 implementation plan

> Execute using the subagent-driven-development skill, with independent review.

**Goal:** Remove pilot access to AI, photos and passport/sharing, preserving the
manual assessment/message and account-rights flows. Scope is G7, not complete
pilot admission or the other coming-soon features.

**Architecture:** Static role-guarded routes; inert AI edge entry points;
initials-only profiles; forward storage-policy and profile-write restrictions.
No frontend feature flag can reopen a server capability.

**Tech stack:** React/TypeScript, Vitest/MSW, Supabase edge functions and Postgres.

- [x] AI: exercise each real edge entry point with request/read/provider traps;
  confirm failure before modifying it, then replace each with a common 403
  `PILOT_FEATURE_DISABLED` handler. OPTIONS succeeds; no body/auth/database/
  provider work happens. Validate tests and edge compilation if available.
- [x] UI: write routed tests for passport, evolution, assistant, AI review and
  schedule placeholders and a still-working manual route. Add `ComingSoonPage`
  using the existing MobileShell and semantic colors, retaining route guards.
  Remove feature imports so disabled code is not in the served route bundles.
- [x] Photos: write UI regressions proving Settings has no upload and all
  profile surfaces display initials without fetching photo URLs. Remove the
  upload/signing state and renders. Preserve Settings operations unrelated to
  photos, including export/deletion, and explain availability in plain copy.
- [x] Database: obtain a CLI-generated forward migration. Add executable SQL
  regressions for avatar list/read/upload/update denial, external avatar-link
  writes, unrelated-bucket controls and trusted cleanup. Keep existing objects
  and avoid grant changes on unrelated storage. Run tests red, apply policy and
  profile trigger changes, then rerun green on disposable databases only.
- [x] Integration: preserve manual shared-feedback reads while preventing old
  AI draft/publication reads and writes as needed for G7. Run source/harness,
  typecheck, lint, build/bundle, use cases, database and browser checks. Request
  independent spec and code reviews; resolve actionable findings.
- [ ] Delivery: record exact checks, known existing consent failures, signed-URL
  expiry and deployment limitations. Commit through the existing hook, push to
  the approved fork, and open a draft canonical PR naming G7. No production
  deployment; deployed pilot index remains unverified.

The user approved beginning the audited POA and the concrete Slack reservation.
Founder/counsel decisions for admission remain separate from this bounded change.
