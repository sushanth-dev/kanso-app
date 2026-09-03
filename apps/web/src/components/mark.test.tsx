import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Mark } from './mark.tsx';

describe('Mark', () => {
  test('the full variant carries the piece and the construction layer', () => {
    const { container } = render(<Mark size={64} />);
    expect(container.querySelector('path[class="fill-accent"]')).not.toBeNull();
    expect(container.querySelectorAll('g.stroke-info path')).toHaveLength(5);
    expect(container.querySelector('g.stroke-page circle')).not.toBeNull();
  });

  test('the plain variant drops the construction layer for favicon sizes', () => {
    const { container } = render(<Mark size={16} variant="plain" />);
    expect(container.querySelector('path[class="fill-accent"]')).not.toBeNull();
    expect(container.querySelector('g')).toBeNull();
  });

  test('construction strokes are non-scaling hairlines at any size', () => {
    const { container } = render(<Mark size={512} />);
    for (const el of container.querySelectorAll('g path, g circle')) {
      expect(el.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    }
  });
});
