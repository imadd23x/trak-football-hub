/**
 * Seed script — populates the admin dashboard with realistic test data.
 * Run: node seed-admin-data.mjs (explicit TRAK_TEST_* environment)
 * Target instructions: docs/testing/test-project-boundary.md
 */

import { createClient } from '@supabase/supabase-js'

import { requireTestTarget } from './scripts/testing/supabase-test-target.mjs'

// Test-only executable: no production/default target and no operator exception.
let target
try {
  if (process.argv.length > 2) throw new Error('seed-admin-data.mjs accepts no CLI target override')
  target = requireTestTarget(process.env)
} catch (error) { console.error(error.message); process.exit(1) }

const now = Date.now()
const daysAgo = (d) => new Date(now - d * 86400000).toISOString()

// Never literals. These accounts live in the explicitly selected test project,
// and this repository is public.
const OLD_PW = process.env.TRAK_DEV_OLD_PASSWORD
const NEW_PW = process.env.TRAK_DEV_PASSWORD
if (!OLD_PW || !NEW_PW) {
  console.error('Set TRAK_DEV_OLD_PASSWORD and TRAK_DEV_PASSWORD in the environment.')
  process.exit(1)
}

const supabase = createClient(target.url, target.key)

async function signIn(email) {
  // Try old password first, then new
  let { data, error } = await supabase.auth.signInWithPassword({ email, password: OLD_PW })
  if (error) {
    const r = await supabase.auth.signInWithPassword({ email, password: NEW_PW })
    data = r.data; error = r.error
  }
  if (error) console.log(`   Sign-in failed for ${email}:`, error.message)
  return data?.user ?? null
}

async function signUpAndIn(email) {
  // Try sign-up with new password
  const { data: su, error: suErr } = await supabase.auth.signUp({ email, password: NEW_PW })
  if (suErr) {
    console.log(`   Sign-up note for ${email}:`, suErr.message)
  }
  // If sign-up created a user or user already exists, sign in
  return signIn(email)
}

