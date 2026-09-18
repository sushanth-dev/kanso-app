import type { LegalPage } from './index.ts';

export const ABOUT_PAGE: LegalPage = {
  title: 'About',
  description:
    "What Kanso Chess does with a player's games, who it is for, and what this site deliberately does not claim.",
  heading: 'About',
  summary:
    'Kanso Chess takes the games a junior player already played and turns them into the next thing to work on. This page says what the product does, who it is for, and what it is built on.',
  sections: [
    {
      heading: 'What it does',
      blocks: [
        'A player brings in their own games, and the product turns them into one thing to practise:',
        [
          'Import from Chess.com or Lichess by username, or upload a PGN file from a tournament.',
          'Every move is checked by an engine, and the mistakes are grouped into weaknesses, ranked by what is costing the most rating.',
          'One focus is chosen from that ranking, with drills that practise it.',
          'After the next tournament, the verification: did the thing that was costing rating actually move.',
          'A proof sheet a coach can send to a parent, and a share link anyone can open without an account.',
        ],
        'The point is the constraint. An engine will comment on every move. A junior player works on one thing at a time.',
      ],
    },
    {
      heading: 'Who it is for',
      blocks: [
        'Junior players, the coaches who work with them, and the parents who pay for it.',
        "A player gets one thing to fix rather than an engine's opinion about forty moves. A coach gets a link that says what changed since last time, which is a shorter conversation with a parent. A parent gets a page that is legible without knowing chess.",
      ],
    },
    {
      heading: 'What it is built on',
      blocks: [
        [
          'Stockfish checks the moves. It is an open-source engine anyone can run, which is the point: the analysis of a game is not a secret, and the work is in what gets said about it.',
          'The coaching text around a mistake is written by a language model and presented as a suggestion rather than a verdict.',
          'Games come from Lichess and Chess.com, the two platforms the junior chess world already uses.',
          'The application runs on Amazon Web Services in India, and the site is served by Cloudflare.',
        ],
      ],
    },
    {
      heading: 'What this site does not do',
      blocks: [
        'There are no invented testimonials, no borrowed user counts, and no logos of organisations that have not agreed to be listed. Where an example is shown, it is labelled as an example, and the numbers on a synthetic report are synthetic.',
        'That is a deliberate trade. A landing page with a large number on it converts better, and the number would be one we could not stand behind.',
      ],
    },
    {
      heading: 'Reaching a person',
      blocks: [
        'One address reaches the people who build this. It is on the contact page, and it is read.',
      ],
    },
  ],
};
