/**
 * ST-111. What's new: the features recently shipped, newest first, one line
 * each. Curated by hand from the delivery stories, which are the source of
 * truth for what shipped and when; the page grows one entry in the same
 * pull request as the feature it describes.
 */
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';

interface WhatsNewEntry {
  date: string;
  title: string;
  body: string;
}

// Newest first. One entry per user-visible change, added with the change.
const ENTRIES: WhatsNewEntry[] = [
  {
    date: '2 September 2026',
    title: 'The coach answers within your plan',
    body: 'Coach explanations now follow your plan: 10 a month on Beginner, 100 on Intermediate, unlimited on Pro. Texts you already have stay free to re-read. The report now links straight to your curriculum instead of listing it.',
  },
  {
    date: '1 September 2026',
    title: 'The coach works on demand',
    body: 'Open a mistake and its explanation is written on the spot from facts we computed, then kept. Report reads stopped asking the model, so they load the same with the coach on or off.',
  },
  {
    date: '1 September 2026',
    title: 'Your curriculum, closed by your own words',
    body: 'Every issue on your report gets three coached resources, and each one closes with a short assessment in your own words. Practice drills never repeat and schedule their own review.',
  },
  {
    date: '1 September 2026',
    title: 'Delete account',
    body: 'Settings has a danger zone: delete the account with your password, and everything it owns goes with it, in one step.',
  },
];

export function WhatsNewRoute() {
  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="space-y-4">
        <Heading level={1}>What's new</Heading>
        <Text as="p" display="block" type="supporting">
          The features we added to Kanso Chess, newest first.
        </Text>
      </header>
      <div className="mt-6 flex flex-col gap-4">
        {ENTRIES.map((entry) => (
          <Card key={entry.title} className="space-y-2 p-5">
            <Text as="p" display="block" type="supporting" className="text-sm">
              {entry.date}
            </Text>
            <Heading level={2}>{entry.title}</Heading>
            <Text as="p" display="block" type="supporting">
              {entry.body}
            </Text>
          </Card>
        ))}
      </div>
    </section>
  );
}
