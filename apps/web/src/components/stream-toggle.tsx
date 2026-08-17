import type { Stream } from '../api/diagnosis-api.ts';

export interface StreamToggleProps {
  stream: Stream;
  onChange: (stream: Stream) => void;
  /** The accessible name for the group; each surface names what the toggle picks. */
  ariaLabel?: string;
}

export function StreamToggle({ stream, onChange, ariaLabel = 'Stream' }: StreamToggleProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-control border border-border-strong bg-raised p-0.5"
    >
      {(['tournament', 'online'] as const).map((option) => {
        const selected = option === stream;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option)}
            className={
              selected
                ? 'press rounded-sm bg-accent px-4 py-2 font-ui text-sm text-on-accent'
                : 'press rounded-sm px-4 py-2 font-ui text-sm text-muted hover:text-primary'
            }
          >
            {option === 'tournament' ? 'Tournament' : 'Online'}
          </button>
        );
      })}
    </div>
  );
}
