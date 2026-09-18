import type { LegalPage } from './index.ts';

export const TERMS_PAGE: LegalPage = {
  title: 'Terms',
  description:
    'The plans, the price, how payment works, what the product promises, and what happens to an account.',
  heading: 'Terms',
  summary:
    'The plans, what a payment does and does not do, what the product claims, and who an account belongs to. Written to be read in a minute.',
  sections: [
    {
      heading: 'The plans and the price',
      blocks: [
        [
          'Beginner is free: 30 games analysed in a calendar month, and 50 coach explanations in a calendar month.',
          'Intermediate is 799 rupees a month: 150 games analysed in a calendar month, and 100 coach explanations in a calendar month.',
          'Pro is 1,299 rupees a month: no monthly cap on either.',
        ],
        'The prices are in Indian rupees and cover one player account. The limits reset at the start of each calendar month.',
      ],
    },
    {
      heading: 'Payment',
      blocks: [
        "Payment is taken by Razorpay, which handles the card, the bank, and any currency conversion. The card form is Razorpay's and is served by Razorpay. We receive an order reference, the amount, and whether the payment succeeded.",
        'A plan opens when Razorpay confirms the payment, which is usually within seconds. The upgrade page waits for that confirmation before it says the plan is open, so if the page is still waiting, the plan is not open yet.',
      ],
    },
    {
      heading: 'Nothing renews by itself, and nothing expires',
      blocks: [
        'A payment is not a subscription. No mandate is stored, no card is kept on file, and no further charge can be made against the account.',
        'A payment does not have an end date either. The monthly limits reset with the calendar month, but the plan stays open on the account until something changes it. That is the honest state of the product today: buy a month, and the plan does not currently run out.',
        'Where either of those changes, this page will say so before it does.',
      ],
    },
    {
      heading: 'Cancelling, and refunds',
      blocks: [
        'There is nothing to cancel, because no further charge can arrive.',
        'If a charge was a mistake, or a plan was not what was expected, write to the contact address within 14 days of the charge and we will refund it through Razorpay to the payment method it came from.',
      ],
    },
    {
      heading: 'What the product promises',
      blocks: [
        'The analysis, the diagnosis, and the verification are computed from the games a player brings in. They are a study aid. Nothing here promises a rating gain, a tournament result, or that a weakness will be fixed.',
        'Where a page on this site describes something the product does not do, the product is right and the page is wrong. Tell us and we will fix the page.',
      ],
    },
    {
      heading: 'The account',
      blocks: [
        "An account belongs to the player it was created for, and the password is the player's or the guardian's to keep. A player can delete the account at any time, from settings.",
        "The games imported should be the player's own. We may close an account used to pull in other people's games at scale, or used to attack the service.",
      ],
    },
    {
      heading: 'Governing law',
      blocks: [
        'Kanso Chess is operated from India. These terms are governed by the law of India, and a dispute belongs to the courts of India.',
      ],
    },
  ],
};
