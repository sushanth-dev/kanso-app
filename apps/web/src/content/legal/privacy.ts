import type { LegalPage } from './index.ts';

export const PRIVACY_PAGE: LegalPage = {
  title: 'Privacy',
  description:
    'What a Kanso Chess account holds, why we hold it, who else sees it, and how to have it deleted.',
  heading: 'Privacy',
  summary:
    'A Kanso Chess account holds a name, an email address, the chess a player brings in, and what we compute from it. This page lists all of it, says what each part is for, and says how to have it removed.',
  sections: [
    {
      heading: 'What we collect',
      blocks: [
        'A player signs up with a name, an email address, and a password. The name is what the app addresses the player by and what appears on a page a coach or a parent opens. The email reaches the account: sign-in, a password reset, a guardian consent request when the player is under 13, and the occasional nudge about a tournament that has not been imported yet.',
        'The password is stored hashed. Nobody at Kanso Chess can read it and we cannot recover it, so a forgotten password is replaced through an emailed reset link rather than looked up.',
        'A date of birth is optional at sign-up. Where it is given, it is read for one purpose only, which is deciding whether the age gate applies. It is not shown anywhere in the product and it is not used for marketing.',
        "From then on the account holds the chess a player brings in: games imported from Chess.com or Lichess by username, or a PGN file uploaded after a tournament, along with everything computed from those games. That is each move's analysis, the weaknesses found in it, the focus the player sets, the practice history, and any proof sheet or share link made from it.",
        'We also record how the product is used. That has its own section below, because it is the part people do not expect.',
      ],
    },
    {
      heading: 'Why we collect it',
      blocks: [
        'Every field exists for one of two reasons: to run the account, or to keep a child safe.',
        [
          'The name labels the player on their own report and on a page a coach or a parent opens.',
          'The email is the only way we reach the account and the only way a password is reset.',
          'The date of birth decides whether a parent or guardian has to consent. Nothing else reads it.',
          'The guardian email is where a consent request goes, so an account held by a child has an adult accountable for it.',
          'The games and their analysis are the product. The diagnosis, the focus, the practice, and the verification all come out of them.',
          'The usage data tells us which surfaces work and which do not.',
        ],
      ],
    },
    {
      heading: 'What we do not collect',
      blocks: [
        [
          'No card or bank details. The card form belongs to Razorpay and is served by Razorpay. What reaches us is an order reference, an amount, and whether the payment succeeded.',
          'No advertising cookies and no third-party trackers beyond the analytics described below.',
          'Nothing sold, and nothing handed to anyone outside the services listed below.',
          'No location, no contacts, and no access to a camera or a microphone.',
        ],
        "A player's chess is already public in the places it comes from. Games imported from Chess.com or Lichess were visible there before the import, and importing them changes nothing about who could see them there.",
      ],
    },
    {
      heading: 'Usage data, and session replay',
      blocks: [
        'We use PostHog for product analytics, and we run its full suite rather than a few counters: page views, automatic capture of clicks and other interactions, session replay, surveys, feature flags, and error reports. Page views and automatic capture read the page and the address the browser is on. Session replay records what was on the screen.',
        'What that means in practice is worth stating plainly, because a session recording can include the board, the game, the report, a name the app happened to be displaying, and text typed into a form.',
        "We never send PostHog a name, an email address, or an account identifier. A random anonymous identifier in the browser is the only identity this data carries. Both halves of that matter: a record in PostHog cannot be found by a person's name, and a recording can still show a name if the app was displaying one at the time.",
        'PostHog holds this on its cloud service in the United States. Error reports go there too, which is how we hear about a failure without being told about it.',
      ],
    },
    {
      heading: 'Children under 13',
      blocks: [
        'A junior player is the person this product is built for, so this is the section that matters most.',
        "When the date of birth makes the player under 13, sign-up requires a parent or guardian's email address, and it refuses the player's own address in that field. The account is created and is then closed to use: signing in leads to a page that says consent is pending.",
        'The guardian is emailed an explanation and a link. Opening that link records consent and opens the account. The link is signed, so it cannot be forged. It is good for a single confirmation, and it stops working after three days.',
        'If the link expires before it is opened, writing to the address on the contact page is the only way to get another one today. There is no self-serve resend, and the request has to come from the guardian address.',
        "Thirteen is the threshold the age gate uses. It is the line the Children's Online Privacy Protection Act (COPPA) draws in the United States, and the gate applies to every account regardless of where the player is.",
        "A parent or guardian can exercise everything on this page on the player's behalf: a copy, a correction, or the deletion of the account and everything in it.",
      ],
    },
    {
      heading: 'How long we keep it',
      blocks: [
        'The account, the games, the reports, and the practice history stay until the account is deleted. We do not expire an inactive account, and nothing is deleted for being old.',
        'Deleting an account is immediate and permanent. The account row is deleted, and every game, report, proof sheet, and practice record belongs to it in a way that is deleted with it. There is no waiting period and no way to undo it.',
        'The database takes automated encrypted backups, so a copy of the data can sit in those backups for up to seven days before they expire on their own. Nothing restores an individual account from a backup to keep it alive.',
        "Analytics records carry no name and no email address, so a deletion cannot find them by identity. They age out under the PostHog project's own retention setting. A parent who wants the analytics recorded from their child's browser removed can write to the contact address from the guardian address, and we will remove it by hand.",
      ],
    },
    {
      heading: 'Who else sees it',
      blocks: [
        'Five services touch this data, and this is what each of them does with it:',
        [
          'Razorpay takes the payment and holds the card. It is the party that sees the card details.',
          'PostHog Cloud holds the analytics and the session recordings, in the United States.',
          'Resend delivers our email: the guardian consent request, the password reset, and the nudge.',
          'Amazon Web Services runs the application and holds the database, in the Asia Pacific (Hyderabad) region in India.',
          "Cloudflare serves the website and holds the domain's DNS.",
        ],
        "When a player imports by username, we ask Chess.com or Lichess for that username's public games. Only the username is sent.",
        'We do not share, sell, or rent any of this for advertising, and no one outside these five services receives it.',
      ],
    },
    {
      heading: 'A copy, a correction, or a deletion',
      blocks: [
        'Deleting an account is self-serve. Settings has a delete account action, it asks for the account password, and it removes the account, the games, the reports, and the practice history. There is no waiting period and nothing to confirm by email afterwards.',
        'A parent or guardian who does not have the password can write to the contact address and the account will be removed for them.',
        'For a copy of the data, a correction, or any question about this page, write to the contact address. Before acting on a request we ask that it come from the address on the account or from the guardian address on it, which is the reason for an email rather than a button.',
      ],
    },
  ],
};
