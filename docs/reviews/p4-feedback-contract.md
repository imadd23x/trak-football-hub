# P4 feedback and consent boundary

Reviewed September 18, 2026 at integration `b66abcb`. This is an unresolved source/runtime review, not pilot approval. The independent reviewer replayed all 60 migrations in a disposable PGlite database and used actual authenticated database roles. No live report rows or account data were accessed.

## Confirmed gaps

- A linked child can read a private coach assessment note (one synthetic row); the linked parent cannot (zero rows). The player policy in `20260524000001_player_feedback_rls.sql` grants assessment access without publication. Kostas owns the K9 privacy repair.
- `supabase/functions/player-feedback/index.ts` reads private notes, sends them to the AI provider and returns generated feedback plus an original note. The routed `PlayerFeedback.tsx` invokes and renders this without persisted coach approval. No shared/published feedback schema exists at this snapshot. Removing note access also requires fixing the edge function's absent-note/null handling. T2/K9 must supply the approved publication contract before P4 reads it.
- With `parent_visibility=false` and `recognition=false`, the synthetic linked parent still reads one assessment, award and match. Those reads still succeed after the real `withdraw_parental_consent` call. A coach can also insert an award with recognition declined. The existing parent RLS checks identity links, not effective purpose permission. This is P2 work; academy-specific approval remains the confirmed policy, with guardian disagreement/withdrawal precedence still pending.

## Parent behavior already verified

`src/lib/parent-data.ts` explicitly projects scores, matches and recognition without private assessment notes or AI output. ParentHome's award `note` is the separate message described to the coach as a message for the player; that field alone is not proof of a private-assessment-note leak. Account/child query keys, selection reconciliation and account cache clearing are implemented. All 17 parent-family tests pass, including late responses, child removal and account switching.

## Required shared contract and acceptance

1. Preserve private historical notes. SQL, RPCs, edge responses and both parent/player UI must deny access. Do not copy old notes into shared records automatically.
2. Publish only explicit, attributable revisions with child, academy, author and publication identity. AI inputs, drafts and unpublished edits must never enter child/parent responses or caches.
3. Reject direct guessed-ID reads by unrelated guardians and academies. A parent-child link alone must not authorize every academy's records.
4. Enforce academy-specific `parent_visibility` and recognition purposes in the database. Withdrawal must follow the approved multiple-guardian rule; no UI-only enforcement.
5. Changing child/account, unlinking or losing permission clears feedback and rejects late responses. Missing-note and missing-publication paths are handled without crashes or a fallback to private data.

The source findings were coordinated in `#coding-agent-reviews`. Current green CI verifies its existing assertions; it does not mean these unimplemented boundaries are satisfied. HTTP/provider behavior, production policies and physical-device checks remain separate evidence.

## T2 coordination update

[Tarek's September 18 proposal](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789716645418969) separates coach-only `ai_feedback_drafts` from `player_feedback` containing the approved text, assessment/roster/academy IDs, coach author, draft provenance and published revision. [P4's response](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789716895831159) accepts that shape and will query explicit published columns directly, with database RLS enforcing academy-specific active consent and `parent_visibility`. Parent screens show the current revision; superseded revisions remain for the academy audit trail.

This is a coordinated contract, not delivered schema. Publication/supersession must be atomic; immutable server-checked academy/author/assessment relationships and direct-role denial tests are required. Table separation alone cannot distinguish a coach from a child because both use the `authenticated` database role. Draft protection still needs correct RLS or a narrowly scoped private/RPC boundary. P4 has no fallback to drafts or private notes. P2's effective-consent helper remains pending implementation and must be coordinated before calling the read gate complete.
