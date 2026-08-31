# 0041. Write the coaching prose with GLM-5.3-Flash from Z.AI

* Status: accepted
* Date: 2026-08-31
* Builds on: [ADR-0018](0018-ai-explanation-layer.md)
* Amends: [ADR-0018](0018-ai-explanation-layer.md) (the provider choice only)

## Context

ADR-0018 fixed the shape of the AI layer before it fixed a provider: facts
only, no positions, mechanical validation, one internal seam, no SDK. It chose
Gemini Flash with an explicit instruction not to inherit the assumption:

> Confirm current per-token pricing against Claude Haiku before committing
> spend; the gap between the cheap tiers narrows often enough that the
> assumption deserves a check rather than an inheritance.

ST-100 is that check, with two years of usage data attached. The layer now
serves three live call sites (mistake explanation, Socratic question, report
advice) plus the report's opening plan. Model spend still stacks on engine
spend against a price we have not validated, and the incumbent has aged:

* Gemini 3 Flash Preview scores 39 on the Artificial Analysis Intelligence
  Index (the reasoning-weighted composite).
* GLM-5.3-Flash scores 57 on the same index, at $0.15 per million input
  tokens and $0.50 per million output tokens (50% off until 9 September 2026
  under the launch promotion; the sticker prices are the ones recorded here).
* For comparison, Gemini 3.7 Flash sits at a similar intelligence for $0.75
  per million input and $3.75 per million output, introductory until the end
  of 2026.

The provider quality risk is bounded by construction. The model rephrases
facts we computed; ADR-0018's allowlist validator rejects any number or SAN
token the fact set does not contain, so a weaker or stronger model can
flounder but cannot invent. The seam made switching a contained change rather
than a migration, exactly as the record predicted.

## Decision

The model is GLM-5.3-Flash from Z.AI, model code `glm-5.3-flash`, called over
the OpenAI-compatible chat-completions endpoint `https://api.z.ai/api/paas/v4`
with bearer authentication, using plain `fetch`. No SDK, per ADR-0018's
standing rule. The key is read from `ZAI_API_KEY`, the model from
`ZAI_MODEL`, which defaults to `glm-5.3-flash` when unset. `ZAI_API_KEY`
replaces `GEMINI_API_KEY` outright; there is no compatibility alias. The seam
file is `coaching/zai.ts`; the `AiClient` interface and every fact-set,
validation, storage, and fallback rule of ADR-0018 are unchanged.

Weighed against staying on Gemini Flash (and its 3.x successors): the
class-checked price gap is now five to ten times wider than when ADR-0018 was
written, on a higher reasoning score, for a workload that is small in volume
and strictly fact-bound. Bedrock (rejected in ADR-0018, kept open for the
COPPA question) remains the recorded answer if the provider has to move
inside the AWS account; this record does not close that question.

## Consequences

* **The third party changes company.** Z.AI now receives the fact sets Gemini
  received. ADR-0030's constraint carries over verbatim: a child's game data
  must not reach this provider until the COPPA record is revisited. The
  machine-readable facts are the same class; nothing new crosses the
  boundary.
* **The response parsing is OpenAI-shaped.** The final text lives in
  `choices[0].message.content`; GLM-5.3-Flash always reasons (`thinking.type`
  supports only `enabled`) and the reasoning arrives separately, so the
  content field is what we store. Markdown fences around requested JSON are
  stripped, as they were for Gemini.
* **Latency moves the wrong way slightly.** The model decodes around 49
  tokens per second and always thinks first. Our outputs are one to three
  sentences or one small JSON array, so the absolute cost is a few seconds on
  paths that are already asynchronous or once-per-regeneration. If a call
  site ever needs interactive latency at volume, that is the trigger to
  revisit `reasoning_effort` or the model.
* **The promotion ends.** After 9 September 2026 the price doubles to the
  sticker rates recorded above, which still clears the incumbent by a wide
  margin. The check ADR-0018 asked for stays a periodic duty, not a one-off.
* **The old key is dead.** Deployments read `ZAI_API_KEY` from `.env` at
  deploy time (ADR-0014's secret discipline). An environment that still
  carries only `GEMINI_API_KEY` loses the prose layer silently but safely:
  the coach routes unmount and the report falls back to its templates. The
  deploy guide's env step and `.env.example` are the checklist.
