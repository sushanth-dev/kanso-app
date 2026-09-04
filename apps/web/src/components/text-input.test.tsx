import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { TextInput } from './text-input.tsx';

describe('TextInput', () => {
  test('renders a native input with the shared text-input styling', () => {
    const { container } = render(<TextInput />);
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect(input?.className).toContain('min-h-11');
    expect(input?.className).toContain('focus:border-focus');
  });

  test('appends a caller className after the base classes', () => {
    const { container } = render(<TextInput className="text-sm" />);
    const input = container.querySelector('input')!;
    expect(input.className).toContain('min-h-11');
    expect(input.className.endsWith('text-sm')).toBe(true);
  });

  test('forwards native input props such as type, placeholder and aria labels', () => {
    const { container } = render(
      <TextInput type="email" placeholder="you@example.com" aria-label="Email" disabled />,
    );
    const input = container.querySelector('input')!;
    expect(input.getAttribute('type')).toBe('email');
    expect(input.getAttribute('placeholder')).toBe('you@example.com');
    expect(input.getAttribute('aria-label')).toBe('Email');
    expect(input).toBeDisabled();
  });
});
