#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  QUESTIONS_PATH,
  hashUseCase,
  loadRegistry,
  readLock,
  writeLock,
} from './uc-registry.mjs'

const args = process.argv.slice(2)
const stage = (args.find(a => a.startsWith('--stage=')) ?? '--stage=commit').split('=')[1]
const writeLockMode = args.includes('--write-lock')

const TESTS_ROOT = resolve('tests/usecases')
const failures = []
// Escalations that must be turned into a durable OPEN-QUESTIONS.md entry if
// the run ends up blocked. Populated only via failFor() — see its doc
// comment for which kinds of failures qualify. Each entry carries both the
// use-case id and the exact reason text, because a question is keyed on the
// (id, reason) pair, not the id alone — see alreadyOpen()'s doc comment.
const escalations = []

function fail(message) {
  failures.push(message)
  console.error(`  ✗ ${message}`)
}

// Like fail(), but also records `id`/`message` as needing a durable
// OPEN-QUESTIONS.md entry if the commit ends up blocked. OPEN-QUESTIONS.md is
// a product-owner-facing log — every entry asks a human to pick one of three
// options about what a use case's spec should say, so only use failFor()
// for failures that genuinely raise such a question for a specific use
// case: lock-check tamper (spec text changed without a spec_version bump),
// a locked use case removed from the registry, an enforced use case with no
// test file, and enforced test-run failures. Registry *schema* bugs
// (duplicate id, missing required field) are developer mistakes with no PO
// decision to make — those call fail() directly so they still block the
// commit without polluting the log.
function failFor(id, message) {
  escalations.push({ id, message })
  fail(message)
}

function findTestFiles() {
  const found = new Map()
  if (!existsSync(TESTS_ROOT)) return found
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      // Documented convention: UC-<ID>.<slug>.test.tsx (or .test.ts).
      const match = entry.name.match(/^(UC-[A-Z]\d{2})\.[A-Za-z0-9-]+\.test\.tsx?$/)
      if (!match) continue
      const list = found.get(match[1]) ?? []
      list.push(full)
      found.set(match[1], list)
    }
  }
  walk(TESTS_ROOT)
  return found
}

/**
 * The harness has always had three statuses — the 2026-09-07 design says
 * "exactly `enforced` | `pending` | `parked`", and `parked` is already in the
 * UseCaseStatus type, tests/support/registry.test.ts, useCase()'s skip branch
 * and uc-report's sections. This file was the one place that did not know,
 * which is why a parked entry silently fell out of every branch below.
 */
const STATUSES = new Set(['enforced', 'pending', 'parked'])

const registry = loadRegistry()

if (writeLockMode) {
  writeLock(registry)
  console.log('registry.lock.json written.')
  process.exit(0)
}

const tests = findTestFiles()

// --- 1. Registry integrity -------------------------------------------------
console.log('Registry integrity')
const seen = new Set()
for (const uc of registry.use_cases) {
  // Duplicate ids and missing required fields are registry *schema* bugs —
  // a developer mistake, not a product decision. None of the PO's three
  // OPEN-QUESTIONS.md options ("spec stands", "spec changes", "spec
  // ambiguous") apply, so these block the commit via plain fail() but must
  // never escalate to a question. Duplicate ids also make `uc` an unsafe
  // key to escalate under: which of the two would even own that entry?
  if (seen.has(uc.id)) fail(`Duplicate use-case id ${uc.id}`)
  seen.add(uc.id)
  for (const field of ['actor', 'title', 'requirement', 'status', 'given', 'when', 'then', 'spec_version', 'source']) {
    if (uc[field] === undefined || uc[field] === null || uc[field] === '') {
      fail(`${uc.id} is missing required field "${field}"`)
    }
  }
  // Every branch below compares `status` to a literal, so an unrecognised
  // value is not an error anywhere — it is simply neither enforced nor
  // pending, and the use case drops out of the enforced run, the pending run
  // and the debt count at once, silently. That was already true of `parked`
  // before UC-A02/A03 used it, so the set is checked rather than assumed.
  // A misspelling is a developer mistake rather than a product decision, so it
  // uses plain fail() and never escalates to OPEN-QUESTIONS.md.
  if (!STATUSES.has(uc.status)) {
    fail(`${uc.id} has unknown status "${uc.status}" — expected one of: ${[...STATUSES].join(', ')}`)
  }
  if (uc.status === 'enforced' && !tests.has(uc.id)) {
    // Unlike the two checks above, this one genuinely implicates a specific
    // use case in a state a PO could plausibly weigh in on (e.g. is this
    // still meant to be enforced?), so it does escalate.
    failFor(uc.id, `${uc.id} is enforced but has no test file under tests/usecases/`)
  }
}
for (const id of tests.keys()) {
  if (!seen.has(id)) fail(`Test file names ${id}, which is not in the registry`)
}
const debt = registry.use_cases.filter(uc => uc.status === 'pending' && !tests.has(uc.id))
if (debt.length) {
  console.log(`  ${debt.length} pending use case(s) with no test yet — coverage debt, not blocking`)
}

