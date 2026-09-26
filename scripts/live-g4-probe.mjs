// ============================================================
// TRAK-15 (G4) live probe: run the coach_notes_privacy negatives against the
// DEPLOYED backend, as the synthetic Rehearsal FC accounts, through the same
// REST API the app uses.
//
//   TRAK_REHEARSAL_PASSWORD=... node scripts/live-g4-probe.mjs
//
// The password is the shared rehearsal one (Slack group DM). It is read from
// the environment only; never commit it, paste it into CI, or print it.
// URL and publishable key come from the environment or .env, like the app.
//
// Prints counts and error codes, never message or note text.
//
// It must not be able to change data, even if a policy is wrong:
//   * INSERTs target assessments that already have a row, and both tables are
//     UNIQUE(assessment_id). RLS WITH CHECK runs before the unique index, so a
//     correct refusal is 42501 and a wrongly-allowed insert fails 23505.
//   * UPDATEs set a column to the value it already has.
//   * DELETEs target a random id that matches nothing.
//   * Z1 re-reads everything at the end and compares.
//
// The fixture ids are Rehearsal FC rows (seeded, synthetic). If the rehearsal
// data is re-seeded, re-pick them: two published, noted assessments of one
// child under coach.u15, another family's published one under the same coach,
// and a published one whose child is consent-blocked.
// ============================================================
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const fromDotEnv = (k) => {
  if (!existsSync('.env')) return undefined
  return readFileSync('.env', 'utf8').match(new RegExp(`^${k}="?([^"\\n]+)"?`, 'm'))?.[1]
}
const URL = process.env.VITE_SUPABASE_URL ?? fromDotEnv('VITE_SUPABASE_URL')
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? fromDotEnv('VITE_SUPABASE_PUBLISHABLE_KEY')
const PW = process.env.TRAK_REHEARSAL_PASSWORD
if (!URL || !KEY || !PW) {
  console.error('Needs VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and TRAK_REHEARSAL_PASSWORD.')
  process.exit(2)
}

const DOMAIN = '@rehearsal.trak.dev'
const CHILD = 'andreas.papadakis'
const OWN = ['444a067f-97b1-49e6-9d80-706b4668cdb7', '6f22e040-b583-4f88-a1c5-f31e527b2d06']
const OTHER_FAMILY = '1880e5b1-268c-4708-acaf-544c2be449bc'
const CONSENT_BLOCKED = '548d036e-c2b9-4dd4-9633-cc19252bf4ca'

