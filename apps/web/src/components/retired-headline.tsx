/**
 * ST-151. The headline: patterns verified retired from real games, by
 * stream, never puzzles solved. Each stream reads `GET /patterns` on its
 * own and degrades on its own - a pending stream shows a spinner in place
 * of its number, a failed stream renders nothing rather than blocking its
 * sibling or the rest of the page. A retired count always carries a path
 * to its evidence; a zero count names what starts a pattern toward one.
 * Static, unlike `RankOneLeak`: this is not the report's one authored
 * motion moment.
 */
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import type { Stream } from '../api/diagnosis-api.ts';
import { patternsQueryOptions } from '../query-client.ts';

const STREAM_LABEL: Record<Stream, string> = {
  tournament: 'tournament',
  online: 'online',
};

function RetiredStat({ stream }: { stream: Stream }) {
  const query = useQuery(patternsQueryOptions(stream));

  if (query.isPending) {
    return (
      <div className="flex items-center gap-2 py-1">
        <Spinner size="sm" />
        <Text type="supporting" className="font-ui text-xs">
          retired · {STREAM_LABEL[stream]}
        </Text>
      </div>
    );
  }

  if (query.isError) return null;

  const { patterns, verificationFloor } = query.data;
  const retired = patterns.filter((pattern) => pattern.state === 'retired').length;

  return (
    <div className="space-y-1">
      <Text className="font-mono text-2xl">{retired}</Text>
      <Text type="supporting" className="font-ui text-xs">
        retired · {STREAM_LABEL[stream]}
      </Text>
      {retired > 0 ? (
        <Link href={`/report?stream=${stream}#debt-board`} className="text-sm">
          See the evidence
        </Link>
      ) : (
        <Text as="p" display="block" type="supporting" className="text-sm">
          Drill a weakness to mastery, then keep it out of your {STREAM_LABEL[stream]} games across
          the next {verificationFloor} to retire it.
        </Text>
      )}
    </div>
  );
}

export function RetiredHeadline({ streams }: { streams: Stream[] }) {
  return (
    <Card className="reveal-in space-y-4 p-4">
      <Heading level={2}>Mistakes eliminated</Heading>
      <div className="flex flex-wrap gap-6">
        {streams.map((stream) => (
          <RetiredStat key={stream} stream={stream} />
        ))}
      </div>
    </Card>
  );
}
