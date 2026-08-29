import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { authClient } from '../auth-client.ts';
import { ChangePasswordForm } from './change-password-form.tsx';

vi.mock('../auth-client.ts', () => ({
  authClient: { changePassword: vi.fn() },
}));

const changePassword = vi.mocked(authClient.changePassword);

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    changePassword.mockReset();
  });

  test('hides the inputs until the reveal button is clicked', () => {
    render(<ChangePasswordForm />);
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeVisible();
  });

  test('guards a mismatch client-side without calling the API', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordForm />);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    // Astryx's clickAction reveal is deferred, and under a loaded machine the
    // commit loses the race with a synchronous lookup; await it instead.
    await user.type(await screen.findByLabelText('Current password'), 'old-password');
    await user.type(await screen.findByLabelText('New password'), 'new-password-1');
    await user.type(await screen.findByLabelText('Confirm new password'), 'different-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(/passwords do not match/i)).toBeVisible();
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('calls changePassword and shows the success copy', async () => {
    changePassword.mockResolvedValue({ data: { token: null, user: {} }, error: null });
    const user = userEvent.setup();
    render(<ChangePasswordForm />);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await user.type(await screen.findByLabelText('Current password'), 'old-password');
    await user.type(await screen.findByLabelText('New password'), 'new-password-1');
    await user.type(await screen.findByLabelText('Confirm new password'), 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-password',
        newPassword: 'new-password-1',
      });
    });
    expect(await screen.findByText(/password changed/i)).toBeVisible();
  });

  test('maps a rejected current password to the rejection copy', async () => {
    changePassword.mockResolvedValue({
      data: null,
      error: { status: 400, statusText: 'Bad Request' },
    });
    const user = userEvent.setup();
    render(<ChangePasswordForm />);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await user.type(await screen.findByLabelText('Current password'), 'wrong-password');
    await user.type(await screen.findByLabelText('New password'), 'new-password-1');
    await user.type(await screen.findByLabelText('Confirm new password'), 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(/current password was not accepted/i)).toBeVisible();
  });
});
