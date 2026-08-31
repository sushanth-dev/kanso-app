# 0018. Use Gemini Flash for coaching prose, over engine-verified facts only

* Status: accepted
* Date: 2026-08-04
* Amended by: [ADR-0041](0041-glm-flash-coaching-prose.md) (2026-08-31; the provider is GLM-5.3-Flash, every rule below stands)
* Builds on: [ADR-0010](0010-chess-js-pgn-game-logic.md), [ADR-0014](0014-aws-hosting-layout.md)

## Context

Every record so far describes a system that computes. Stockfish produces
evaluations, our classifier turns evaluation swings into named mistakes, and
aggregation turns mistakes into a weakness report. None of that talks to the
player. A 1200-rated fourteen-year-old reading "move 23, Nxd5, blunder,
-2.4" learns that something went wrong and nothing about what.

The prototype answered this with a language model, and backed the answer with
money: the Socratic coach and its selectable personas shipped as paid
functionality rather than as a nicety. It also showed the failure mode. A model handed a FEN and asked to explain a position
will state, fluently and confidently, that a rook on a1 x-rays through a
knight to the enemy king. The prototype's fix was a system prompt encoding
the rules of long-range attacks and a standing instruction to verify every
claim against the FEN first. That reduced the problem without ending it,
because the guard depends on the model choosing to obey it.

We are also spending before we earn. Engine analysis already costs real money
per game and gates both the free-tier caps and the twelve-dollar price, and
model calls stack on top of it.

## Decision

We build an AI layer, and we constrain what it is allowed to know.

**The model never reads a position.** It is never given a FEN and asked to
reason about geometry. Every prompt receives a structured fact set that we
computed ourselves, and the model's job is to turn those facts into prose a
junior understands. The facts come from data we already hold: the move played
and the engine's best move in SAN, the evaluation before and after, the
resulting judgement and classification, the move number and phase, and the
opening. Where a fact is not already stored, we derive it with chess.js
(ADR-0010) rather than asking the model: attacker and defender counts on the
square in question, and the checks, captures, and threats available in the
position. The prototype already has both of these as pure functions.

If a claim is not in the fact set, the model may not make it. A sentence
naming a tactic we did not compute is a bug in our fact set, not a prompt to
be tuned.

**Four jobs, one interface.** The layer serves four call sites, each a
separate prompt over the same fact contract: explaining a single mistake,
asking a Socratic question about it instead of answering, narrating the
weakness report across games, and recommending which focus the player should
take next.

The fourth is different in kind from the other three and is constrained
harder. Explanation, Socratic questions, and report prose are rephrasing.
Recommending a focus is a judgement, and if a model makes it, our central
claim that we measure what a coach cannot stops being a measurement. So
ranking stays ours: we order candidate focuses by rating leak, in code, and
the model receives the ranked list and writes the case for the top one in
language the player will act on. It selects nothing. Should we later want the
model to reorder that list, it needs its own record and an evaluation
showing it beats sorting by rating leak.

**Gemini Flash.** The alternatives weighed were Claude through the Anthropic
API, Claude through AWS Bedrock, and deferring the choice entirely. Bedrock
is the one worth revisiting: it would keep model traffic inside the AWS
account SST already provisions (ADR-0015), on one bill and in a region we
choose, which is a better starting position for the COPPA question below. We
chose Gemini Flash because the prototype proved it holds up on exactly this
workload, and because it is the cheaper class of model at a moment when AI
spend stacks on engine spend against a price we have not validated. Confirm
current per-token pricing against Claude Haiku before committing spend; the
gap between the cheap tiers narrows often enough that the assumption deserves
a check rather than an inheritance.

Because the rejected option is genuinely close, the provider sits behind one
internal module whose input type is the fact set. Switching providers is a
contained change rather than a migration. We call the REST API directly, as
the prototype did, rather than taking an SDK dependency for what is one HTTP
call.

**Generated on demand, then cached.** Nothing is generated during analysis.
When a player opens a mistake, we generate the explanation and the Socratic
question, store them on the mistake row, and serve the stored copy every time
after. Report prose and the focus rationale generate when the report is
opened and cache against the aggregation they describe, regenerating when the
underlying numbers change. Most analyzed mistakes are never opened, so this
pays only for what someone reads.

Failures are not papered over. A malformed or truncated response throws and
the request retries; we never substitute canned text. A player reading
plausible generic prose about a mistake they did not make is worse than a
player seeing the numbers with an explanation still loading.

## Consequences

The correctness ceiling is now our fact set rather than the model's chess
ability. That is the point: a wrong explanation traces to a fact we computed
wrongly, which is debuggable and testable, rather than to a model that had a
bad day. It also means the layer is only as insightful as what we derive, so
the interesting work moves into deriving better facts. The prototype's
attacker/defender counts and check-capture-threat enumeration are the
starting set and will not be the last.

Prompts become part of the tested surface. The fact contract is a type, the
prompts are code, and a change to either can regress every explanation in the
product silently. They need golden-file tests over a fixed set of positions,
in the same PR as the change, per our testing policy.

Cost stays bounded by reads rather than uploads, which keeps a burst of
uploads from becoming a burst of model spend. The cost we have not bounded is
the report, which regenerates whenever the aggregation moves; if that proves
expensive we regenerate on a schedule instead of on change.

Two open items this record does not close. Sending a child's game data to a
third-party model provider is a question our COPPA decision has to answer,
and it may force a different provider or a regional constraint; that decision
is not made and this record does not assume it. And the four call sites are a
wide surface for a version one whose scope did not previously include AI at
all, so if delivery pressure comes, explanation and Socratic questions are
the pair that carry the product and the other two can wait.
