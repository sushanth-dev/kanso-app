import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { PasswordInput } from './password-input.tsx';

describe('PasswordInput', () => {
  test('masks the value and offers a reveal affordance', () => {
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeVisible();
  });

  test('the reveal toggle exposes the typed value as plain text', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText('Password');
    await user.type(input, 's3cret-value');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('s3cret-value');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeVisible();
  });

  test('a second toggle masks the value again', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    await user.click(screen.getByRole('button', { name: 'Hide password' }));

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeVisible();
  });

  test('forwards input props and reserves room for the toggle', () => {
    render(<PasswordInput autoComplete="current-password" placeholder="Password" />);
    const input = screen.getByPlaceholderText('Password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
    expect(input.className).toContain('pr-11');
  });
});