const results = []
const check = (id, ok, detail) => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`)
}
const code = (e) => (e ? e.code || e.status || 'err' : 'none')

async function login(local) {
  const c = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.signInWithPassword({ email: local + DOMAIN, password: PW })
  if (error) throw new Error(`sign-in failed for ${local}: ${error.message}`)
  return { c, uid: data.user.id, token: data.session.access_token }
}

// Bypass attempts shared by the child and the parent: straight at the API.
async function bypasses(tag, u, coachUid, msgBody) {
  const now = new Date().toISOString()
  const i1 = await u.c.from('coach_shared_feedback').insert({ assessment_id: OWN[0], coach_user_id: coachUid, body: 'G4-PROBE', published_at: now })
  check(`${tag}7 cannot write a message posing as the coach`, code(i1.error) === '42501', `code=${code(i1.error)}`)
  const i2 = await u.c.from('coach_shared_feedback').insert({ assessment_id: OWN[0], coach_user_id: u.uid, body: 'G4-PROBE', published_at: now })
  check(`${tag}8 cannot write a message as themselves`, code(i2.error) === '42501', `code=${code(i2.error)}`)
  const i3 = await u.c.from('coach_assessment_notes').insert({ assessment_id: OWN[0], coach_user_id: coachUid, note: 'G4-PROBE' })
  check(`${tag}9 cannot write a private note`, code(i3.error) === '42501', `code=${code(i3.error)}`)
  const u1 = await u.c.from('coach_shared_feedback').update({ body: msgBody[OWN[0]] }).eq('assessment_id', OWN[0]).select('id')
  check(`${tag}10 cannot edit the message (same-value update)`, !u1.error && u1.data?.length === 0, `rows=${u1.data?.length} code=${code(u1.error)}`)
  const u2 = await u.c.from('coach_assessment_notes').update({ coach_user_id: coachUid }).eq('assessment_id', OWN[0]).select('id')
  check(`${tag}11 cannot touch the private note (same-value update)`, !u2.error && u2.data?.length === 0, `rows=${u2.data?.length} code=${code(u2.error)}`)
  const d1 = await u.c.from('coach_shared_feedback').delete().eq('id', randomUUID())
  const d2 = await u.c.from('coach_assessment_notes').delete().eq('id', randomUUID())
  check(`${tag}12 no delete right on either table`, code(d1.error) === '42501' && code(d2.error) === '42501', `msg=${code(d1.error)} note=${code(d2.error)}`)
  const r1 = await u.c.rpc('publish_player_feedback', { p_squad_player_id: randomUUID(), p_text: 'G4-PROBE' })
  check(`${tag}13 AI publisher refused`, code(r1.error) === '42501', `code=${code(r1.error)}`)
  const pf = await u.c.from('player_feedback').select('id').limit(1)
  check(`${tag}14 AI feedback table closed`, code(pf.error) === '42501', `code=${code(pf.error)}`)
}

try {
  // ── Coach: controls, and the texts the family reads are compared against ──
  const coach = await login('coach.u15')
  const { data: cNotes } = await coach.c.from('coach_assessment_notes').select('assessment_id, note').in('assessment_id', OWN)
  check('K1 control: coach reads own private notes', cNotes?.length === 2, `rows=${cNotes?.length}`)
  const { data: cMsgs } = await coach.c.from('coach_shared_feedback').select('assessment_id, body, published_at, coach_user_id').in('assessment_id', OWN)
  check('K2 control: coach reads own published messages', cMsgs?.length === 2 && cMsgs.every((m) => m.published_at && m.coach_user_id === coach.uid), `rows=${cMsgs?.length}`)
  const noteTexts = (cNotes || []).map((n) => n.note).filter(Boolean)
  const msgBody = Object.fromEntries((cMsgs || []).map((m) => [m.assessment_id, m.body]))

  const rpc = await coach.c.rpc('publish_player_feedback', { p_squad_player_id: randomUUID(), p_text: 'G4-PROBE' })
  check('K3 AI publisher refused for the coach', code(rpc.error) === '42501', `code=${code(rpc.error)}`)
  const fn = await fetch(`${URL}/functions/v1/player-feedback`, {
    method: 'POST', body: '{}',
    headers: { Authorization: `Bearer ${coach.token}`, apikey: KEY, 'Content-Type': 'application/json' },
  })
  const fnBody = await fn.json().catch(() => ({}))
  check('K4 AI feedback function refuses the coach', fn.status === 403 && fnBody.code === 'PILOT_FEATURE_DISABLED', `status=${fn.status} code=${fnBody.code}`)
  const pf = await coach.c.from('player_feedback').select('id').limit(1)
  const dr = await coach.c.from('ai_feedback_drafts').select('id').limit(1)
  check('K5 AI tables closed to the coach', code(pf.error) === '42501' && code(dr.error) === '42501', `player_feedback=${code(pf.error)} drafts=${code(dr.error)}`)

  const other = await login('coach.u17')
  const { data: oNotes } = await other.c.from('coach_assessment_notes').select('assessment_id').in('assessment_id', OWN)
  check('O1 another coach reads none of coach.u15 private notes', oNotes?.length === 0, `rows=${oNotes?.length}`)

  // ── The child: reads the coach's published words, and nothing else ──
  const child = await login(CHILD)
  {
    const { data: a } = await child.c.from('coach_assessments').select('id').in('id', OWN)
    check('C1 control: child reads their assessments', a?.length === 2, `rows=${a?.length}`)
    const n1 = await child.c.from('coach_assessment_notes').select('assessment_id').in('assessment_id', OWN)
    const n2 = await child.c.from('coach_assessment_notes').select('assessment_id')
    check('C2 private note unreadable, by id and at all', !n1.error && n1.data?.length === 0 && n2.data?.length === 0, `byId=${n1.data?.length} all=${n2.data?.length}`)
    const { data: m } = await child.c.from('coach_shared_feedback').select('assessment_id, body, published_at, coach_user_id')
    const own = (m || []).filter((r) => OWN.includes(r.assessment_id))
    check('C3 positive: reads the coach\'s published message, word for word',
      own.length === 2 && own.every((r) => r.body === msgBody[r.assessment_id] && r.coach_user_id === coach.uid && r.published_at), `own=${own.length} total=${m?.length}`)
    check('C4 every visible message is published and written by the child\'s coach',
      (m || []).length > 0 && m.every((r) => r.published_at && r.coach_user_id === coach.uid), `rows=${m?.length}`)
    check('C5 another family\'s message (same coach) is invisible', !(m || []).some((r) => r.assessment_id === OTHER_FAMILY), 'absent')
    check('C6 a consent-blocked child\'s message is invisible', !(m || []).some((r) => r.assessment_id === CONSENT_BLOCKED), 'absent')
    await bypasses('C', child, coach.uid, msgBody)
    const { data: ex, error } = await child.c.rpc('export_my_account')
    const s = JSON.stringify(ex || {})
    check('C15 child\'s data export carries no private note',
      !error && s.length > 2 && !s.includes('coach_assessment_notes') && noteTexts.length === 2 && noteTexts.every((t) => !s.includes(t)),
      `exportBytes=${s.length} notesChecked=${noteTexts.length} code=${code(error)}`)
  }

  // ── The parent: the bands, never the message (TRAK-63, closed by TRAK-15) ──
  const parent = await login(`parent.${CHILD}`)
  {
    const { data: a } = await parent.c.from('coach_assessments').select('id').in('id', OWN)
    check('P1 control: parent reads the child\'s assessments (the bands)', a?.length === 2, `rows=${a?.length}`)
    const n1 = await parent.c.from('coach_assessment_notes').select('assessment_id').in('assessment_id', OWN)
    const n2 = await parent.c.from('coach_assessment_notes').select('assessment_id')
    check('P2 private note unreadable, by id and at all', !n1.error && n1.data?.length === 0 && n2.data?.length === 0, `byId=${n1.data?.length} all=${n2.data?.length}`)
    const own = await parent.c.from('coach_shared_feedback').select('assessment_id').in('assessment_id', OWN)
    check('P3 the child\'s published message is not readable by the parent', !own.error && own.data?.length === 0, `rows=${own.data?.length} code=${code(own.error)}`)
    const all = await parent.c.from('coach_shared_feedback').select('assessment_id')
    check('P4 no message at all is readable by the parent', !all.error && all.data?.length === 0, `rows=${all.data?.length}`)
    await bypasses('P', parent, coach.uid, msgBody)
  }

  // ── Nothing moved ──
  const { data: after } = await coach.c.from('coach_shared_feedback').select('assessment_id, body, published_at').in('assessment_id', OWN)
  const { data: afterN } = await coach.c.from('coach_assessment_notes').select('assessment_id, note').in('assessment_id', OWN)
  check('Z1 no data changed by the probe',
    after?.length === 2 && after.every((r) => r.body === msgBody[r.assessment_id] && cMsgs.find((x) => x.assessment_id === r.assessment_id).published_at === r.published_at)
      && afterN?.length === 2 && afterN.every((n) => noteTexts.includes(n.note)),
    'messages, publish times and notes identical')
} catch (e) {
  console.log('ERROR', e.message)
  results.push(false)
}

const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} passed, ${failed} failed · ${URL} · ${new Date().toISOString()}`)
process.exitCode = failed ? 1 : 0
