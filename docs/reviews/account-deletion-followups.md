# Account deletion: remaining scope beyond the academy fix

September 18, 2026. The academy-continuity regression suite tests actual deletion by each account role with synthetic committed fixtures. It does not establish that every category of personal data is erased or that U10 is complete.

## Meeting requests survive coach deletion

Separate disposable PostgreSQL reproduction, using the real `delete_my_account()` under `authenticated` as a coach:

| Observation | Before deletion | After successful deletion and commit |
|---|---:|---:|
| Coach Auth account | 1 | 0 |
| Coach profile | 1 | 0 |
| Coach's meeting request | 1 | 1 |
| Meeting request with missing coach Auth account | 0 | 1 |

`meeting_requests.coach_user_id` is required but has no Auth foreign key. The latest deletion RPC in `20260901000008_drop_player_goals_and_fix_deletion.sql` neither deletes these meetings nor clears their coach reference. The request remains associated with the deleted UUID. A later roster deletion may cascade it, but coach account deletion alone does not.

Resolve the meeting retention policy, then add a reviewed cleanup/retention migration and a regression covering its intended result. Do not silently delete historical meetings as part of the F1/F6 organization-pinning repair. This is an open U10 finding, not a passing assertion disguised as intended behavior.

## Retained attribution is not anonymization

The same coach deletion preserves `coach_name_snapshot` on assessments and awards. A synthetic surviving assessment retained `Deleted Coach History` after the Auth account was removed. This is the existing attribution-retention design, not anonymization. Consent evidence also remains outside account foreign keys; avatar object cleanup is not covered by the SQL harness.

At the original review, Settings promised that deletion permanently deletes all the user's data. Main `0091094`, merged into this branch during the September 18 refresh, now discloses that some academy history and consent records may be retained. That source copy correction does not decide retention policy, change database/Storage behavior or establish live deployment. P8 and U10 remain open until those decisions, implementation and deployed verification are complete.

These checks used synthetic in-memory fixtures. No real account or shared Supabase data was modified. PostgreSQL/HTTP/Storage deployment evidence must be recorded separately.
