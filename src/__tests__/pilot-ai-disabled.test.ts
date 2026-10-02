import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

const endpoints = ['coach-assistant', 'parse-schedule', 'player-feedback'] as const
type Handler = (request: Request) => Response | Promise<Response>

/**
 * Execute each real entry point and capture the handler it registers with Deno's
 * HTTP server. Transpiling rather than rewriting its source lets Vitest execute
 * Deno URL imports; only the HTTP listener and external dependencies are mocked.
 * Any Supabase or provider access fails closed and is independently asserted.
 */
function loadEndpoint(name: typeof endpoints[number]) {
  const handlers: Handler[] = []
  const serve = vi.fn((handler: Handler) => { handlers.push(handler) })
  const createClient = vi.fn(() => { throw new Error('Supabase must not be accessed') })
  const fetch = vi.fn(() => { throw new Error('External requests must not be made') })
  const envGet = vi.fn(() => 'true') // Configured secrets/enable flags cannot reopen AI.
  const errorLog = vi.fn()

  function loadModule(filename: string): Record<string, unknown> {
    const source = readFileSync(filename, 'utf8')
    const { outputText } = transpileModule(source, {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
      fileName: filename,
    })
    const exports: Record<string, unknown> = {}
    runInNewContext(outputText, {
      exports,
      Response,
      Request,
      Headers,
      fetch,
      Deno: { serve, env: { get: envGet } },
      console: { error: errorLog, log: vi.fn(), warn: vi.fn() },
      require: (specifier: string) => {
        if (specifier === 'https://deno.land/std@0.168.0/http/server.ts') return { serve }
        if (specifier.startsWith('https://esm.sh/@supabase/supabase-js@')) return { createClient }
        if (specifier.startsWith('.')) return loadModule(resolve(dirname(filename), specifier))
        throw new Error(`Unexpected dependency in disabled endpoint: ${specifier}`)
      },
    }, { filename })
    return exports
  }

  loadModule(join(process.cwd(), 'supabase', 'functions', name, 'index.ts'))
  expect(handlers).toHaveLength(1)
  return { handle: handlers[0], createClient, fetch, envGet, errorLog }
}

function assertNoProcessing(endpoint: ReturnType<typeof loadEndpoint>) {
  expect(endpoint.envGet).not.toHaveBeenCalled()
  expect(endpoint.createClient).not.toHaveBeenCalled()
  expect(endpoint.fetch).not.toHaveBeenCalled()
  expect(endpoint.errorLog).not.toHaveBeenCalled()
}

const sensitivePayload = JSON.stringify({
  messages: [{ role: 'user', content: 'Private player information' }],
  includeSquadContext: true,
  text: 'Private academy schedule',
  imageBase64: 'private-image-data',
  assessment_id: 'private-assessment-id',
  pilot: false,
  ai_enabled: true,
})

describe.each(endpoints)('%s pilot AI boundary', (name) => {
  it.each(['anonymous', 'player', 'parent', 'coach', 'academy_admin', 'admin', 'service_role'])(
    'rejects %s callers without reading their payload or invoking dependencies',
    async (role) => {
      const endpoint = loadEndpoint(name)
      const token = ['header', Buffer.from(JSON.stringify({ role, sub: 'caller' })).toString('base64url'), 'signature'].join('.')
      const request = new Request(`https://example.test/functions/v1/${name}?ai_enabled=true&pilot=false`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(role === 'anonymous' ? {} : { Authorization: `Bearer ${token}` }),
          'x-enable-ai': 'true',
        },
        body: sensitivePayload,
      })
      const bodyReads = ['json', 'text', 'arrayBuffer', 'blob', 'formData', 'clone'].map(method =>
        vi.spyOn(request, method as 'json').mockImplementation(() => { throw new Error('Payload must not be read') }))
      const streamRead = vi.spyOn(request, 'body', 'get')
      const response = await endpoint.handle(request)

      expect(response.status).toBe(403)
      expect(response.headers.get('Content-Type')).toContain('application/json')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(await response.json()).toEqual({
        code: 'PILOT_FEATURE_DISABLED',
        error: 'AI features are disabled during the pilot.',
      })
      for (const read of bodyReads) expect(read).not.toHaveBeenCalled()
      expect(streamRead).not.toHaveBeenCalled()
      expect(request.bodyUsed).toBe(false)
      assertNoProcessing(endpoint)
    },
  )

  it.each(['{ malformed json', '', 'null'])('rejects malformed/empty body %j without parsing', async (body) => {
    const endpoint = loadEndpoint(name)
    const request = new Request(`https://example.test/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })
    const response = await endpoint.handle(request)
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('PILOT_FEATURE_DISABLED')
    expect(request.bodyUsed).toBe(false)
    assertNoProcessing(endpoint)
  })

  it.each(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE'])('rejects %s requests', async (method) => {
    const endpoint = loadEndpoint(name)
    const response = await endpoint.handle(new Request(`https://example.test/${name}`, { method }))
    expect(response.status).toBe(403)
    assertNoProcessing(endpoint)
  })

  it('answers CORS preflight without processing any AI request', async () => {
    const endpoint = loadEndpoint(name)
    const response = await endpoint.handle(new Request(`https://example.test/${name}`, {
      method: 'OPTIONS', headers: { Origin: 'https://trakfootball.com', 'Access-Control-Request-Method': 'POST' },
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('content-type')
    expect(await response.text()).toBe('')
    assertNoProcessing(endpoint)
  })
})
