# Keeping credentials out of merged and forked work

| Document control | Value |
| --- | --- |
| Prepared | 19 September 2026, after the leak in #59 |
| Question asked | *"How do we separate credentials from merging forked work?"* |
| Short answer | **The fork boundary is not what failed.** It is correct and I verified it. What failed is that there is no development environment, so every credential in source is a production credential. |

---

## 1. CI already separates secrets from forked work, correctly

I checked this first because it is the obvious suspect, and it is not the cause.

| Job | Secrets | Guard |
| --- | --- | --- |
| `test` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | none needed — see below |
| `vercel-credentials` | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | `github.repository == '…/trak-football-hub'` |
| `supabase` | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_URL` | same, **and** `push` to `refs/heads/main` only |
| `deploy` | `VERCEL_*` | same, **and** an explicit same-repo check |

Three things are right here and worth not breaking:

- **Every trigger is `pull_request`, never `pull_request_target`.** That is the single most common way a governance or CI workflow becomes the vulnerability it was added to prevent: `pull_request_target` runs the fork's code with a writable token and access to secrets. Nothing in this repository does it.
- GitHub does not pass secrets to `pull_request` runs from a fork at all, so a fork PR's `test` job simply gets empty values.
- `deploy` does not rely on that alone. It adds
  `github.event.pull_request.head.repo.full_name == github.repository`,
  so a fork PR cannot deploy even if the secret model changed underneath it.

**Conclusion: forked work cannot read a secret or reach production today.** The leak did not come through this door.

## 2. What actually failed: there is no development environment

`src/integrations/supabase/client.ts:5`

```ts
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://xbykbqolvqyqmipikuae.supabase.co';
```

**The production project is the fallback.** A developer with no `.env` runs the whole application against the live database. So when anyone opened `/dev-setup`, it created `coach@trak.dev`, `player@trak.dev`, `parent@trak.dev` and `club@trak.dev` **in production** — which is why those accounts exist there and why a hardcoded password for them mattered.

That is the causal chain, and it explains the leak better than any process failure:

1. No separate dev project exists, so the default target is production.
2. "Dev accounts" are therefore production accounts.
3. Their password was written in source, because they felt like fixtures.
4. `src/` is compiled and served, so the fixture became a public credential.

**Fixing the fork boundary would not have prevented any step of this.** Fixing step 1 would have prevented all of them.

### The key on that same line is fine — do not "fix" it

`VITE_SUPABASE_PUBLISHABLE_KEY`'s fallback decodes to:

```json
{"iss":"supabase","ref":"xbykbqolvqyqmipikuae","role":"anon","iat":1774368273,"exp":2089944273}
```

`role: anon`. The anon key is designed to be public and shipped to browsers; row-level security is what protects the data behind it. It is not a leak and removing it would break the app for no gain. Saying so explicitly because the instinct after a credential incident is to strip every long string in sight.

## 2a. Correction: only one chunk was ever served

The incident report said `LandingPage.tsx` held the literal in the entry bundle
and so shipped to every visitor. **That is wrong**, and Kostas caught it by
building the branch. Verified on a fresh build of `upstream/main`:

```
$ grep -rl TrakDev123 dist/
dist/assets/DevSetupPage-idPyqu34.js      ← the only file
$ grep -c TrakDev123 dist/assets/index-*.js
0
```

`LandingPage`'s only use of the constant sits behind an `IS_DEV` value Vite
folds to `false`, so Rollup eliminated the branch and took the literal with it.
`DevSwitcher` is the same. **Only the `DevSetupPage` chunk was served** — that
one because its guard is on the *route* while the `lazy()` import is static, so
the chunk is emitted and referenced regardless.

I asserted the entry-bundle claim from reading line 18, while the build output
that disproved it was already on screen. The count in that chunk is 12, which
does stand — minification did not collapse the repeated literal.

None of this changes what must be done. Source exposure on a public repository
is exposure, so every literal is removed; and rotation was always the only thing
that closes it.

## 3. Where the burned values still live

Removing them from `HEAD` — which #59 does — changes none of this.

| Location | Still exposed? | What closes it |
| --- | --- | --- |
| Canonical repo git history | **Yes**, permanently | Rotation only |
| `t-bones29/trak-football-hub-tarek` (public fork) | **Yes** | Rotation only |
| `imadd23x/trak-football-hub` (public fork) | **Yes** | Rotation only |
| Every clone anyone has taken | **Yes** | Rotation only |
| **Past Vercel deployments** | **Yes** — each keeps an immutable URL serving the old bundle, including `dist/assets/DevSetupPage-*.js` | Delete old deployments, **and** rotate |

The Vercel row is the one usually forgotten. Shipping the fix creates a new deployment; it does not retract the old ones, and their URLs are linkable.

History rewriting is not a remedy here. `git filter-repo` on the canonical repo does not touch two public forks or anyone's clone, and forks in a GitHub network share object storage, so previously-pushed commits often remain reachable. **Rotation is the only action that actually closes this**, which is why #59 says so in its own description rather than presenting itself as the fix.

### Where they entered, since provenance was disputed

```
778fd1d  2026-04-21  "Make app fully functional — all 7 phases complete"
                     adds DevSwitcher.tsx, DevSetupPage.tsx, LandingPage.tsx
