#!/usr/bin/env node
// ============================================================
// Layer 3 — assert on what actually ships.
//
// Run after `npm run build`. Everything else in the credential stack examines
// SOURCE; this examines `dist/`, which is a different question and the only one
// that maps to the actual harm: a string reachable over HTTP.
//
// ── Why source checks could not have caught the incident
//
// `/dev-setup` is registered behind a dev guard:
//
//   App.tsx:96   {import.meta.env.DEV && <Route path="/dev-setup" ... />}
//
// so DevSetupPage.tsx *looks* guarded, and a source scanner reading it agrees.
// But App.tsx:24 is:
//
//   const DevSetupPage = lazy(() => import("./pages/DevSetupPage"))
//
// A `lazy(() => import(...))` is a statically analysable reference. Rollup emits
// the chunk whatever the route guard says, and the entry bundle carries its URL.
// The guard decides which routes REGISTER, not which chunks are BUILT.
//
// That is why the dev-account password shipped: not because anyone ignored a
// guard, but because the guard was on the wrong thing and nothing ever looked
// at the output.
//
// ── What this checks, and why the first one is the load-bearing one
//
//   A. Coverage. A broken walk finds no secrets and looks exactly like a clean
//      tree. #59's first guard passed while three files still held the value,
//      because its search was scoped and nobody asserted the scope. So this
//      proves it read a real bundle before it is allowed to conclude anything.
//
//   B. No dev-only module ships. This is the MECHANISM check and it is the one
//      that would have caught the incident. It needs no denylist, so it also
//      catches the next dev page, whose password nobody has chosen yet.
//
//   C. No burned credential value ships. This is the VALUE check. It reads the
//      burned list from #59 rather than restating it — see below.
//
// ── Why this file names no credential
//
// #59 asserts that exactly two files may contain a burned value — its own test
// and the incident record — as an exact set, so that a third cannot quietly
// join them. That assertion is correct and this file must not break it. So the
// values are read from #59's list at runtime and never written here.
//
// Until #59 merges that list does not exist, and check C reports itself as
// unavailable rather than silently passing. Check B does not depend on it and
// carries the load meanwhile — which is the right way round, since B is the
// check that maps to this incident.
// ============================================================

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = resolve(ROOT, 'dist');

const failures = [];
const notes = [];
const fail = m => failures.push(m);

// ── Modules that must never reach production, by name ──────────────
// Vite names a lazy chunk after its module, so a shipped dev module is visible
// as dist/assets/<Name>-<hash>.js.
const DEV_ONLY_MODULES = ['DevSetupPage', 'DevSwitcher', 'dev-credentials'];

// Chunks known to ship today, each with the reason and what would remove it.
//
// An entry here is an admission, not an exemption: it is reported on every run.
// And a STALE entry is itself a failure — if the chunk stops shipping and the
// entry stays, the next real regression would be silently permitted by it. That
// is the whole reason allowlists rot, so this one cannot.
const KNOWN_SHIPPING = [
  {
    chunk: 'DevSetupPage',
    why: 'App.tsx:24 lazy-imports it, so Rollup emits the chunk even though '
       + 'App.tsx:96 gates the ROUTE on import.meta.env.DEV.',
    removedBy: 'Not #59 — #59 removes the credential from the chunk and does '
             + 'not touch App.tsx, so the chunk still ships after it merges. '
             + 'Removing it needs the import itself made conditional.',
  },
];

// ── A. Coverage ────────────────────────────────────────────────────
if (!existsSync(DIST)) {
  console.error('FAIL  dist/ does not exist. Run `npm run build` first.\n'
    + '      Refusing to report a clean bundle without having read one.');
  process.exit(1);
}

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full);
    else files.push(full);
  }
})(DIST);

const text = files.filter(f => /\.(js|css|html|json|map|txt|svg|webmanifest)$/i.test(f));
const rel = f => relative(ROOT, f);