async function main() {
  console.log('=== Seeding admin dashboard data ===\n')

  // ── 1. Sign in as club admin ──────────────────────────────────
  console.log('1. Signing in as club admin...')
  const clubUser = await signIn('club@trak.dev')
  if (!clubUser) { console.error('   FAILED'); return }
  console.log('   Club admin ID:', clubUser.id)

  // Check / create org
  const { data: existingOrg } = await supabase
    .from('organizations')
    .select('id, join_code')
    .eq('admin_user_id', clubUser.id)
    .maybeSingle()

  let orgId
  if (existingOrg) {
    orgId = existingOrg.id
    console.log('   Org exists:', orgId, '(TRK-' + existingOrg.join_code + ')')
  } else {
    const { data: newOrg, error: orgErr } = await supabase
      .from('organizations')
      .insert({ admin_user_id: clubUser.id, name: 'City FC Academy', join_code: 'CITY' })
      .select('id').single()
    if (orgErr) { console.error('   Org error:', orgErr.message); return }
    orgId = newOrg.id
    console.log('   Created org:', orgId)
  }

  // ── 2. Set up coaches ─────────────────────────────────────────
  const coachDefs = [
    { email: 'coach@trak.dev',  name: 'Alex Martinez',    team: 'U15s', role: 'Head Coach',      existing: true },
    { email: 'coach2@trak.dev', name: 'Daniella Foster',  team: 'U13s', role: 'Lead Coach' },
    { email: 'coach3@trak.dev', name: 'Marcus Thompson',  team: 'U11s', role: 'Assistant Coach' },
  ]

  const coachUsers = []

  for (const c of coachDefs) {
    console.log(`\n2. Coach: ${c.name} (${c.email})`)
    await supabase.auth.signOut()

    const user = c.existing ? await signIn(c.email) : await signUpAndIn(c.email)
    if (!user) { console.log('   SKIPPED — cannot authenticate'); continue }
    console.log('   ID:', user.id)

    // Ensure signed in as this user
    await supabase.auth.signOut()
    await signIn(c.email)

    // Profile
    await supabase.from('profiles').upsert({
      user_id: user.id, role: 'coach', full_name: c.name,
      invite_code: c.name.split(' ')[0].toUpperCase().slice(0, 4)
    }, { onConflict: 'user_id' })

    // Coach details + org link
    await supabase.from('coach_details').upsert({
      user_id: user.id, current_club: 'City FC Academy',
      team: c.team, coach_role: c.role, organization_id: orgId
    }, { onConflict: 'user_id' })

    coachUsers.push({ id: user.id, ...c })
    console.log('   ✓ Profile + details')
  }

  // ── 3. Squad players + assessments per coach ──────────────────
  const squads = {
    'U15s': [
      { name: 'Jamie Wilson',   pos: 'CM', age: 14 },
      { name: 'Ethan Brooks',   pos: 'RW', age: 14 },
      { name: 'Noah Clarke',    pos: 'CB', age: 14 },
      { name: 'Liam Patel',     pos: 'ST', age: 15 },
      { name: 'Oscar Hughes',   pos: 'LB', age: 14 },
      { name: 'Lucas Adams',    pos: 'GK', age: 15 },
      { name: 'Harrison Scott', pos: 'DM', age: 14 },
    ],
    'U13s': [
      { name: 'Kai Reynolds',   pos: 'CM', age: 12 },
      { name: 'Jayden Cooper',  pos: 'ST', age: 13 },
      { name: 'Tyler Bennett',  pos: 'CB', age: 12 },
      { name: 'Finley Morgan',  pos: 'RW', age: 13 },
      { name: 'Archie Hill',    pos: 'LB', age: 12 },
      { name: 'Zac Turner',     pos: 'GK', age: 13 },
    ],
    'U11s': [
      { name: 'Alfie Green',    pos: 'CM', age: 10 },
      { name: 'Charlie Price',  pos: 'ST', age: 11 },
      { name: 'Freddie Evans',  pos: 'CB', age: 10 },
      { name: 'George Ward',    pos: 'RW', age: 11 },
      { name: 'Leo Mitchell',   pos: 'GK', age: 10 },
    ],
  }

  for (const coach of coachUsers) {
    console.log(`\n3. Seeding players for ${coach.name} (${coach.team})...`)
    await supabase.auth.signOut()
    await signIn(coach.email)

    const players = squads[coach.team] || []
    const sqIds = []

    for (const p of players) {
      const { data: ex } = await supabase
        .from('squad_players')
        .select('id')
        .eq('coach_user_id', coach.id)
        .eq('player_name', p.name)
        .maybeSingle()

      if (ex) { sqIds.push(ex.id); continue }

      const { data: sp, error } = await supabase
        .from('squad_players')
        .insert({ coach_user_id: coach.id, player_name: p.name, position: p.pos, age: p.age, status: 'active' })
        .select('id').single()
      if (error) { console.log(`   Error: ${p.name}:`, error.message); continue }
      sqIds.push(sp.id)
    }
    console.log(`   ✓ ${sqIds.length} squad players`)

    // Assessments
    let assessmentCount = 0
    for (const sqId of sqIds) {
      const { data: exA } = await supabase
        .from('coach_assessments')
        .select('id').eq('squad_player_id', sqId).limit(1)
      if (exA?.length) continue

      const n = 2 + Math.floor(Math.random() * 2)
      for (let j = 0; j < n; j++) {
        const base = 5 + Math.floor(Math.random() * 4)
        const v = () => Math.max(1, Math.min(10, base + Math.floor(Math.random() * 3) - 1))
        await supabase.from('coach_assessments').insert({
          coach_user_id: coach.id, squad_player_id: sqId,
          appearance: Math.random() > 0.3 ? 'started' : 'sub',
          work_rate: v(), tactical: v(), attitude: v(),
          technical: v(), physical: v(), coachability: v(),
          flag: Math.random() > 0.7 ? 'generous' : 'fair',
          coach_name_snapshot: coach.name,
          created_at: daysAgo(j * 7 + Math.floor(Math.random() * 4)),
        })
        assessmentCount++
      }
    }
    console.log(`   ✓ ${assessmentCount} assessments`)

    // One award
    if (sqIds.length > 0) {
      const { data: exAw } = await supabase
        .from('recognition_awards')
        .select('id').eq('coach_user_id', coach.id).limit(1)
      if (!exAw?.length) {
        await supabase.from('recognition_awards').insert({
          coach_user_id: coach.id,
          squad_player_id: sqIds[Math.floor(Math.random() * sqIds.length)],
          award_type: 'player_of_week', awarded_for: 'Week of 2 Jun',
          note: 'Outstanding effort in training.', coach_name_snapshot: coach.name,
          created_at: daysAgo(3),
        })
        console.log('   ✓ Award')
      }
    }
  }

  await supabase.auth.signOut()
  console.log('\n=== Done! Sign in as club@trak.dev / ' + OLD_PW + ' ===')
}

main().catch(console.error)