// --- 2. Lock check ---------------------------------------------------------
console.log('Lock check')
const lock = readLock()
if (!lock) {
  console.log('  no lock file yet — run: node scripts/uc-check.mjs --write-lock')
} else {
  for (const uc of registry.use_cases) {
    const previous = lock[uc.id]
    if (!previous) continue
    const changed = previous.hash !== hashUseCase(uc)
    if (changed && previous.spec_version === uc.spec_version) {
      failFor(
        uc.id,
        `${uc.id} spec text changed but spec_version is still ${uc.spec_version}.\n` +
        `      You are editing the product owner's words. Either revert, or have\n` +
        `      the PO bump spec_version and add a changelog entry.`,
      )
    }
  }
  // The loop above can only ever see ids that are still in the registry — it
  // walks registry.use_cases and looks up lock[uc.id]. Delete an enforced
  // use case's registry entry entirely and that lock entry is orphaned and
  // never read, so a locked (enforced) use case disappearing is invisible to
  // the check above. Close that hole by walking the lock itself and failing
  // for any id it remembers that the registry no longer has.
  for (const id of Object.keys(lock)) {
    if (seen.has(id)) continue
    failFor(
      id,
      `${id} is locked in registry.lock.json but no longer exists in docs/use-cases/registry.yaml.\n` +
      `      A locked use case was removed. Removing one requires the same authority as\n` +
      `      changing it — restore the entry, or have the PO approve the removal and\n` +
      `      re-run npm run uc:lock.`,
    )
  }
}

// --- 3 & 4. Run the tests --------------------------------------------------
// npx resolves to npx.cmd on win32. Node refuses to spawn a .cmd/.bat file
// directly unless shell: true is set (its 2024 Windows-batch-file security
// fix), so shell: true can't simply be dropped here — but shell: true does
// NOT escape or quote args for us; it only concatenates them (Node emits
// DEP0190 for exactly this reason). The bug this fixes is that concatenation:
// an absolute test-file path under a checkout whose directory contains a
// space (e.g. "C:\Users\Jane Doe\...") word-splits into two bogus arguments.
// Quoting every argument individually — including on the non-Windows path,
// which never used shell: true and so was never vulnerable to this, but
// gains nothing by staying inconsistent — closes that.
const isWin = process.platform === 'win32'
const NPX = isWin ? 'npx.cmd' : 'npx'

function runVitest(files) {
  if (files.length === 0) return true
  try {
    const args = ['vitest', 'run', ...files]
    if (isWin) {
      execFileSync(NPX, args.map(a => `"${a}"`), { stdio: 'inherit', shell: true })
    } else {
      execFileSync(NPX, args, { stdio: 'inherit' })
    }
    return true
  } catch {
    return false
  }
}

// Only use cases that actually contributed a test file to the enforced run —
// an enforced use case with no test file is already reported separately
// above ("is enforced but has no test file"), and must not be double-counted
// here as if its (nonexistent) test failed.
const enforcedUseCases = registry.use_cases.filter(uc => uc.status === 'enforced' && tests.has(uc.id))
const enforcedFiles = enforcedUseCases.flatMap(uc => tests.get(uc.id))

