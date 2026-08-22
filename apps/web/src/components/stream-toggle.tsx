import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import type { Stream } from '../api/diagnosis-api.ts';

export interface StreamToggleProps {
  stream: Stream;
  onChange: (stream: Stream) => void;
  /** The accessible name for the group; each surface names what the toggle picks. */
  ariaLabel?: string;
}

export function StreamToggle({ stream, onChange, ariaLabel = 'Stream' }: StreamToggleProps) {
  return (
    <SegmentedControl
      value={stream}
      onChange={(value) => onChange(value as Stream)}
      label={ariaLabel}
    >
      <SegmentedControlItem value="tournament" label="Tournament" />
      <SegmentedControlItem value="online" label="Online" />
    </SegmentedControl>
  );
}