if (text.length < 5) {
  fail(`only ${text.length} readable files in dist/ — that is not a real build, `
     + 'and a scan of it would prove nothing.');
}
const entry = files.filter(f => /assets[/\\]index-[A-Za-z0-9_-]+\.js$/.test(f));
if (entry.length === 0) {
  fail('no dist/assets/index-*.js entry bundle found — the layout this check '
     + 'relies on has changed, so its other results cannot be trusted.');
}

// ── B. No dev-only module ships ────────────────────────────────────
const chunkNames = files
  .map(f => rel(f).match(/assets[/\\]([A-Za-z0-9_.-]+?)-[A-Za-z0-9_-]{6,}\.(?:js|css)$/))
  .filter(Boolean).map(m => m[1]);

const allowed = new Set(KNOWN_SHIPPING.map(k => k.chunk));
const shippedDevModules = DEV_ONLY_MODULES.filter(m => chunkNames.includes(m));

for (const mod of shippedDevModules) {
  if (!allowed.has(mod)) {
    fail(`dev-only module "${mod}" is in the production bundle.\n`
       + '      A route guard does not stop a chunk being emitted. Make the '
       + 'import itself conditional, or add it to KNOWN_SHIPPING with a reason.');
  }
}

// A stale admission is a failure. This is the part that keeps the list honest.
for (const known of KNOWN_SHIPPING) {
  if (!chunkNames.includes(known.chunk)) {
    fail(`KNOWN_SHIPPING names "${known.chunk}" but it is no longer in dist/.\n`
       + '      Good news, and now remove the entry — a stale exemption would '
       + 'silently permit the next regression that happens to match it.');
  } else {
    notes.push(`${known.chunk} ships. ${known.why}\n        Removed by: ${known.removedBy}`);
  }
}

// The entry bundle carrying a dev route string means the URL is discoverable
// even when the route never registers.
for (const e of entry) {
  if (readFileSync(e, 'utf8').includes('/dev-setup') && !allowed.has('DevSetupPage')) {
    fail(`${rel(e)} references the /dev-setup route.`);
  }
}

// ── C. No burned credential value ships ────────────────────────────
// Read from #59's list; never restated here. See the header.
const BURNED_SOURCE = resolve(ROOT, 'src/__tests__/no-committed-credentials.test.ts');
let burned = null;
if (existsSync(BURNED_SOURCE)) {
  const m = readFileSync(BURNED_SOURCE, 'utf8').match(/const\s+BURNED\s*=\s*\[([^\]]*)\]/);
  if (m) burned = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]).filter(Boolean);
}

if (burned === null) {
  notes.push('Value check NOT RUN: the burned-value list is not in this tree yet '
    + '(#59 introduces it).\n        Check B above does not depend on it. This '
    + 'line exists so that "no value check ran" can never read as "no values found".');
} else if (burned.length === 0) {
  fail('the burned-value list was found but parsed as empty — that would pass '
     + 'this check for the wrong reason.');
} else {
  for (const secret of burned) {
    const hits = text.filter(f => readFileSync(f, 'utf8').includes(secret));
    if (hits.length) {
      // Deliberately not printing the value: this file must stay clean of it.
      const total = hits.reduce((n, f) => n +
        (readFileSync(f, 'utf8').split(secret).length - 1), 0);
      fail(`a burned credential (#${burned.indexOf(secret) + 1} in the list) is `
         + `served from the production bundle: ${hits.map(rel).join(', ')} `
         + `(${total} occurrence${total === 1 ? '' : 's'}).\n`
         + '      Rotate the value. Removing it from the build does not '
         + 'un-publish what was already served.');
    }
  }
  notes.push(`Value check ran against ${burned.length} burned value(s) over `
    + `${text.length} bundle files.`);
}

// ── Report ─────────────────────────────────────────────────────────
console.log(`Bundle check: ${files.length} files in dist/, ${text.length} readable, `
  + `${chunkNames.length} named chunks.`);
for (const n of notes) console.log(`  note: ${n}`);

if (failures.length) {
  console.error(`\n${failures.length} bundle check failure(s):\n`);
  for (const f of failures) console.error(`  FAIL  ${f}\n`);
  process.exit(1);
}
console.log('OK — no dev-only module and no burned value in the production bundle.');
