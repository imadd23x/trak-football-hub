import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, insertInto } from '../../../../tests/msw/supabase'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { TRAINING_FOCUS, parseTrainingType, trainingTypeFrom } from '@/lib/training-focus'

/**
 * TRAK-75 (J4, writer side of J6 training history). Families may see a
 * training's date, that it was training, and its focus labels (TRAK-6, 25 Sep).
 * They never see the coach's free-text title or notes. So the focus has to be
 * stored on its own, in `training_type`, instead of only inside `title`.
 * Driven through the rendered form and the real SDK: what leaves the client.
 */

const COACH = { id: 'coach-1' }
let inserted: Record<string, unknown>[]

beforeEach(() => {
  signInAs(COACH)
  inserted = []
  server.use(
    table('profiles', [{ id: 'p-coach', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', invite_code: 'ABCD' }]),
    table('squad_players', []),
    table('coach_sessions', []),
    insertInto('coach_sessions', body => { inserted.push(body); return { id: 'session-1', ...body } }),
  )
})

async function saveSession(pick: (user: ReturnType<typeof userEvent.setup>) => Promise<void>) {
  const user = userEvent.setup()
  renderApp('/coach/sessions/add')
  await screen.findByText('SESSION FOCUS')
  await pick(user)
  await user.click(screen.getByRole('button', { name: 'Save session' }))
  await waitFor(() => expect(inserted).toHaveLength(1))
  return inserted[0]
}

describe('J4: a training stores its focus as structured training_type', () => {
  it('stores the chosen focus labels in a fixed order, apart from the free-text theme', async () => {
    const row = await saveSession(async user => {
      // Tapped out of display order, on purpose.
      await user.click(screen.getByRole('button', { name: /^Set Pieces/ }))
      await user.click(screen.getByRole('button', { name: /^Technical/ }))
      await user.type(screen.getByPlaceholderText(/Pressing triggers/), 'Coach-only theme words')
    })
    expect(row.session_type).toBe('training')
    expect(row.training_type).toBe('Technical,Set Pieces')
    expect(String(row.training_type)).not.toContain('Coach-only')
    // The title still carries the theme for the coach, as before.
    expect(row.title).toBe('Set Pieces / Technical — Coach-only theme words')
  })

  it('stores no training_type for a session that is not training', async () => {
    const row = await saveSession(async user => {
      await user.click(screen.getByRole('button', { name: 'Other' }))
      await user.type(await screen.findByPlaceholderText(/Video Analysis/), 'Parents evening')
    })
    expect(row.session_type).toBe('other')
    expect(row.training_type ?? null).toBeNull()
  })
})

describe('training focus helpers', () => {
  it('keeps only known labels, in the fixed order, and stores nothing for none', () => {
    expect(trainingTypeFrom(['Game Based', 'Tactical', 'Tactical'])).toBe('Tactical,Game Based')
    expect(trainingTypeFrom(['Tactical', 'free text from somewhere'])).toBe('Tactical')
    expect(trainingTypeFrom([])).toBeNull()
    expect(trainingTypeFrom(['not a focus'])).toBeNull()
  })

  it('reads back only known labels', () => {
    expect(parseTrainingType('Technical,Set Pieces')).toEqual(['Technical', 'Set Pieces'])
    expect(parseTrainingType('Tactical')).toEqual(['Tactical'])
    expect(parseTrainingType(null)).toEqual([])
    expect(parseTrainingType('Tactical,Something else')).toEqual(['Tactical'])
  })
})

describe('the app and the database agree on the focus vocabulary', () => {
  it('the newest migration defining the constraint lists exactly the app\'s labels', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations')
    const latest = readdirSync(dir).sort().reverse()
      .map(f => readFileSync(join(dir, f), 'utf8'))
      .find(sql => sql.includes('coach_sessions_training_type_vocabulary CHECK'))
    expect(latest, 'no migration defines coach_sessions_training_type_vocabulary').toBeDefined()
    const list = latest!.slice(latest!.indexOf('ARRAY['), latest!.indexOf(']::text[]'))
    const labels = [...list.matchAll(/'([^']+)'/g)].map(m => m[1])
    expect(labels).toEqual(TRAINING_FOCUS.map(f => f.key))
  })
})
