import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { UpgradePrompt } from './upgrade-prompt.tsx';

describe('UpgradePrompt', () => {
  test('names the surface, keeps the diagnosis-loop copy and links to the plans', () => {
    render(<UpgradePrompt title="You have used your free diagnoses" />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'You have used your free diagnoses' }),
    ).toBeVisible();
    expect(
      screen.getByText(/Your first diagnosis is free\. A focus, verification afterwards/),
    ).toBeVisible();
    const link = screen.getByRole('link', { name: 'See plans' });
    expect(link).toHaveAttribute('href', '/upgrade');
  });

  test('a surface-specific body restates that surface boundary', () => {
    render(
      <UpgradePrompt title="Puzzles are paid" body="Puzzle packs are part of the paid plan." />,
    );
    expect(screen.getByText('Puzzle packs are part of the paid plan.')).toBeVisible();
    expect(screen.queryByText(/Your first diagnosis is free/)).toBeNull();
  });
});
