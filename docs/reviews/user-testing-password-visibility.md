# UT-20: password visibility

Imad's September 20 user-testing notes ask for password show/hide controls. Inspection found existing toggles on login/reset, but none on player, coach and academy signup or parent invitation sign-in/setup.

This focused branch starts from deployed main `4335e89`. A shared native password input adds independently controlled reveal buttons to those missing fields. Each button has `type=button`, an accessible name, pressed state and an association with its field. Autocomplete, form validation, values and submit handlers are preserved. Clearing a controlled field hides it again; switching the parent sign-in method remounts a hidden empty field. No auth endpoint or policy changes.

Verification on September 20:

- All five new routed-screen regressions failed before implementation, then passed. The changed screens' suite has 24 passing tests.
- Full source: 390 tests pass. Harness: 17 pass. Typecheck and production build pass. Full lint: zero errors, 134 existing warnings; no new lint finding in the shared component/tests.
- Eight Chromium mobile browser journeys pass. Three new signup journeys cover independent toggles, keyboard activation, value retention, clearing, and zero backend requests. Existing-parent invitation sign-in also exercises show/hide before an intentional synthetic sign-in. Screenshots inspected.
- Use-case gate passes its two enforced cases but still reports three pre-existing pending UC-A02 player-log failures and 15 pending cases without tests.

Fork-first commit/CI, independent review and explicit production approval are still required. The branch is standalone against current main; it does not depend on the larger parent-history integration. Production has not received this UI change. A rollback would be a reviewed frontend revert; no database rollback is needed.

This addresses UT-20 only. Duplicate-email messaging, confirmation delivery/expiry, account choice and invitation-only admission remain separate work. Login and reset already have toggles and were not redesigned.
