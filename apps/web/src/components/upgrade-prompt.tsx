import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';

/**
 * The paid-boundary prompt every paid surface renders when a free account
 * reaches it: the boundary in one sentence and the plans link. The title names
 * the surface so the copy reads as that surface's refusal, not a generic one.
 */
export function UpgradePrompt({ title }: { title: string }) {
  return (
    <Card className="p-6">
      <Heading level={2}>{title}</Heading>
      <p className="mt-2 text-muted">
        Your first diagnosis is free. A focus, verification afterwards, and the proof sheet you send
        a parent are paid.
      </p>
      <Button label="See plans" href="/account/upgrade" variant="primary" className="mt-6" />
    </Card>
  );
}
