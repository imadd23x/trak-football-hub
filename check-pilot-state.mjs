// Legacy application-schema and rehearsal-account probe. Operational reports
// are intentionally excluded: verify them through the authorized SQL workflow.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = k => {
  const l = readFileSync('.env','utf8').split('\n').find(x=>x.startsWith(k+'='))
  return l ? l.slice(k.length+1).trim().replace(/^["']|["']$/g,'') : null
}
const sb = createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_PUBLISHABLE_KEY') || env('VITE_SUPABASE_ANON_KEY'),
  { auth: { persistSession:false, autoRefreshToken:false } })

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Sign in, retrying through rate limits.
 *
 * This script signs in a dozen times in quick succession and Supabase throttles
 * that, which reads exactly like a missing account. Retrying on 429 keeps the
 * report about the data rather than about the request rate.
 */
async function login(email, password) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password })
    if (data?.user) return data.user
    const rateLimited = error?.status === 429 || /rate limit/i.test(error?.message ?? '')
    if (!rateLimited) return null
    await sleep(1500 * (attempt + 1))
  }
  return null
}

const missing = m => /does not exist|schema cache|Could not find/i.test(m || '')

async function probe(label, fn) {
  const { error } = await fn()
  if (!error)                     return console.log(`  PRESENT   ${label}`)
  if (missing(error.message))     return console.log(`  MISSING   ${label}  -> ${error.message.slice(0,90)}`)
  // Any other error (401/permission) still proves the object exists.
  console.log(`  PRESENT   ${label}  (guarded: ${error.message.slice(0,50)})`)
}

console.log('\nMigration state\n')
await probe('telemetry_events        (migration 1)', () => sb.from('telemetry_events').select('id').limit(1))
await probe('matches.match_date      (migration 2)', () => sb.from('matches').select('match_date').limit(1))
await probe('matches.logged_by_role  (migration 2)', () => sb.from('matches').select('logged_by_role').limit(1))
await probe('pilot_config            (migration 3)', () => sb.from('pilot_config').select('starts_on').limit(1))
console.log('  SKIPPED   operational reports are intentionally restricted; verify through the authorized SQL workflow in docs/pilot-runbook.md. Application credentials cannot verify their contents or migration state.')

console.log('\nRehearsal seed\n')

const PW = 'RehearsalTrak123!'
const D  = 'rehearsal.trak.dev'

const dirUser = await login(`director@${D}`, PW)
if (!dirUser) {
  console.log('  NOT SEEDED  the rehearsal director account does not exist yet\n')
} else {
  const { data: prof } = await sb.from('profiles').select('role, full_name')
    .eq('user_id', dirUser.id).maybeSingle()
  const { data: org } = await sb.from('organizations').select('id, name, join_code')
    .eq('admin_user_id', dirUser.id).maybeSingle()
  console.log(`  director    ${prof ? prof.full_name + ' (' + prof.role + ')' : 'PROFILE MISSING'}`)
  console.log(`  org         ${org ? org.name + ' — join code ' + org.join_code : 'MISSING'}`)

  // Per coach. RLS scopes a club admin's view, so coach-side counts are the
  // only accurate ones; reading them as the director under-reports.
  const totals = { rows: 0, linked: 0, fixtures: 0, matches: 0, assessments: 0 }
  for (const email of [`coach.u15@${D}`, `coach.u17@${D}`, `coach.gk@${D}`]) {
    const cu = await login(email, PW)
    if (!cu) { console.log(`\n  ${email}\n    could not sign in (rate limited or missing)`); continue }
    const c = { user: cu }
    const { data: cp } = await sb.from('profiles').select('role, full_name, invite_code')
      .eq('user_id', c.user.id).maybeSingle()
    const { data: cd } = await sb.from('coach_details').select('team, organization_id')
      .eq('user_id', c.user.id).maybeSingle()
    const { data: squad } = await sb.from('squad_players')
      .select('id, player_name, linked_player_id').eq('coach_user_id', c.user.id)
    const { count: fx } = await sb.from('coach_calendar_events')
      .select('id', { count: 'exact', head: true }).eq('coach_user_id', c.user.id)
    const { count: asmt } = await sb.from('coach_assessments')
      .select('id', { count: 'exact', head: true }).eq('coach_user_id', c.user.id)

    const rows = squad?.length ?? 0
    const linked = (squad ?? []).filter(r => r.linked_player_id).length
    // Only the player may read their own matches — a coach counting them gets
    // zero from RLS, not from absence. So sample a few players directly.
    const claimed = (squad ?? []).filter(r => r.linked_player_id)
    let matches = 0, sampled = 0
    for (const r of claimed.slice(0, 3)) {
      const slug = r.player_name.toLowerCase().replace(/[^a-z]+/g, '.')
      const pu = await login(`${slug}@${D}`, PW)
      if (!pu) continue
      const { count } = await sb.from('matches')
        .select('id', { count: 'exact', head: true }).eq('user_id', pu.id)
      matches += count ?? 0; sampled++
    }
    await login(email, PW)
    totals.rows += rows; totals.linked += linked
    totals.fixtures += fx ?? 0; totals.matches += matches; totals.assessments += asmt ?? 0

    console.log(`\n  ${email}`)
    console.log(`    profile     ${cp ? cp.role + ' / ' + cp.full_name : 'MISSING'}   code TRK-${cp?.invite_code ?? '—'}`)
    console.log(`    team/org    ${cd ? cd.team + (cd.organization_id ? ' / in org' : ' / NO ORG') : 'MISSING'}`)
    console.log(`    squad       ${rows} rows (${linked} claimed, ${rows - linked} awaiting signup)`)
    console.log(`    fixtures    ${fx ?? 0}`)
    console.log(`    matches     ${matches} across ${sampled} sampled players (expect ~5 each)`)
    console.log(`    assessments ${asmt ?? 0}`)
  }
  console.log(`\n  TOTAL       ${totals.rows} squad rows · ${totals.linked} claimed · ${totals.fixtures} fixtures · ${totals.assessments} assessments`)
  console.log(`  expected    ~30 squad rows · ~15 claimed · 12 fixtures · ~75 assessments\n`)
}
