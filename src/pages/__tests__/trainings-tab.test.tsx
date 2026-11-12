/**
 * [scope] Trainings tab: players get a Trainings tab in the bottom bar. It
 * shows two training pages exactly as they were designed: the Coaching Session
 * Catalogue and Play It Right. Both are static HTML under public/trainings,
 * shown in a same-site iframe. A coach's tab is the Library (TRAK-264,
 * coach-library-trak264.test.tsx), which still opens Play It Right this way.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../tests/support/render-app'
import { signInAs } from '../../../tests/support/session'
import { server } from '../../../tests/msw/server'
import { table, rpc, rpcRows } from '../../../tests/msw/supabase'

afterEach(cleanup)

const CATALOGUE = '/trainings/coaching-session-catalogue.html'
const PLAY_IT_RIGHT = '/trainings/play-it-right.html'

// TRAK-419: `training` is the academy's Training switch. Where it is on, the old Library's addresses open Drills.
// A coach of their own, so the app's cache never carries one switch's answer into the other.
function coach({ training = false } = {}) {
  const id = training ? 'coach-trainings-on' : 'coach-trainings'
  signInAs({ id })
  server.use(
    table('profiles', [{ id: 'p', user_id: id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_sessions', []), table('squad_players', []), table('coach_details', []),
    rpc('feature_on', ({ p_feature }) => p_feature !== 'training' || training),
  )
}

function player() {
  signInAs({ id: 'player-trainings' })
  server.use(
    table('profiles', [{ user_id: 'player-trainings', role: 'player', full_name: 'Synthetic Player' }]),
    table('matches', []), table('player_details', []), table('squad_players', []), table('coach_assessments', []),
    rpcRows('child_events', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    rpc('my_session_is_live', () => true),
  )
}

// TRAK-440: the bottom bar is the coach's glass tab bar, its tabs marked by aria-selected.
const navTab = (name: string) => within(screen.getByRole('tablist', { name: 'Player' })).getByRole('tab', { name: new RegExp(name, 'i') })

describe.each([
  ['player', player, '/player/trainings'],
] as const)('Trainings tab for a %s', (_role, signIn, path) => {
  it('is in the bottom bar and marked on its page', async () => {
    signIn()
    renderApp(path)
    await screen.findByRole('heading', { name: 'Trainings' })
    expect(navTab('Trainings')).toHaveAttribute('aria-selected', 'true')
    expect(navTab('Home')).toHaveAttribute('aria-selected', 'false')
  }, 20_000)

  it('opens on the Coaching Session Catalogue and switches to Play It Right', async () => {
    signIn()
    renderApp(path)
    const frame = await screen.findByTitle('Coaching Session Catalogue')
    expect(frame).toHaveAttribute('src', CATALOGUE)
    expect(screen.getByRole('tab', { name: 'Coaching sessions' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('tab', { name: 'Play It Right' }))
    expect(await screen.findByTitle('Play It Right')).toHaveAttribute('src', PLAY_IT_RIGHT)
    expect(screen.getByRole('tab', { name: 'Play It Right' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTitle('Coaching Session Catalogue')).toBeNull()
  }, 20_000)

  it('gives both pages the full width of a tablet or desktop screen', async () => {
    signIn()
    renderApp(path)
    for (const [tab, title] of [['Coaching sessions', 'Coaching Session Catalogue'], ['Play It Right', 'Play It Right']]) {
      await userEvent.click(await screen.findByRole('tab', { name: tab }))
      const frame = await screen.findByTitle(title)
      // The rest of the app keeps to a 430px phone column; these pages must not.
      expect(frame.closest('[class*="max-w-"]')).toBeNull()
      expect(frame).toHaveClass('w-full')
    }
  }, 20_000)
})

describe('Play It Right keeps answers to the person answering', () => {
  // Review on #372: one origin-wide key carried a player's answers, confidence
  // and reasons to the next account (and the public URL) on the same device.
  const KEY = 'play-it-right-v2'
  // jsdom (vitest's DOM) ships without type declarations; load it untyped to
  // run the real page with its scripts in a window of its own.
  const { JSDOM, VirtualConsole } = createRequire(import.meta.url)('jsdom')
  const html = readFileSync(resolve(__dirname, '../../../public/trainings/play-it-right.html'), 'utf8')

  function open(seed?: unknown) {
    const errors: unknown[] = []
    const virtualConsole = new VirtualConsole()
    virtualConsole.on('jsdomError', (e: unknown) => errors.push(e))
    const dom = new JSDOM(html, {
      url: 'http://localhost/trainings/play-it-right.html',
      runScripts: 'dangerously',
      virtualConsole,
      beforeParse(window: Window) {
        window.scrollTo = () => {}  // jsdom does not implement scrolling
        if (seed !== undefined) window.localStorage.setItem(KEY, JSON.stringify(seed))
      },
    })
    return { dom, errors }
  }

  it("drops a previous visitor's saved answers instead of showing them", () => {
    const { dom, errors } = open({
      prog: { answers: { c1: { pick: 0, conf: 'sure', reason: 'synthetic reason' } }, recalls: {} },
      senior: {}, tab: 'senior',
    })
    expect(errors).toEqual([])
    expect(dom.window.localStorage.getItem(KEY)).toBeNull()
    expect(dom.window.document.getElementById('tab-academy')?.getAttribute('aria-selected')).toBe('true')
    expect(dom.window.document.body.textContent).not.toContain('synthetic reason')
  })

  it('writes nothing to browser storage while someone uses it', () => {
    const { dom, errors } = open()
    const doc = dom.window.document
    ;(doc.getElementById('tab-senior') as HTMLButtonElement).click()
    ;(doc.getElementById('tab-academy') as HTMLButtonElement).click()
    expect(errors).toEqual([])
    expect(doc.getElementById('tab-academy')?.getAttribute('aria-selected')).toBe('true')
    expect(dom.window.localStorage.length).toBe(0)
    expect(dom.window.sessionStorage.length).toBe(0)
  })
})

describe('Trainings pages ship as static files', () => {
  const root = resolve(__dirname, '../../..')
  const page = (p: string) => readFileSync(resolve(root, 'public' + p), 'utf8')

  it('ships both pages with their own titles and no third-party font host', () => {
    for (const [p, title] of [[CATALOGUE, 'Coaching Session Catalogue'], [PLAY_IT_RIGHT, 'Play It Right']]) {
      expect(existsSync(resolve(root, 'public' + p))).toBe(true)
      const html = page(p)
      expect(html).toContain(`<title>${title}</title>`)
      expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/)
      expect(html).toContain("url('/fonts/dm-sans-normal-variable-latin.woff2')")
    }
  })

  it('widens both pages past their 760px phone/tablet column on a desktop screen', () => {
    for (const p of [CATALOGUE, PLAY_IT_RIGHT]) {
      expect(page(p)).toContain('@media (min-width: 1024px) { .wrap { max-width: 1180px; } }')
    }
  })

  it('lets only /trainings run inline scripts and be framed, and only by this site', () => {
    const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'))
    const rules = vercel.headers as { source: string; headers: { key: string; value: string }[] }[]
    const header = (source: string, key: string) =>
      rules.find(r => r.source === source)?.headers.find(h => h.key === key)?.value ?? ''

    const site = header('/(.*)', 'Content-Security-Policy')
    expect(site).toContain("frame-src 'self'")
    expect(site).toContain("frame-ancestors 'none'")
    expect(site).toMatch(/script-src 'self';/)
    expect(header('/(.*)', 'X-Frame-Options')).toBe('DENY')

    // Vercel lets a later matching rule override the same header, so the
    // /trainings rule must come after the site-wide one.
    const order = rules.map(r => r.source)
    expect(order.indexOf('/trainings/(.*)')).toBeGreaterThan(order.indexOf('/(.*)'))
    const trainings = header('/trainings/(.*)', 'Content-Security-Policy')
    expect(trainings).toContain("script-src 'self' 'unsafe-inline'")
    expect(trainings).toContain("frame-ancestors 'self'")
    expect(trainings).toContain("font-src 'self'")
    expect(trainings).toContain("connect-src 'self'")
    expect(header('/trainings/(.*)', 'X-Frame-Options')).toBe('SAMEORIGIN')
  })
})

describe('the catalogue opens on a theme from New event', () => {
  const { JSDOM, VirtualConsole } = createRequire(import.meta.url)('jsdom')
  const html = readFileSync(resolve(__dirname, '../../../public/trainings/coaching-session-catalogue.html'), 'utf8')
  const DEFENDING = 'Tactical – Defending'

  function open(query: string) {
    const errors: unknown[] = []
    const virtualConsole = new VirtualConsole()
    virtualConsole.on('jsdomError', (e: unknown) => errors.push(e))
    const dom = new JSDOM(html, { url: `http://localhost${CATALOGUE}${query}`, runScripts: 'dangerously', virtualConsole })
    const selected = dom.window.document.querySelector('.track-btn[aria-selected="true"]') as HTMLElement | null
    return { errors, lib: selected?.dataset.lib }
  }

  it("a coach's old theme link opens that library in the Library (TRAK-264)", async () => {
    coach()
    renderApp(`/coach/trainings?lib=${encodeURIComponent(DEFENDING)}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Defending' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/coach/trainings/defending')
  }, 20_000)

  // TRAK-419 (11 Nov review): where Training is on, Drills is the one library; an old Library address opens it.
  it('with Training on, the old Library address opens Training › Drills, and a theme its drills', async () => {
    coach({ training: true })
    renderApp('/coach/trainings')
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/drills'))
    cleanup()
    coach({ training: true })
    renderApp('/coach/trainings/goalkeeping')
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/coach/training/drills/all?show=Goalkeeping'))
  }, 20_000)

  it('the catalogue selects that library', () => {
    const { errors, lib } = open(`?lib=${encodeURIComponent(DEFENDING)}`)
    expect(errors).toEqual([])
    expect(lib).toBe(DEFENDING)
  })

  it('an unknown or missing library shows every session', () => {
    expect(open('?lib=Nope').lib).toBe('')
    expect(open('').lib).toBe('')
  })
})
