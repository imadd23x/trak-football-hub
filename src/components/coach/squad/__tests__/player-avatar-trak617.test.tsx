/**
 * TRAK-617: a coach selects the avatar of a player of theirs from the player's page in Squad. It is the drawn face
 * (TRAK-349), never a photo: the coach selects its hair style and colour from the fixed lists, and "Automatic" returns
 * the face from the name. Every coach screen that knows the player draws the selection; with none, the face comes from
 * the name as before. The skin tone is never offered.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FaceDrawing, PlayerFace, PlayerFaces } from '@/components/trak/PlayerFace'
import { HAIR_COLOURS, HAIR_STYLE_COUNT, hairOf, type HairPick } from '@/lib/player-face'
import { PlayerAvatarEditor } from '../PlayerAvatarEditor'

const messages = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: messages.success, error: messages.error } }))
const db = vi.hoisted(() => ({ upsert: vi.fn() }))
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ upsert: (...args: unknown[]) => db.upsert(...args) }) },
  SUPABASE_FUNCTIONS_URL: 'https://test.supabase.co/functions/v1', SUPABASE_PUBLISHABLE_KEY: 'test-anon-key',
}))

const PLAYER = '61700000-0000-4000-8000-000000000001'
const COACH = '61700000-0000-4000-8000-0000000000c1'
const NAME = 'Synthetic Player'

const hairIn = (root: ParentNode) => {
  const part = root.querySelector('[data-hair]')!
  return { colour: part.getAttribute('fill'), style: Number(part.getAttribute('data-hair')) }
}
/** A pick that differs from the name's own hair in both style and colour. */
const other = (): HairPick => {
  const own = hairOf(NAME)
  return { style: (own.style + 1) % HAIR_STYLE_COUNT, colour: (HAIR_COLOURS.indexOf(own.colour) + 1) % HAIR_COLOURS.length }
}

beforeEach(() => { vi.clearAllMocks(); db.upsert.mockResolvedValue({ error: null }) })
afterEach(cleanup)

describe('TRAK-617: the face draws the coach\'s selection', () => {
  it('draws the selected hair for that player, and the name\'s hair without one', () => {
    const pick = other()
    const { container } = render(<PlayerFaces.Provider value={new Map([[PLAYER, pick]])}>
      <div data-testid="picked"><PlayerFace name={NAME} playerId={PLAYER} /></div>
      <div data-testid="other"><PlayerFace name={NAME} playerId="61700000-0000-4000-8000-000000000002" /></div>
      <div data-testid="no-id"><FaceDrawing name={NAME} /></div>
    </PlayerFaces.Provider>)
    expect(hairIn(screen.getByTestId('picked'))).toEqual({ colour: HAIR_COLOURS[pick.colour], style: pick.style })
    expect(hairIn(screen.getByTestId('other'))).toEqual(hairOf(NAME))
    expect(hairIn(screen.getByTestId('no-id'))).toEqual(hairOf(NAME))
    expect(container.querySelector('img')).toBeNull()
  })

  it('draws the name\'s hair where no coach selections are provided (a player\'s or parent\'s screen)', () => {
    render(<div data-testid="face"><PlayerFace name={NAME} playerId={PLAYER} /></div>)
    expect(hairIn(screen.getByTestId('face'))).toEqual(hairOf(NAME))
  })
})

describe('TRAK-617: the coach selects a player\'s avatar', () => {
  const open = (saved: HairPick | null = null) => {
    render(<QueryClientProvider client={new QueryClient()}>
      <PlayerFaces.Provider value={new Map(saved ? [[PLAYER, saved]] : [])}>
        <PlayerAvatarEditor playerId={PLAYER} name={NAME} coachId={COACH}><FaceDrawing name={NAME} playerId={PLAYER} /></PlayerAvatarEditor>
      </PlayerFaces.Provider>
    </QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Synthetic\'s avatar' }))
  }

  it('offers the three hair styles and five hair colours, and never a skin tone', async () => {
    open()
    for (const style of ['Crop', 'Short', 'Curls']) expect(await screen.findByRole('button', { name: style })).toBeInTheDocument()
    for (const colour of ['Black', 'Dark brown', 'Brown', 'Light brown', 'Charcoal']) expect(screen.getByRole('button', { name: colour })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Automatic' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(/skin/i)).toBeNull()
    expect(screen.getByText('A drawing, never a photo. Only you see it.')).toBeInTheDocument()
  })

  it('saves the selected style and colour, writing only the avatar\'s columns', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Curls' }))
    fireEvent.click(screen.getByRole('button', { name: 'Light brown' }))
    expect(hairIn(screen.getByRole('img', { name: 'Synthetic\'s avatar' }))).toEqual({ colour: HAIR_COLOURS[3], style: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(db.upsert).toHaveBeenCalledTimes(1))
    expect(db.upsert).toHaveBeenCalledWith({ squad_player_id: PLAYER, face_hair_style: 2, face_hair_colour: 3 }, { onConflict: 'squad_player_id' })
    await waitFor(() => expect(messages.success).toHaveBeenCalledWith('Saved Synthetic\'s avatar'))
  })

  it('returns a selected avatar to the automatic one', async () => {
    open(other())
    fireEvent.click(await screen.findByRole('button', { name: 'Automatic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(db.upsert).toHaveBeenCalledWith({ squad_player_id: PLAYER, face_hair_style: null, face_hair_colour: null }, { onConflict: 'squad_player_id' }))
  })

  it('keeps the sheet open and says so when the save fails', async () => {
    db.upsert.mockResolvedValue({ error: { message: 'refused' } })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Short' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(messages.error).toHaveBeenCalledWith('Couldn\'t save. Check your connection and try again.'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
})

describe('TRAK-617: the database accepts only what the app can draw', () => {
  it('checks the same style and colour ranges as the app, set together', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261127130000_coach_player_avatar.sql'), 'utf8')
    expect(sql).toContain(`face_hair_style BETWEEN 0 AND ${HAIR_STYLE_COUNT - 1}`)
    expect(sql).toContain(`face_hair_colour BETWEEN 0 AND ${HAIR_COLOURS.length - 1}`)
    expect(sql).toContain('(face_hair_style IS NULL) = (face_hair_colour IS NULL)')
    expect(sql).not.toMatch(/ADD COLUMN\s+\w*skin/i)
  })
})
