import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Shell } from './shell.tsx';

describe('web shell', () => {
  test('renders the product heading and main landmark', () => {
    render(<Shell />);
    expect(screen.getByRole('heading', { level: 1, name: 'Kanso Chess' })).toBeVisible();
    expect(screen.getByRole('main')).toBeVisible();
  });
});
