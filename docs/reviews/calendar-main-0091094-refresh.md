# PR38: calendar correction refreshed onto main

September 18, 2026. Merge canonical main
`00910940f596d9fe9a7cd416dc741943d1df2cc9` into parent calendar review
`49c4df8572081a4d42ce92349fa44992aaa4d62e`.

Only CI and package scripts required conflict resolution. The resulting delta
against main retains the original date-only helper, its 39 assertions, the
four-timezone runner and its additive CI/package registration. No application
conflict was resolved manually. Existing main checks and production jobs stay
unchanged. Migration files, OnboardingPage and CoachSchedule are byte-identical
to main; this refresh does not change consent thresholds or backend rules.

## Verification

Completed local logs record:

- 348 source tests and 17 harness tests pass.
- All 39 calendar tests pass separately in UTC, Dubai, Athens and New York.
- Typecheck and production build pass; the existing large-chunk warning remains.
- Lint reports zero errors and 136 warnings.
- Fresh and report-before-parent SQL orders each replay 62 migrations and pass
  the parent suite and all 282 operational-view assertions.
- The use-case gate reports two enforced cases passing, three existing pending
  UC-A02 failures and 15 pending cases without tests.

The coordinator independently inspected the resolved diff, unchanged main
migrations/callers and completed logs, and reran typecheck. Log paths are
`/private/tmp/trak-calendar-current-{source,timezones,types,lint,build,harness,usecases,db,upgrade}.log`.

The local browser launch did not execute: its pending execution-approval request
was cancelled during handoff and returned no process handle or result. This is
not a browser pass or an application failure. The existing five browser journeys
remain registered in CI and must pass on the published revision before review.
No hosted data, settings, emails, production deployment or live role journey was
changed or verified. Fork/canonical CI and independent human review remain
separate gates.
