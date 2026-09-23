import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { PRODUCT_EVIDENCE } from './landing-content.tsx';

/**
 * Checkable product evidence (ST-167). Renders verified facts about the
 * platform data counted from the repository, including data provenance and
 * snapshot dates, avoiding ungrounded user or usage claims.
 */
export function ProductEvidence() {
  return (
    <Card className="mt-3 w-full p-4">
      <Text
        as="p"
        display="block"
        type="supporting"
        className="font-mono text-xs uppercase tracking-wider"
      >
        Platform evidence · Verified
      </Text>
      <div className="mt-2 space-y-2">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <Text className="font-display text-sm font-semibold">
              {PRODUCT_EVIDENCE.puzzleCount} curated puzzles
            </Text>
            <Text type="supporting" className="font-mono text-xs">
              {PRODUCT_EVIDENCE.puzzleThemes} themes
            </Text>
          </div>
          <Text as="p" display="block" type="supporting" className="mt-0.5 text-xs">
            Source: {PRODUCT_EVIDENCE.puzzleSource} · {PRODUCT_EVIDENCE.puzzleCountDate}
          </Text>
        </div>
        <div className="border-t border-border-subtle pt-2">
          <div className="flex items-baseline justify-between gap-2">
            <Text className="font-display text-sm font-semibold">
              {PRODUCT_EVIDENCE.ecoCount} opening families
            </Text>
            <Text type="supporting" className="font-mono text-xs">
              Full ECO
            </Text>
          </div>
          <Text as="p" display="block" type="supporting" className="mt-0.5 text-xs">
            Source: {PRODUCT_EVIDENCE.ecoSource} · {PRODUCT_EVIDENCE.ecoCountDate}
          </Text>
        </div>
      </div>
    </Card>
  );
}
