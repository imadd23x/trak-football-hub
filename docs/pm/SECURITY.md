# Security Notes

> **Update (TRAK-96, Oct 2026):** the app now uses the new API keys: `sb_publishable_…` in the browser, `sb_secret_…` for operators and edge functions. The legacy anon and service_role JWTs below are deactivated as TRAK-96's last step.

## Item 01 — Supabase Anon Key in Git History

**Status:** ✅ Resolved — key rotated 2026-05-30. Old key invalidated.

**What happened:** The `.env` file containing the Supabase URL and anon (publishable) key was committed in `6cec37e` ("Changes") and removed from tracking in `2fe9422`. The key remains accessible via `git log`.

**Risk level:** Low — the `VITE_SUPABASE_PUBLISHABLE_KEY` is the **anon key**, which is intentionally public (it's embedded in every browser session anyway). It is NOT the service role key. That said, best practice is rotation.

**Required action before pilot launch:**
1. Go to Supabase Dashboard → Project Settings → API
2. Click "Reveal" next to the anon key, then click "Rotate"
3. Update your local `.env` with the new key value
4. Redeploy (Lovable auto-deploys from `main` once env var is updated in Supabase)
5. The old key becomes invalid — no user data exposure from the rotation

**To check if a service role key was ever committed (it must not be):**
```bash
git log --all --full-history -p -- .env | grep SERVICE_ROLE
# Should return nothing. If it returns anything, rotate the service role key immediately
# in Supabase Dashboard → Project Settings → API → service_role key → Rotate
```

**Pre-commit protection going forward:**
`.env` is in `.gitignore`. Consider adding [gitleaks](https://github.com/gitleaks/gitleaks) as a pre-commit hook to prevent future accidental commits of secrets.

---

## RLS Tenant Isolation (Item 03)

**Status:** Policies hardened — manual browser probe required.

RLS policies have been split from `FOR ALL` into explicit `SELECT / INSERT / UPDATE` with `DELETE` blocked on immutable records. However, they have not been adversarially tested in a browser.

**Manual probe (run before pilot kickoff):**
1. Sign in as Player A in one browser tab
2. Open DevTools → Console
3. Run: `(await import('/src/integrations/supabase/client.js')).supabase.from('matches').select('*').eq('user_id', '<player_B_user_id>')`
4. Expected result: empty array `[]` — if any rows come back, the policy is wrong
5. Repeat for: `coach_assessments`, `squad_players`, `profiles`

Document results in a comment below this section before pilot day one.
