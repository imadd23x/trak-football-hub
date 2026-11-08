# Training tab: technical design

TRAK-293 is the product spec and wins on behaviour; its five sub-issues (TRAK-294 to TRAK-298) are the build order.
This file says how it is built: tables, read rules, routes and screens. A slice that changes a decision here updates
this file in the same PR.

## Objective

Each training gets a plan, written the coach's own way, and one loop: Plan → Who's here → Run it → Close. A coach who
uses their own drills types a plan fast and reuses it; a coach who wants help picks from the Library. Both land on the
same plan. Everything sits behind the `training` academy switch. With the switch off, Trak behaves exactly as today.

## Decisions this rests on

- TRAK-293's decisions (Kostas, 27 Oct), unchanged.
- **Training replaces Library in the nav** where the switch is on. The Library's pages (`/coach/trainings/...`) stay
  as they are and open from Training › Drills; on them the nav marks Training.
- **Coach only.** No player, guardian, other coach or academy admin reads a drill or a plan in this build, so there
  are no copy tables (unlike Games).
- **Times are the academy's.** Coming up and Last week compare instants (`starts_at`, `ends_at`), which the database
  sets on the academy's clock (TRAK-175). A training with no time lasts its whole day, as TRAK-230 locks it.
- **Not built** (TRAK-293): Build it with Trak, Homework, Value of the month, the objectives nudge, "What this session
  covers", the weekly check-in. Their data doesn't exist yet.

## Tables

Every new table: RLS on; nothing granted to `anon`; `authenticated` gets only the operations a rule below backs.
Every text field has a length limit.

| Table | Key | Holds | Slice |
|---|---|---|---|
| `coach_drills` | `id` | The coach's own single drills: name (≤80), usual minutes (5–60; the app offers 10–30), how it works (≤1000), what you'll tell them (≤500), and the five details area, numbers, direction, targets, conditions (≤120 each). | 294 |
| `training_plans` | `event_id` | One plan per training event (`coach_calendar_events(id) ON DELETE CASCADE`), and its coach. | 295 |
| `training_plan_practices` | `event_id, position` | The plan's practices in order (positions 1–12): name, minutes, how it works, what you'll tell them, the five details (drills' limits), where it came from (`own`, `drill`, `library`) and the drill (`ON DELETE SET NULL`) or Library session it came from. A practice is a copy: changing or deleting a drill never changes a plan. | 295 |

## Read and write rules

**The coach** reads, adds, changes and deletes their own rows (`coach_user_id = (select auth.uid())`). Writes also
pass restrictive rules, as events do: `is_coach()` and the academy's `training` switch on (`feature_on('training')`).
Reads don't need the switch, so switching Training off hides the tab without losing anyone's drills or plans.

From 295, a plan's event must be the coach's own training, not cancelled, and a practice can name only the coach's
own drill. A plan is saved whole by `save_training_plan(event, practices)` (1 to 12 practices, all or none), so a
half-saved plan can't exist. It runs as the coach (`SECURITY INVOKER`), so the rules above apply unchanged, and says
in words why it refuses (not your training, cancelled, no practice, more than 12). A practice written here and
ticked "Save to My drills" becomes one of the coach's drills in the same save. Practices are replaced whole on each
save, so the coach gets select, insert and delete on them, never update.

Nobody else reads these tables.

## Routes and screens

| Route | Screen | Slice |
|---|---|---|
| `/coach/training` | Training home, Sessions: Coming up (not over yet, soonest first) and Last week (over in the past 7 days, newest first), the squad pills, New session | 294 |
| `/coach/training/drills` | Training home, Drills: the Drill Library (TRAK-387; see Drill Library below). Was My drills and New drill (294). | 294, 387 |
| `/coach/training/:eventId/plan` | Write my own (and Copy a past session, 297) | 295 |
| `/coach/training/:eventId` | The plan, with the loop strip | 295, 298 |
| `/coach/training/:eventId/run` | Run it: the plan at the pitch side | 298 |

"How do you want to plan it?" (from Plan this session, or New session after "Which training?") remembers the
coach's last way on this device. Write my own is the only way in 295; Copy a past session joins it in 297. A
training's page starts at the top whenever the coach opens it.

From 296, "Add another" offers Write it · From My drills · From the Library, and each practice offers Swap; both open
one sheet (`AddSheet`) with three views. No new tables: a drill or a Library session is copied into the plan as a
practice (`source` `drill` or `library`). My drills' best fit is the coach's drills closest to the slot's minutes (a
swapped practice's, or what's left of the training to the nearest 5, kept to 10–30). A Library session takes its
short name, the slot's minutes or 20, its summary as how it works, and its pitch and players as the area and numbers;
the Library view keeps to the training's squad's age group until the coach asks for every age, and previews a
session inside the sheet with no link. From Training › Drills, a drill card adds the drill to the next training not
planned yet: the planner opens with it added, once.

