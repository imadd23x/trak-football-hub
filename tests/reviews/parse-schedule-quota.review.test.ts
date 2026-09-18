// Opt-in desired-behavior audit at PR41 268193c. Executes the checked-in Edge
// handler; only Deno serving/config, database transport and provider HTTP differ.
// npm exec -- vitest run tests/reviews/parse-schedule-quota.review.test.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

interface Query {
  select: (columns: string) => Query
  eq: (column: string, value: string) => Query
  maybeSingle: () => Promise<{ data: { role: string } | null; error: null }>
}
interface Options { anonymous?: boolean; role?: string; quota?: 'allowed' | 'denied' | 'error' }
const coachId = '99000000-0000-4000-8000-000000000041'
const events = [{ title: 'Synthetic adult training', event_type: 'training', starts_at: '2026-09-25T18:00:00+04:00' }]

function handlerFixture(options: Options = {}) {
  let handler: ((request: Request) => Promise<Response>) | undefined
  const sequence: string[] = []
  const provider = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('https://ai.gateway.lovable.dev/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string).messages).toHaveLength(2)
    sequence.push('provider')
    return new Response(JSON.stringify({ choices: [{ message: {
      tool_calls: [{ function: { arguments: JSON.stringify({ events }) } }],
    } }] }), { headers: { 'Content-Type': 'application/json' } })
  })
  const quota = vi.fn(async (name: string, args: Record<string, unknown>) => {
    expect(name).toBe('claim_ai_call')
    expect(args).toEqual({ p_function_name: 'parse-schedule', p_daily_limit: 40 })
    sequence.push('quota')
    return options.quota === 'error'
      ? { data: null, error: { message: 'Synthetic quota read failure' } }
      : { data: options.quota !== 'denied', error: null }
  })
  const database = {
    auth: { getUser: vi.fn(async () => {
      sequence.push('auth')
      return { data: { user: options.anonymous ? null : { id: coachId } }, error: null }
    }) },
    from: vi.fn((table: string) => {
      expect(table).toBe('profiles')
      const query: Query = {
        select: columns => { expect(columns).toBe('role'); return query },
        eq: (column, value) => { expect([column, value]).toEqual(['user_id', coachId]); return query },
        maybeSingle: async () => {
          sequence.push('profile')
          return { data: { role: options.role ?? 'coach' }, error: null }
        },
      }
      return query
    }),
    rpc: quota,
  }
  const original = readFileSync(resolve(process.cwd(), 'supabase/functions/parse-schedule/index.ts'), 'utf8')
  const source = original
    .replace(/^import \{ serve \} from "https:\/\/deno\.land\/std@0\.168\.0\/http\/server\.ts";\r?\n/m, '')
    .replace(/^import \{ createClient \} from "https:\/\/esm\.sh\/@supabase\/supabase-js@2\.39\.3";\r?\n/m, '')
  if (source.includes('import ')) throw new Error('Handler imports changed; review transport boundaries first')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const config: Record<string, string> = {
    LOVABLE_API_KEY: 'synthetic-provider-key', SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'synthetic-public-key',
  }
  runInNewContext(compiled, {
    serve: (callback: typeof handler) => { handler = callback },
    createClient: (url: string, key: string, options: { global: { headers: { Authorization: string } } }) => {
      expect(url).toBe(config.SUPABASE_URL)
      expect(key).toBe(config.SUPABASE_ANON_KEY)
      expect(options.global.headers.Authorization).toBe('Bearer synthetic-coach')
      return database
    },
    Deno: { env: { get: (name: string) => config[name] } },
    fetch: provider, Request, Response, console: { error: vi.fn() },
  })
  if (!handler) throw new Error('Handler did not register')
  const execute = (body = JSON.stringify({ text: 'Training 25 September at 18:00', todayISO: '2026-09-18' })) => handler!(
    new Request('https://test.invalid/parse-schedule', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-coach' }, body,
    }),
  )
  return { execute, provider, quota, database, sequence }
}

describe('PR41 parse-schedule quota review', () => {
  it('CONTROL: valid coach input claims once and reaches the provider only after authorization', async () => {
    const fixture = handlerFixture()
    const response = await fixture.execute()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ events })
    expect(fixture.quota).toHaveBeenCalledOnce()
    expect(fixture.provider).toHaveBeenCalledOnce()
    expect(fixture.sequence).toEqual(['auth', 'profile', 'quota', 'provider'])
  })

  it('CONTROL: an unauthenticated caller cannot query roles, claim allowance or call the provider', async () => {
    const fixture = handlerFixture({ anonymous: true })
    expect((await fixture.execute()).status).toBe(401)
    expect(fixture.database.from).not.toHaveBeenCalled()
    expect(fixture.quota).not.toHaveBeenCalled()
    expect(fixture.provider).not.toHaveBeenCalled()
  })

  it('CONTROL: a player cannot claim coach allowance or call the provider', async () => {
    const fixture = handlerFixture({ role: 'player' })
    expect((await fixture.execute()).status).toBe(403)
    expect(fixture.quota).not.toHaveBeenCalled()
    expect(fixture.provider).not.toHaveBeenCalled()
    expect(fixture.sequence).toEqual(['auth', 'profile'])
  })

  it.each([['denied', 429], ['error', 503]] as const)(
    'CONTROL: valid input with quota %s fails closed before provider access', async (quota, status) => {
      const fixture = handlerFixture({ quota })
      const response = await fixture.execute()
      expect(response.status).toBe(status)
      expect(await response.json()).toHaveProperty('error')
      expect(fixture.quota).toHaveBeenCalledOnce()
      expect(fixture.provider).not.toHaveBeenCalled()
    },
  )

  it.each([['empty input', '{}'], ['malformed JSON', '{']])(
    'does not consume a coach allowance for %s', async (_label, body) => {
      const fixture = handlerFixture()
      const response = await fixture.execute(body)
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(fixture.provider).not.toHaveBeenCalled()
      expect(fixture.database.auth.getUser).toHaveBeenCalledOnce()
      expect(fixture.database.from).toHaveBeenCalledWith('profiles')
      expect(fixture.quota, 'rejected input must not spend a daily call').not.toHaveBeenCalled()
    },
  )
})
