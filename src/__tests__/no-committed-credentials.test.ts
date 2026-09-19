import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

// The dev-account password was a literal in LandingPage.tsx, DevSetupPage.tsx
// and DevSwitcher.tsx. The /dev-setup ROUTE is registered behind
// `import.meta.env.DEV`, which is why this looked safe — but that guard decides
// which routes register, not which chunks Rollup emits. The built bundle shipped
// dist/assets/DevSetupPage-*.js containing the password twelve times, referenced
// from the entry bundle, on a public site. LandingPage.tsx is in the entry
// bundle itself, so its copy shipped to every visitor unconditionally.
//
// A grep is the right shape here, unlike the band-colour case where the palette
// shares its hexes with the brand accent. A credential has no second meaning.

const ROOT = resolve(__dirname, '../..')
const SEARCH_DIRS = ['src', 'scripts', 'supabase/functions']
const SEARCH_FILES = ['seed-pilot-rehearsal.mjs', 'seed-admin-data.mjs', 'check-pilot-state.mjs']

// Known-leaked values. Keep rotated values OUT of this list — naming a live
// credential here would recommit the thing this test exists to prevent. These
// are burned and must never work again.
const BURNED = ['TrakDev123', 'RehearsalTrak123']

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) out.push(full)
    }
  }
  for (const dir of SEARCH_DIRS) walk(join(ROOT, dir))
  for (const file of SEARCH_FILES) {
    try { statSync(join(ROOT, file)); out.push(join(ROOT, file)) } catch { /* removed */ }
  }
  return out
}

describe('no committed credentials', () => {
  const files = sourceFiles()

  it('finds source to check, so a passing run means something', () => {
    // Without this, a broken walk would report "no leaks" and look identical
    // to a clean tree.
    expect(files.length).toBeGreaterThan(100)
  })

  for (const secret of BURNED) {
    it(`does not contain the burned credential ${secret}`, () => {
      const offenders = files
        .filter(file => file !== resolve(__dirname, 'no-committed-credentials.test.ts'))
        .filter(file => readFileSync(file, 'utf8').includes(secret))
        .map(file => file.slice(ROOT.length + 1))
      expect(offenders, `${secret} is back in: ${offenders.join(', ')}`).toEqual([])
    })
  }

  it('the dev password is read from the environment, never assigned a literal', () => {
    const assignments: string[] = []
    for (const file of files) {
      // Test fixtures legitimately carry synthetic passwords. The burned-value
      // checks above still apply to them.
      if (/__tests__|\.test\.|\.spec\./.test(file)) continue
      const text = readFileSync(file, 'utf8')
      // password: 'literal'  /  const PW = 'literal'  — but not env reads.
      for (const match of text.matchAll(/(?:password|PW|DEV_PASSWORD)\s*[:=]\s*(['"`])([^'"`]{6,})\1/gi)) {
        assignments.push(`${file.slice(ROOT.length + 1)}: ${match[2].slice(0, 4)}…`)
      }
    }
    expect(assignments, `literal password assignments: ${assignments.join(' | ')}`).toEqual([])
  })
})
