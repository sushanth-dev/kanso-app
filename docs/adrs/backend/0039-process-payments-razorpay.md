# 0039. Process payments with Razorpay

* Status: accepted
* Date: 2026-08-18
* Builds on: [ADR-0011](0011-better-auth-session-management.md), [ADR-0035](0035-minor-self-signup-consent.md)

## Context

Item 12, the free and paid tiers, needs a payment provider, and the schema has
already anticipated which one: `processed_payments` carries
`razorpay_payment_id` and `razorpay_order_id` with a unique constraint on the
payment id. The prototype used Razorpay, and `prototype-carryover.md` recorded
it as "undecided, and out of scope until there is something to sell". There is
now something to sell, so the decision is due.

The alternatives considered were Stripe and Razorpay. Stripe is the general
default for a billing integration, and it was rejected for a concrete reason
rather than a preference: the schema and the prototype are already
Razorpay-shaped, and adopting Stripe would mean changing the `processed_payments`
columns and the flow for no benefit beyond familiarity. Razorpay was chosen
because the schema already models it and the prototype already proved the
shape.

## Decision

Process payments with Razorpay. A purchase creates a Razorpay order, and the
confirmed `razorpay_payment_id` and `razorpay_order_id` are recorded in
`processed_payments`, which the schema already carries, so the schema does not
change for this decision.

## Consequences

* **Razorpay becomes a third-party dependency.** A payment gateway with an SDK
  and webhooks. We never store card numbers; Razorpay holds the instrument and
  we store the order and payment ids, which is what the schema already does.
* **A webhook boundary appears.** Razorpay confirms a payment by webhook, so
  the endpoint must verify the webhook signature before trusting it, and the
  story's security assessment carries that rather than assuming it.
* **Instrument coverage is India-first.** Razorpay's native instruments are
  INR, UPI, Indian cards and netbanking; foreign cards are a secondary path. If
  the market moves beyond that footprint, the provider sits behind a seam and a
  new record supersedes this one.
* **The paying adult remains separate from the playing child.** ADR-0035 binds
  the consent and guardian model this billing decision hangs off; the payment
  is the guardian's, the account is the guardian's, and the child is the
  player.
