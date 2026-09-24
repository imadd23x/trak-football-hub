# TRAK-6 player readback implementation plan

**Goal:** Fix the three audited player readback defects on main `93e7037`, with executable regression evidence.

**Approved scope:** PlayerHome, PlayerMatchDetail and dedicated tests. The audit and file reservation are recorded on [TRAK-6](https://linear.app/trak-football/issue/TRAK-6) and [Slack](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1790261466774929). User approved implementation on 24 September 2026.

## Tasks

1. Preserve the six failing assertions for the three defects from the routed audit, plus its passing controls, in `src/__tests__/player-readback.test.tsx`. Run them against unchanged product code and retain the red output. The seventh audit failure belongs to the separate TRAK-13 open-session withdrawal requirement; keep that original probe as audit evidence, without claiming it passes here.
2. Give Match Detail explicit loading, error with Retry, and unavailable states. Use `maybeSingle()` for optional rows, hide the previous match during route changes, and prevent superseded reads from updating the current route. Add successful Retry and out-of-order response controls.
3. Make Home errors belong to the current load. A successful matches response must not erase a failed details, squad, assessment or calendar read. Retry starts a fresh load, and older callbacks must not change its state. Add ordering and recovery coverage.
4. Clear Home assessment, coach name, published message and dependent calendar data when fresh prerequisite reads no longer grant access to rows. Retain existing published-feedback no-row clearing and visible feedback errors. Test empty squad/assessment results and superseded responses.
5. Run spec review and code-quality review, fix actionable findings, and run the required source tests, harness, typecheck, build, lint and use-case gate. Verify the built player routes in a mobile browser using intercepted synthetic requests. Retain logs and report pending use-case debt accurately.
6. Commit with repository hooks enabled and push to the user-authorized `t-bones29/trak-football-hub-tarek` fork. Open a draft PR only after the repository-required author/reviewer acceptance agreement. Obtain a non-author review before release; preserve Imad's post-demo hold.

## Boundaries and acceptance

- Current errors are actionable and never falsely render an empty record.
- Missing matches have a safe unavailable state and navigation back to Matches.
- Old responses cannot restore old match or coach content after newer loads.
- Existing permitted match, coach-message, sibling-switch and parent Retry controls stay green.
- No AuthContext, parent-screen, database, admission, rating/default or production changes.
- TRAK-6 remains open for the whole journey and deployed two-phone evidence. TRAK-13's immediate other-open-session withdrawal contract remains coordinated with Imad; a focus refresh alone does not close it.

## Implemented validation (24 September 2026)

- Initial routed regression baseline: six failures and five passing controls. Expanded baseline: 20 failures and eight controls. Two further tests reproduced optional browser-storage failures before the narrow guard was added.
- Final dedicated suite: 30/30 passing; existing shared-feedback suite: 9/9 passing. Requests run through the real router, AuthProvider and Supabase SDK, with synthetic MSW HTTP. No new skipped tests.
- Required checks: `npm test` (739 passed, nine existing skipped), `npm run test:harness` (18 passed), `npm run typecheck`, `npm run build`, `npm run lint` (zero errors, 131 warnings), `npm run uc:check` (five enforced files; 13 pending use cases still lack tests), and `npm run check:bundle` all pass.
- The built app passes seven local Chromium checks at 390×844: denied match Retry, recovery, hiding a previous route's match, current-match completion, unavailable record, Home error ordering and Home Retry recovery. Every backend call is intercepted; no unexpected external calls or page errors occurred. Error, unavailable and recovered screens were visually inspected.
- Scope review has no outstanding findings. Optional reveal storage errors are caught without suppressing backend read errors. Empty assessments clear coach content while retaining calendar data when the accessible squad still supplies coach IDs.
- Main remained `93e7037` during verification. These are local synthetic results, not deployed evidence, human non-author approval or closure of TRAK-6/TRAK-13.
