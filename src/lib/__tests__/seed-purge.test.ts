import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

// seed-pilot-rehearsal.mjs --purge runs with the app key, so it gets what an
// app role gets. Since #134 (TRAK-47) that role cannot delete calendar events,
// awards or an academy (checked read-only on production, 26 Sep). The stub
// answers the way PostgREST did there, and purge must report only what it
// actually removed.
const refused = (res: ServerResponse, table: string) => {
  res.writeHead(403, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ code: '42501', message: `permission denied for table ${table}` }))
}

let server: ReturnType<typeof createServer> | undefined
afterEach(() => new Promise<void>(done => (server ? server.close(() => done()) : done())))

async function runPurge() {
  const requests: string[] = []
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://stub')
      const table = url.pathname.replace('/rest/v1/', '')
      requests.push(`${req.method} ${url.pathname}`)
      if (url.pathname === '/auth/v1/token') {
        const { email } = JSON.parse(body)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          access_token: 'stub', token_type: 'bearer', expires_in: 3600, expires_at: 9999999999,
          refresh_token: 'stub', user: { id: `00000000-0000-0000-0000-${email.length.toString().padStart(12, '0')}`, email, aud: 'authenticated' },
        }))
      } else if (req.method === 'GET' && table === 'organizations') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'org-rehearsal' }))
      } else if (req.method === 'DELETE' && ['organizations', 'coach_calendar_events', 'recognition_awards'].includes(table)) {
        refused(res, table)
      } else if (req.method === 'DELETE' && table === 'squad_players') {
        res.writeHead(204); res.end()
      } else {
        res.writeHead(404); res.end()
      }
    })
  })
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  const child = spawn(process.execPath, ['seed-pilot-rehearsal.mjs', '--purge'], {
    env: { PATH: process.env.PATH, VITE_SUPABASE_URL: `http://127.0.0.1:${port}`,
           VITE_SUPABASE_PUBLISHABLE_KEY: 'stub-anon', TRAK_REHEARSAL_PASSWORD: 'synthetic-only-password' },
  })
  let out = ''
  child.stdout.on('data', c => (out += c))
  child.stderr.on('data', c => (out += c))
  const code = await new Promise<number | null>(r => child.on('close', r))
  return { out, code, requests }
}

describe('rehearsal seed --purge', () => {
  it('claims only what the app role could remove', async () => {
    const { out, code } = await runPurge()
    expect(code).toBe(0)
    expect(out).not.toMatch(/removed the organisation/i)
    expect(out).not.toMatch(/fixtures and awards/i)
    expect(out).toMatch(/cleared Alex Marinos's squad/)
    // The academy stays, so pilot_config.org_id and the coaches' academy survive a reset.
    expect(out).toMatch(/Rehearsal FC.*kept/i)
  }, 30000)

  it('does not attempt writes the app role is refused', async () => {
    const { requests } = await runPurge()
    expect(requests.filter(r => r.startsWith('DELETE'))).toEqual([
      'DELETE /rest/v1/squad_players', 'DELETE /rest/v1/squad_players',
    ])
  }, 30000)
})
