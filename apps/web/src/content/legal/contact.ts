import { CONTACT_EMAIL, type LegalPage } from './index.ts';

export const CONTACT_PAGE: LegalPage = {
  title: 'Contact',
  description:
    'One address for support, privacy requests, billing questions, and consent links that expired.',
  heading: 'Contact',
  summary: `One address handles all of it: ${CONTACT_EMAIL}. A person reads it, and it is the same person who builds the product.`,
  sections: [
    {
      heading: 'What to write about',
      blocks: [
        [
          "A privacy request: a copy of a player's data, a correction, or the deletion of an account.",
          'A guardian consent link that has expired before it was opened.',
          'A billing problem: a charge that looks wrong, a refund, or a question about a plan.',
          'A bug: what was being done, what happened, and what was expected instead.',
          'Something on this site that is wrong, unclear, or out of date.',
        ],
        'Sign-in problems are usually fastest solved by the reset password link on the sign-in page. If that link does not arrive, check the spam folder before writing, and mention it if it is not there either.',
      ],
    },
    {
      heading: 'A guardian consent link, if it expired',
      blocks: [
        "The consent link we email a parent or guardian works for three days. If it expired before it was opened, write from the guardian address with the player's name and the email address used to sign up.",
        'There is no self-serve way to send a new link today, which is why this page asks for an email instead of offering a button.',
      ],
    },
    {
      heading: 'Deleting an account',
      blocks: [
        'A signed-in player can delete their own account from settings, which erases the games, the reports, and the practice history with it, immediately and permanently.',
        'A parent or guardian who does not have the password can ask here instead, and the account will be removed for them.',
      ],
    },
    {
      heading: 'Before we act on a request',
      blocks: [
        'For anything touching an account, we ask that the request come from the address on the account, or from the guardian address on it. That check is the reason for an email rather than a button, and it is the only reason we ask for detail.',
      ],
    },
  ],
};