From 297, "Copy a past session" shows in "How do you want to plan it?" once the coach has planned another session. A
past session is its plan: nothing new is stored. The list reads the coach's plans, their trainings and practices,
newest first, and searches by title or a practice's name. Copying opens Write my own filled in (sources kept: a drill
or Library practice stays one), with a note that nothing is saved until Save the plan; it replaces what was there.

A drill sent by Add to, or a copied session, travels in the planner's own history entry and stays there: changing
between phone and laptop width lays the coach's pages out again, and the planner must come back with it. Saving
replaces that entry with the plan, so Back never reopens the planner to add it twice.

From 298, the plan page runs the loop. Each step comes from what exists, so nothing new is stored: Plan is a saved
plan; Who's here is the register taken (the event's completed session, TRAK-138); Run it is done once the training is
over; Close is automatic (Kostas, 28 Oct): a training is closed once it has ended with its register taken. Who's here
opens the existing register (`TakeRegister`) as everywhere else: published, not cancelled, started. Run it
(`/coach/training/:eventId/run`) is the plan at the pitch side, with when each practice starts. A closed training
shows View log (`SessionLog`), and Last week says Closed or No register and opens the training's page. Sending who came
to a weekly check-in waits for the check-in.

Both routes are inside `ParkedScreen unless="training"`, so with the switch off the screen shows "Coming soon" and
every write handler stops at `useParked()`.

Code: `src/pages/coach/training/`, `src/components/coach/training/`, `src/lib/training/`.

## Drill Library (TRAK-384, building)

The new Library replaces the Drills tab and feeds Plan session, in 11 steps (TRAK-385 to TRAK-395). Step 1 (TRAK-385)
is the engine in `src/lib/training/library/`, with no screens, so nothing changes for anyone yet:

- **Drills** (`drills.ts`) live in the app, not the database: a coach can only bookmark a Trak drill, never change
  it. Each id starts with `lib-`, so an old plan's `trak_drill` (`w1`, `p1`… from `shelf.ts`) never finds a Library
  drill. The 44 drills now are sample content; the real library replaces them (TRAK-388).
- **Kinds** (`kinds.ts`): Get ready, then Technical, Skill and Game related, each with its drill types. Each drill
  fits one of the session's parts (Technical → Passing & movement, Skill → Rondo, a small-sided game → Game, other
  Game related → Functional drills) and has a players shape so Who's here keeps working until TRAK-393.
- **Fit** (`fit.ts`): a drill fitted to any number of players at one of 8 levels gives the five details (area,
  numbers, targets, direction, conditions). Every drill starts at level 4 of 8. Easier / Harder goes to the next
  level that really changes something and says why; Players today refits at the same level.
- **Search** (`search.ts`): by name, type, other names coaches use, topics and the fitted numbers, with "4 v 4" =
  "4v4" and one spelling slip allowed (two in long words).
- **Pitch picture** (TRAK-386): `pitch.ts` lays a fitted drill out to scale on a 640 × 420 canvas, with roles, not
  colours; `components/coach/training/library/DrillPitch.tsx` draws it in the fixed pitch colours
  (`lib/fixed-colours.ts` `PITCH`). `full` is the whole canvas with the size line and a one-line description for
  screen readers; `card` zooms onto the drill and is hidden from screen readers, as the card says it in words.
  `PitchKey` says what each colour means. Drills played in turns draw the players who are on.
- **Drills tab** (TRAK-387): `/coach/training/drills` is the Library home (Find a drill, My drills, All drills, the
  three kinds, then the old FA Library tiles until TRAK-394); `drills/kind/:kind` a practice page, `drills/all` All
  drills (`?show=` a kind, Individual or Goalkeeping), `drills/mine` My drills (empty until TRAK-390), `drills/d/:id` a
  drill's page (the picture, key, five details, why, how, watch for; TRAK-389 adds the rest). Searches and filters
  sit in the address (`?q=`, `?type=`, `?show=`), so Back returns to them. Every picture is fitted to the squad picked
  at the top (the whole roster on All), kept to 8–20 players, at level 4 of 8. Code: `src/pages/coach/training/
  DrillLibrary.tsx`, `src/components/coach/training/library/DrillCard.tsx`, paths in `src/lib/training/library/paths.ts`.
- **No coach-made drills** (Kostas, 8 Nov): New drill, the list of the coach's drills and Add to the next training
  left the Drills tab; migration `20261109000000_drill_library_clean_start.sql` deleted the hand-written drills, every
  plan that used one, and any draft that did. `coach_drills` stays, empty. Plan session's Write your own and From My
  drills go in TRAK-392.

## Switching it on

The operator runs one line (see `20261028020000_training_drills.sql`):

```sql
INSERT INTO public.academy_features(organization_id, feature) VALUES ('<academy id>', 'training');
```

Deleting the row switches it off at once.
