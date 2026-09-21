# Settings account boundary review — 2026-09-18

Base: canonical `00910940f596d9fe9a7cd416dc741943d1df2cc9`; branch `parent/P6-settings-account-boundary`.

## Scope and acceptance

- `/settings` uses the existing authenticated/profile-ready route guard and a form keyed by user ID. A→B replaces the form; same-account token refresh preserves unfinished name/role drafts. Null avatars clear the previous image.
- Settings profile, storage and deletion requests use the initiating account's captured JWT. Late A responses cannot update B's form or continue A's upload into a profile write. Repeated mutation clicks are blocked.
- Optional `signOut(expectedUserId)` checks the identity inside the existing auth-transition queue, before touching the SDK/cache. Queued B sign-in followed by A-only logout leaves B signed in and its cache intact. Existing callers retain their behavior.
- Name saves require a returned matching profile row, update the visible name and refresh Auth profile. Failed/zero-row name and role saves remain editable and retryable.
- Player connection reads are plural and independent of editable profile fields. Failed connection reads have a separate retry; hidden profile names do not erase valid links. Current coaches require `status = 'active'`; retained departed, released and archived roster rows remain history, not current connections.

## Executed local evidence

Synthetic HTTP fixtures exercise the actual Settings component, router/route guard, AuthProvider, persistent Supabase SDK and captured-session helper. No `useAuth` mock is used in the new 18-case Settings suite. The existing small presentation suites retain their explicit mocks.

| Command | Result |
| --- | --- |
| `npx vitest run src/pages/__tests__/SettingsAccount.test.tsx src/pages/__tests__/SettingsControls.test.tsx src/pages/__tests__/SettingsSignOut.test.tsx src/contexts/__tests__/AuthContext.sdk.test.tsx src/contexts/__tests__/AuthContext.test.tsx` | 50/50 pass |
| `npm test` | 340/340 pass, 30 files, after final active-coach filter |
| `npm run typecheck` | Pass |
| `npm run lint` | 0 errors, 133 warnings |
| `npm run build` | Pass; existing large-bundle warning |
| `npm run test:harness` | 17/17 pass before final one-line connection filter |
| `npm run uc:check` | Exit 0; 2 enforced pass; pending UC-A02 still has 3 failures, 10 other use-case tests pass; 15 pending without tests |

The active/departed regression was run before the fix: it failed because the actual SDK request omitted `status` (`[null]` versus `['eq.active']`), while its current-coach positive control rendered. It passes after the filter. Other controls cover successful same-account saves/deletion/logout, mounted read failure/retry, plural guardians/coaches, zero shirt number, delayed A read/name/upload/deletion, and signed-out/missing-profile access.

Local logs: `/private/tmp/trak-settings-{focused-final,source-final,type-final,lint-final,build-final,harness,usecases,active-coach-red}.log`.

## Limits

All HTTP responses are synthetic and unknown requests are rejected by the MSW harness. This verifies client behavior, request identity and response handling; it does not verify hosted RLS, storage policies, real email delivery or the live deletion RPC. No schema, consent-policy, App-route, hosted data, production or provider changes were made. Browser/device verification and cross-tab behavior were not newly exercised. Existing pending pilot failures remain visible; this is not a pilot-readiness sign-off.