const pendingFiles = registry.use_cases
  .filter(uc => uc.status === 'pending')
  .flatMap(uc => tests.get(uc.id) ?? [])

console.log(`Enforced use-case tests (${enforcedFiles.length} file(s))`)
// Run each enforced use case's own test file(s) in its own vitest invocation
// so a failure is attributable to that use case alone. Running the whole
// enforced set in one vitest call (the previous approach) meant any single
// failure looked identical to every other one, and every enforced use case
// in the run got escalated together — a UC-C02 regression would fabricate a
// question about UC-C04 too, even though its test never ran into trouble.
for (const uc of enforcedUseCases) {
  const files = tests.get(uc.id)
  const passed = runVitest(files)
  if (!passed) {
    failFor(uc.id, `${uc.id}: enforced use-case test failed`)
  }
}

if (pendingFiles.length) {
  console.log(`Pending use-case tests (${pendingFiles.length} file(s)) — reporting only`)
  const passed = runVitest(pendingFiles)
  if (passed) {
    console.log('  All pending use-case tests PASS — flip them to enforced in registry.yaml')
  }
}

// --- Escalation ------------------------------------------------------------
// A question is a duplicate only if some OPEN section already raises the
// *same reason* for the *same id*. Keying on id alone was wrong in both
// directions:
//   - OPEN-QUESTIONS.md is append-only, so a RESOLVED section can sit above
//     a later OPEN one; .find() returned whichever came first regardless of
//     its status, so once a resolved entry existed a duplicate question got
//     appended on every subsequent failing run.
//   - conversely, any OPEN section whose header merely *lists* an id (e.g. a
//     multi-id investigation like Q-2026-09-07-02) permanently suppressed
//     every future automated question for that id, including for reasons
//     that section never addressed.
// Matching the reason text against each section's "Observed:" line (added
// below) fixes both: only a still-OPEN, already-generated question for this
// exact failure counts as a duplicate.
function alreadyOpen(id, reason) {
  if (!existsSync(QUESTIONS_PATH)) return false
  const text = readFileSync(QUESTIONS_PATH, 'utf8')
  return text.split('\n## ').some(section => {
    const headerLine = section.slice(0, section.indexOf('\n') === -1 ? section.length : section.indexOf('\n'))
    if (!headerLine.includes(id)) return false
    if (!/Status: OPEN/.test(section)) return false
    return section.includes(`Observed: ${reason}`)
  })
}

if (failures.length) {
  const date = new Date().toISOString().slice(0, 10)
  for (const { id, message } of escalations) {
    // A locked use case that was removed from the registry has no `uc` left
    // to look up title/requirement/then from — there is nothing to ask the
    // PO to reconsider in registry terms (the entry is simply gone). It
    // still blocked the commit via fail() above; it just doesn't also get a
    // fabricated OPEN-QUESTIONS.md entry with missing fields.
    const uc = registry.use_cases.find(u => u.id === id)
    if (!uc) continue
    if (alreadyOpen(id, message)) continue
    appendFileSync(
      QUESTIONS_PATH,
      [
        '',
        `## Q-${date}-${id} · ${id} · ${uc.title ?? '(missing title)'}`,
        `Raised: ${date} · commit blocked · ${uc.requirement ?? '(missing requirement)'}`,
        `Observed: ${message}`,
        `Spec (v${uc.spec_version ?? '?'}) says:`,
        ...(uc.then ?? []).map(t => `  THEN ${t}`),
        '',
        'PO decision needed — one of:',
        '  [ ] Spec stands -> code bug, fix the code, no registry change',
        '  [ ] Spec changes -> bump spec_version, add changelog entry, dev updates test',
        '  [ ] Spec ambiguous -> rewrite given/when/then, bump spec_version',
        'Status: OPEN',
        '',
      ].join('\n'),
    )
    console.error(`  → question appended to docs/use-cases/OPEN-QUESTIONS.md for ${id}`)
  }
  console.error(`\n${failures.length} problem(s). Commit blocked.`)
  process.exit(1)
}

console.log(`\nOK — ${enforcedFiles.length} enforced, ${debt.length} pending without tests. Stage: ${stage}.`)
process.exit(0)
