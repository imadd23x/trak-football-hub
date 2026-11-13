import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../tests/msw/server'
import { rpcRows, table, tableError } from '../../../../tests/msw/supabase'
import { SeasonSoFar } from '../SeasonSoFar'

/**
 * TRAK-441 slice 2.5b (mockup, 12 Nov): Season so far on the family Home. Matches = the matches the coach recorded for
 * the child (who played, old log or Matches); Starts = those where the shared plan said "starter". No rating.
 */

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><SeasonSoFar childId="child-1" /></QueryClientProvider>)
}

describe('TRAK-441: Season so far', () => {
  it('counts the matches played and the starts among them', async () => {
    server.use(
      table('squad_players', [{ id: 'sp-1' }]),
      table('matches', [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]),
      table('game_review_for_family', [{ event_id: 'e1' }, { event_id: 'e2' }]),
      // Started e1 and played it; on the bench for e2; named to start e3 but didn't play (no review), so not a start.
      table('game_for_family', [{ event_id: 'e1', role: 'starter' }, { event_id: 'e2', role: 'bench' }, { event_id: 'e3', role: 'starter' }]),
      rpcRows('child_training_attendance', [{ attended: 21, total: 24 }]),
    )
    show()
    const section = await screen.findByRole('region', { name: 'Season so far' })
    const value = (label: string) => within(section).getByText(label).nextElementSibling?.textContent
    expect(value('Matches')).toBe('3')
    expect(value('Starts')).toBe('1')
    expect(value('Training')).toBe('21/24')
  })

  it('no Training tile when no training counts yet (no register taken), never 0/0', async () => {
    server.use(table('squad_players', [{ id: 'sp-1' }]), table('matches', []), table('game_review_for_family', []),
      table('game_for_family', []), rpcRows('child_training_attendance', []))
    show()
    const section = await screen.findByRole('region', { name: 'Season so far' })
    expect(within(section).getByText('Matches')).toBeInTheDocument()
    expect(within(section).queryByText('Training')).toBeNull()
  })

  it('shows nothing when a read fails, rather than a wrong zero', async () => {
    server.use(table('squad_players', [{ id: 'sp-1' }]), tableError('matches', 500, { message: 'boom' }),
      table('game_review_for_family', []), table('game_for_family', []), rpcRows('child_training_attendance', []))
    show()
    await new Promise(done => setTimeout(done, 300))
    expect(screen.queryByRole('region', { name: 'Season so far' })).toBeNull()
  })
})