ecf1909  2026-09-01  "docs(pilot): measurement runbook … rehearsal tooling"
```

Both are ordinary commits with parents, not the initial import — the repository's
actual roots are `a933ef6` and the Lovable template `1bc8809`, and neither
carries a credential. **A review gate could have caught these**; nobody was
looking at literals. That distinction decides whether the fix is process or
tooling, and the answer is tooling: sections 4.4 and 4.7.

## 4. What to change, in order of value

**1. Create a separate development Supabase project, and make the fallback point at nothing.**
This is the root cause and everything else is mitigation. Replace the production fallback with a value that fails loudly:

```ts
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
if (!SUPABASE_URL) throw new Error('Set VITE_SUPABASE_URL — there is no default project.')
```

A developer without a `.env` should get an error, not a live database holding children's records. Note the file's header says it is generated, so the generator needs changing too rather than the output.

**2. Rotate the burned credentials and delete the dev accounts from production.**
Console work; nobody in a PR can do it. `coach@trak.dev`, `player@trak.dev`, `parent@trak.dev`, `club@trak.dev`, and the `rehearsal.trak.dev` set.

**3. Purge old Vercel deployments**, or confirm the retention policy means they are already gone.

**4. Move the credential guard into the pre-commit hook.**
`npm test` runs it in CI (`ci.yml:45`), so it blocks a merge — but on a **public** repository the damage is done at `git push`, not at merge. `.husky/pre-commit` currently runs only `uc:check`; adding the guard there stops a credential reaching a public remote at all. One line.

**5. Check GitHub secret scanning and push protection are enabled.**
I could not read the setting without admin scope. Worth knowing that it would **not** have caught this: `TrakDev123` matches no provider token pattern. Custom patterns for `trak.dev` account passwords would.

**6. Assert on `dist/` after the build — Kostas's Layer 3, and the best idea here.**
Only a check on build output can see a chunk emitted despite its route being
dev-gated, which is exactly this incident. The source guard in this PR would
**not** have caught it: `DevSetupPage.tsx` looked guarded. `npm run build && !
grep -rqE '<denylist>' dist/` maps to the actual harm — a string reachable over
HTTP — rather than to a proxy for it.

**7. Keep the `pull_request` / no-`pull_request_target` rule written down.**
It is currently correct by everyone's good judgment rather than by any stated rule. It is the kind of thing a future workflow change breaks silently while looking like a convenience.

---

## What I did not verify

Whether the dev accounts actually exist in the production project, and whether the burned passwords still work — both need console access. Whether secret scanning is enabled, for the same reason. Whether Vercel retains the old deployments, or has already expired them.

Everything in sections 1 and 2 is read from the code and cited by line.
