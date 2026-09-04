import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { StatusMessage, StatusMessageProvider, useStatusMessage } from './status-message.tsx';

interface Flash {
  message: string;
  destination: string;
  presented: boolean;
}
function Probe() {
  useStatusMessage();
  return null;
}

describe('StatusMessage', () => {
  test('an error tone announces itself as an alert in the danger colour', () => {
    const { container } = render(<StatusMessage tone="error">Save failed.</StatusMessage>);
    const message = screen.getByRole('alert');
    expect(message).toBeVisible();
    expect(message.textContent).toContain('Save failed.');
    expect(message.className).toContain('text-danger');
    // The exclamation icon: a filled dot below a stroke.
    expect(container.querySelectorAll('svg circle[fill="currentColor"]')).toHaveLength(1);
  });

  test('success and info tones are polite statuses in their own colours', () => {
    const success = render(<StatusMessage tone="success">Saved.</StatusMessage>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(success.container.querySelector('p')!.className).toContain('text-success');

    const info = render(<StatusMessage tone="info">Streaming from lichess.org.</StatusMessage>);
    expect(info.container.querySelector('p')!.className).toContain('text-info');
  });

  test('each tone draws its own icon path', () => {
    const error = render(<StatusMessage tone="error">x</StatusMessage>);
    expect(error.container.querySelector('svg path')?.getAttribute('d')).toContain('M10 6v5');

    const success = render(<StatusMessage tone="success">x</StatusMessage>);
    expect(success.container.querySelector('svg path')?.getAttribute('d')).toBe(
      'm6 10 2.5 2.5L14 7',
    );

    const info = render(<StatusMessage tone="info">x</StatusMessage>);
    expect(info.container.querySelector('svg path')?.getAttribute('d')).toBe('M10 9v5');
  });
});

describe('useStatusMessage', () => {
  test('throws outside the provider', () => {
    expect(() => render(<Probe />)).toThrow(/requires StatusMessageProvider/);
  });

  test('a flash starts unpresented, is marked presented, then clears', async () => {
    let latest: Flash | null = null;
    function Capture() {
      latest = useStatusMessage().flash;
      return null;
    }
    function Actions() {
      const { showMessage, markPresented, clearMessage } = useStatusMessage();
      return (
        <>
          <button onClick={() => showMessage('Rating exported.', '/report')}>show</button>
          <button onClick={markPresented}>mark</button>
          <button onClick={clearMessage}>clear</button>
        </>
      );
    }

    render(
      <StatusMessageProvider>
        <Actions />
        <Capture />
      </StatusMessageProvider>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByText('show'));
    expect(latest).toEqual({
      message: 'Rating exported.',
      destination: '/report',
      presented: false,
    });

    await user.click(screen.getByText('mark'));
    expect(latest).toMatchObject({ presented: true });

    await user.click(screen.getByText('clear'));
    expect(latest).toBeNull();
  });

  test('marking an absent flash is a no-op', async () => {
    let latest: Flash | null = null;
    function Capture() {
      latest = useStatusMessage().flash;
      return null;
    }
    function Actions() {
      const { markPresented } = useStatusMessage();
      return <button onClick={markPresented}>mark</button>;
    }

    render(
      <StatusMessageProvider>
        <Actions />
        <Capture />
      </StatusMessageProvider>,
    );
    await userEvent.setup().click(screen.getByText('mark'));
    expect(latest).toBeNull();
  });
});
