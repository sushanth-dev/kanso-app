import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { Stream } from '../api/diagnosis-api.ts';
import { StreamToggle } from './stream-toggle.tsx';

describe('StreamToggle', () => {
  test('renders the tournament and online segments in a labelled radiogroup', () => {
    render(<StreamToggle stream="tournament" onChange={() => {}} />);
    const group = screen.getByRole('radiogroup', { name: 'Stream' });
    expect(group).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Tournament' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Online' })).toHaveAttribute('aria-checked', 'false');
  });

  test('the surface names what the toggle picks via ariaLabel', () => {
    render(<StreamToggle stream="online" onChange={() => {}} ariaLabel="Diagnosis stream" />);
    expect(screen.getByRole('radiogroup', { name: 'Diagnosis stream' })).toBeVisible();
  });

  test('selecting a segment reports that stream', async () => {
    const onChange = vi.fn<(stream: Stream) => void>();
    const user = userEvent.setup();
    render(<StreamToggle stream="tournament" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Online' }));
    expect(onChange).toHaveBeenCalledWith('online');
  });

  test('the controlled value drives the checked segment', () => {
    const { rerender } = render(<StreamToggle stream="online" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Online' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Tournament' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    rerender(<StreamToggle stream="tournament" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Tournament' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
