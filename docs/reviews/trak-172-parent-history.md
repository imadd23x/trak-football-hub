<!-- delivery-policy: historical -->
> Historical record. Development and delivery follow the [current canonical delivery policy](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/blob/main/docs/release/merge-gate.md). Process instructions recorded below are superseded; product facts, explicit scope holds and test observations remain evidence.

# TRAK-172 — Parent assessment history

Parent Home shows the latest five assessments, newest first, as complete
cards in a native horizontal scroll area. Touch swipe, keyboard arrows and
labelled buttons select a card. The final card opens All assessments.
The empty Home state also provides that link.

The history lists the selected child's assessments in pages of 20. Each row
opens its saved bands, coach and date. Parent training history rows resolve the
assessment by the exact session and selected child's roster records; an
unavailable assessment has an explicit unavailable state. Match-row assessment
links are separate work under TRAK-174. Existing match detail links remain.

All readers select only public assessment fields. Coach messages and private
notes are never requested. Child and parent identities are part of query keys;
sibling changes reset Home card selection and training history. Failed reads
show Retry instead of an empty history. Loading more first refreshes displayed
pages against current access, so withdrawn records disappear. A missing author
uses Coach; recorded zero ratings remain valid bands.

Arc ScrollArea is reused with its MIT license and no new dependency. Assessment
views use the existing telemetry event for the visible card or detail record.

## Verification and release

The regression suite covers five cards, older pages, exact training/detail
links, sibling switching, cross-child URLs, withdrawn access, empty and failed
reads, public field selection and retained historical authors. The browser
suite exercises a production build at 390 and 768 pixels with synthetic,
intercepted replies: real mobile touch, desktop keyboard, full-width cards,
history pagination, training bands and unavailable sibling records.

Final local verification passes 1,748 source tests and all 20 Chromium journeys,
plus lint, typecheck, harness, use cases, database/native/convergence checks,
build and bundle credential checks. Nine inherited skips and 24 pending use
cases without tests remain coverage debt. Six repeated viewport runs pass;
touch gestures use a paced duration and exact physical card-position checks.
A fresh review found no actionable findings and independently passed 18
targeted tests. That review does not satisfy independent human approval.

This branch builds on TRAK-171 (#295), refreshed with main 005b662. No database, match logging or production
write is included. Independent human review and approval are required before
merge. Real-phone J6 checks in the rehearsal script remain owed after deployment.
