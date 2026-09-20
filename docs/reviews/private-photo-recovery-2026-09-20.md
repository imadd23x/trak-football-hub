# Private photo read recovery

Base: fork #10 `ca36554`. Scope: OwnAvatar, its optional abort signal through the existing account helper, and regression/browser tests. No Storage policies, uploads, other Settings actions or authentication rules change.

Reproduction: a separate built Chromium probe held the private photo GET after authentication; after 21 seconds the parent profile still exposed only “Loading profile photo” with no retry. The desired retry assertion failed in 22.4 seconds. Source traced the gap to an unbounded verification/download/body operation in OwnAvatar.

Acceptance: one 20-second deadline spans account verification, download and blob consumption; expiry cancels available transport, offers retry and ignores late completion. New attempts and accounts must not be affected by old timers. Success and unmount clear timers; unmount revokes blob URLs. Verify the actual SDK request signal and a built-browser timeout/retry. This read-only retry does not resolve uncertain upload outcomes or change Storage authorization.

Verification on September 20:

- Five focused regressions failed before the fix and pass afterward. They exercise the actual SDK through synthetic HTTP responses: stalled Auth verification, stalled download, an incomplete body, successful timer cleanup and unmount. They assert request abortion, retry, ignored late results and the exact timer handle being cleared. All 35 existing Settings/account cases also pass.
- **667 source tests in 51 files**, **17 harness tests**, typecheck and build pass. Lint: **0 errors / 127 inherited warnings**. Actual bundle: 97 files, 83 readable, 79 named chunks, no dev-only modules or burned credential values.
- **Five built Chromium avatar journeys pass** (26.7 seconds). Four existing role-specific decode/upload/reload journeys remain green. The added parent case waits for the real deadline, observes Chrome `net::ERR_ABORTED`, clicks Retry, decodes actual PNG bytes and then completes upload/reload. Inspected the timeout-state phone screenshot. All remote requests are intercepted; no real account, photo or hosted setting was changed.
- The published #10 dependency has green CI, including all 52 earlier browser journeys. This change adds one browser journey. Its own full CI and exact-head independent review remain pending. SQL did not change and the passing #10 database runs were not unnecessarily repeated locally.

Commands: `npm test`, `npm run test:harness`, `npm run typecheck`, `npm run lint`, `npm run build`, and `node node_modules/@playwright/test/cli.js test --config playwright.pilot.config.ts e2e/private-avatar.spec.ts`. Local logs: `/tmp/trak-photo-recovery-*.log`; before-fix built probe: `/tmp/trak-photo-deadline.log`.

The shared account helper gains an optional AbortSignal, used only by OwnAvatar; callers that omit it retain their existing behavior. The timeout abandons the owning attempt before transport abortion and clears on both completion and unmount. Previously known upload/other Settings timeout gaps and backend Storage authorization remain separate work. Publish separately to the fork; exact-head review and CI precede any production approval. Rollback is the frontend commit revert, with no schema changes.
