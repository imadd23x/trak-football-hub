# First pilot: journey index

Tracks the P0 journeys and guarantees in [MVP Requirements](../../MVP%20Requirements) and what has been proven for each one. That file defines the scope. This file only records progress. Owners are proposed until confirmed in review.

A row passes only on the **deployed** build, under real roles. Record evidence as `commit · deployment · device · identity · date` (see the [merge gate](../release/merge-gate.md)). An open PR, a green branch or a passing local test is not evidence.

| Journey | Owner | Registry use cases | Deployed evidence |
|---|---|---|---|
| J1 Academy admission | Imad (identity, consent schema), Kostas (roster load, coach assignment) | None yet. UC-C02, UC-A08, UC-A10, UC-C07 and UC-P01 contradict it: see Q-2026-09-23-01 | Not verified |
| J2 Parent consent | Imad | UC-P07 (written for ages 13–14; threshold is now 18) | Not verified. On 22 Sep the first invite took 198 s and only the resend arrived |
| J3 Child activation | Imad | None yet | Not verified |
| J4 Coach logs | Kostas | None yet (player logging UC-A02/A03 parked) | Not verified |
| J5 Assessment and message | Kostas | UC-C03, UC-C04 (enforced) | Not verified. Production had 0 published coach messages on 23 Sep |
| J6 Player and parent see it | Tarek (player), Imad (parent) | UC-A04, UC-X02 (enforced); UC-A09, UC-P02, UC-P03, UC-P06 (pending) | Not verified |
| J7 Measure | Kostas | UC-T01 (pending) | Not verified. `pilot_config` still points at Rehearsal FC |
| G1–G7 Guarantees | Owner of each write/read path | UC-X01 (pending) | Not verified as a set |

Out of pilot scope, still in the registry: UC-A06 (goals), UC-A07 (medals), UC-C08 (player-logged matches). See Q-2026-09-23-01.

The registry's generated [README](./README.md) lists use cases by harness status (`enforced`/`pending`/`parked`). That status tells you whether a test blocks commits. It does not tell you a journey above has passed.
