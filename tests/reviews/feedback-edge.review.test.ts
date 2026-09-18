// Desired behavior audit: intentionally fails while PR40 accepts unusable model
// output. Opt-in: npx vitest run tests/reviews/feedback-edge.review.test.ts
// Executes the actual checked-in handler. Only Deno serving/config, the database
// transport and provider HTTP boundary are substituted; no external calls.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

interface DraftWrite { generated_text: string; assessment_id: string; squad_player_id: string }
interface FixtureQuery {
  select: () => FixtureQuery
  eq: () => FixtureQuery
  insert: (row: DraftWrite) => FixtureQuery
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>
}
const goodPoint = { title: 'First touch', what: 'Control the ball.', why: 'Keep possession.', drill: 'Practise receiving.' }
const goodFeedback = { points: [goodPoint, goodPoint, goodPoint], encouragement: 'Keep practising.' }

function handlerFixture(feedback: unknown, options: { role?: string; saveFails?: boolean } = {}) {
  let handler: ((request: Request) => Promise<Response>) | undefined
  const writes: DraftWrite[] = []
  const provider = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(feedback) } }] }),
    { headers: { 'Content-Type': 'application/json' } }))
  const database = {
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-coach' } }, error: null }) },
    from: (table: string) => {
      const query: FixtureQuery = {
        select: () => query,
        eq: () => query,
        insert: (row: DraftWrite) => { writes.push(row); return query },
        maybeSingle: async () => {
          if (table === 'profiles') return { data: { role: options.role ?? 'coach' }, error: null }
          if (table === 'coach_assessments') return { data: { id: 'assessment-a', squad_player_id: 'adult-a', coach_rating: 7,
            work_rate: 7, tactical: 7, attitude: 7, technical: 7, physical: 7, coachability: 7, appearance: 'match' }, error: null }
          if (table === 'squad_players') return { data: { id: 'adult-a', player_name: 'Synthetic Adult', position: 'midfielder' }, error: null }
          if (table === 'coach_assessment_notes') return { data: null, error: null }
          if (table === 'ai_feedback_drafts') return options.saveFails
            ? { data: null, error: { message: 'Synthetic persistence failure' } }
            : { data: { id: 'draft-a' }, error: null }
          throw new Error(`Unmocked table ${table}`)
        },
      }
      return query
    },
  }
  const original = readFileSync(resolve(process.cwd(), 'supabase/functions/player-feedback/index.ts'), 'utf8')
  // Keep all handler logic verbatim; remove exactly the two remote imports.
  const source = original.replace(/^import \{ serve \} from "https:\/\/deno\.land\/std@0\.168\.0\/http\/server\.ts";\r?\n/m, '')
    .replace(/^import \{ createClient \} from "https:\/\/esm\.sh\/@supabase\/supabase-js@2\.45\.0";\r?\n/m, '')
  if (source.includes('import ')) throw new Error('Handler imports changed; review transport boundary before running')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const config: Record<string, string> = { LOVABLE_API_KEY: 'synthetic-provider-key', SUPABASE_URL: 'https://test.invalid',
    SUPABASE_ANON_KEY: 'synthetic-public-key' }
  runInNewContext(compiled, {
    serve: (callback: typeof handler) => { handler = callback }, createClient: () => database,
    Deno: { env: { get: (name: string) => config[name] } },
    fetch: provider, Request, Response, console: { error: vi.fn() },
  })
  if (!handler) throw new Error('Handler was not registered')
  const execute = () => handler!(new Request('https://test.invalid/player-feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic' },
    body: JSON.stringify({ assessment_id: 'assessment-a' }),
  }))
  return { execute, writes, provider }
}

describe('PR40 edge payload audit', () => {
  it('control: a valid note-free adult draft is saved before success', async () => {
    const fixture = handlerFixture(goodFeedback)
    const response = await fixture.execute()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ draft_id: 'draft-a', feedback: goodFeedback })
    expect(fixture.writes).toHaveLength(1)
    expect(JSON.parse(fixture.writes[0].generated_text)).toEqual(goodFeedback)
    expect(fixture.provider).toHaveBeenCalledOnce()
  })

  it('control: a player is refused before reading a model response or writing a draft', async () => {
    const fixture = handlerFixture(goodFeedback, { role: 'player' })
    expect((await fixture.execute()).status).toBe(403)
    expect(fixture.writes).toEqual([])
    expect(fixture.provider).not.toHaveBeenCalled()
  })

  it('control: a persistence failure is not reported as saved', async () => {
    const fixture = handlerFixture(goodFeedback, { saveFails: true })
    expect((await fixture.execute()).status).toBe(500)
    expect(fixture.writes).toHaveLength(1)
  })

  it.each([
    ['null point', { points: [null], encouragement: 'Keep practising.' }],
    ['missing point fields', { points: [{}], encouragement: 'Keep practising.' }],
    ['object field', { points: [{ ...goodPoint, title: { unexpected: true } }], encouragement: 'Keep practising.' }],
    ['invalid encouragement', { points: [goodPoint, goodPoint, goodPoint], encouragement: { unexpected: true } }],
  ])('rejects %s before persisting an unusable draft', async (_label, feedback) => {
    const fixture = handlerFixture(feedback)
    const response = await fixture.execute()
    expect.soft(response.status).toBeGreaterThanOrEqual(400)
    expect.soft(fixture.writes, 'malformed model output must never become a saved draft').toEqual([])
  })
})
