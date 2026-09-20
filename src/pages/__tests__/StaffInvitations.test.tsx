import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import StaffInvitations from '../StaffInvitations';
const state = vi.hoisted(() => ({ user: { id: 'a', email: 'admin@test.invalid' }, load: vi.fn(), send: vi.fn(), revoke: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user, profile: { role: 'club' }, loading: false }) }));
vi.mock('@/lib/staff-invites', () => ({ loadStaffContext: state.load, sendStaffInvitation: state.send, revokeStaffInvitation: state.revoke,
  staffError: (error: Error) => error.message }));
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const inviteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const invite = { id: inviteId, role: 'coach', email: 'coach@test.invalid', organization_id: org, academy_name: 'Academy A',
  state: 'pending', delivery_state: 'sending', expires_at: '2027-01-01T00:00:00Z', created_at: '2026-09-20T00:00:00Z' };
const context = { can_invite_academies: false, academies: [{ id: org, name: 'Academy A' }], invitations: [invite] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mount() { const tree = () => <MemoryRouter><StaffInvitations /></MemoryRouter>; const view = render(tree()); return { ...view, changeAccount: () => view.rerender(tree()) }; }
beforeEach(() => { vi.clearAllMocks(); state.user = { id: 'a', email: 'admin@test.invalid' }; state.load.mockResolvedValue(context);
  state.send.mockResolvedValue({ sent: true, message: 'The email provider accepted the invitation for sending.' }); state.revoke.mockResolvedValue(undefined); });
afterEach(cleanup);

describe('staff invitation management', () => {
  it('retains the same request after an uncertain failure, including its locked recipient', async () => {
    state.send.mockRejectedValueOnce(new Error('Unknown send result. Retry this request.'));
    mount(); fireEvent.change(await screen.findByLabelText('Recipient email'), { target: { value: 'NewCoach@Test.Invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('Unknown send result. Retry this request.')).toBeInTheDocument();
    expect(screen.getByLabelText('Recipient email')).toBeDisabled();
    const first = state.send.mock.calls[0][1]; expect(first.email).toBe('newcoach@test.invalid');
    fireEvent.click(screen.getByRole('button', { name: 'Check or retry this request' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[1][1]).toEqual(first);
    expect(await screen.findByText('The email provider accepted the invitation for sending.')).toBeInTheDocument();
  });
  it('reports rejected email as rejected even though the function returned a response', async () => {
    state.send.mockResolvedValue({ sent: false, message: 'The email provider rejected this send.' });
    mount(); fireEvent.change(await screen.findByLabelText('Recipient email'), { target: { value: 'coach@test.invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('The email provider rejected this send.')).toBeInTheDocument();
    expect(screen.queryByText(/accepted the invitation for sending/)).not.toBeInTheDocument();
  });
  it('requires a deliberate replacement and creates a distinct request for the same scope', async () => {
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Replace email invitation' }));
    expect(state.send).not.toHaveBeenCalled(); expect(screen.getByText(/previous activation link will stop working/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send replacement invitation' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(state.send.mock.calls[0][1]).toMatchObject({ role: 'coach', email: invite.email, organization_id: org });
    expect(state.send.mock.calls[0][1].request_id).not.toBe(inviteId);
  });
  it('hides a previous account’s recipient, forms and delayed send result after account switch', async () => {
    const response = deferred<{ sent: boolean; message: string }>(); state.send.mockReturnValue(response.promise);
    const view = mount(); fireEvent.change(await screen.findByLabelText('Recipient email'), { target: { value: 'private-a@test.invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    state.user = { id: 'b', email: 'b@test.invalid' }; state.load.mockResolvedValue({ can_invite_academies: false, academies: [], invitations: [] }); view.changeAccount();
    await act(async () => { response.resolve({ sent: true, message: 'Private A result' }); await response.promise; });
    expect(await screen.findByText(/Only academy administrators/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('private-a@test.invalid')).not.toBeInTheDocument(); expect(screen.queryByText('Private A result')).not.toBeInTheDocument();
  });
  it('distinguishes a failed load from an empty invitation list and permits retry', async () => {
    state.load.mockRejectedValueOnce(new Error('Could not load invitations')); mount();
    expect(await screen.findByText('Could not load invitations')).toBeInTheDocument();
    expect(screen.queryByText('No invitations yet.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh invitations' }));
    expect(await screen.findByLabelText('Recipient email')).toBeInTheDocument();
  });
});
