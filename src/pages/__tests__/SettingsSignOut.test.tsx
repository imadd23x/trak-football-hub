import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Settings from '../Settings';

const state = vi.hoisted(() => ({ authenticated: true, signOut: vi.fn() }));
const signOut = state.signOut;
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: state.authenticated ? { id: 'settings-user' } : null,
    profile: state.authenticated ? { user_id: 'settings-user', role: 'club', full_name: 'Synthetic User' } : null,
    loading: false, signOut, refreshProfile: vi.fn(),
  }),
}));

vi.mock('@/lib/settings-account', () => ({ assertSettingsAccount: async () => undefined }));
beforeEach(() => { state.authenticated = true; signOut.mockReset(); });
afterEach(cleanup);

function tree() {
  return (<MemoryRouter initialEntries={['/settings']}><Routes>
    <Route path="/settings" element={<Settings />} />
    <Route path="/" element={<h1>Signed out landing</h1>} />
  </Routes></MemoryRouter>);
}
function mount() { return render(tree()); }

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
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith('settings-user'));
    // The real provider clears identity only after a confirmed sign-out.
    state.authenticated = false;
    view.rerender(tree());
    expect(await screen.findByText('Signed out landing')).toBeInTheDocument();
  });
});
