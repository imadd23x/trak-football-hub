import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Settings from '../Settings';

const signOut = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, profile: null, signOut, refreshProfile: vi.fn() }),
}));

afterEach(cleanup);

function mount() {
  render(<MemoryRouter initialEntries={['/settings']}><Routes>
    <Route path="/settings" element={<Settings />} />
    <Route path="/" element={<h1>Signed out landing</h1>} />
  </Routes></MemoryRouter>);
}

describe('Settings sign-out outcome', () => {
  it('stays on Settings when the account could not be signed out', async () => {
    signOut.mockResolvedValue({ error: new Error('offline') });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(screen.queryByText('Signed out landing')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('navigates after a confirmed successful sign-out', async () => {
    signOut.mockResolvedValue({ error: null });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Signed out landing')).toBeInTheDocument();
  });
});
