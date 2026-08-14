# 0031. Refine frontend surfaces with the Impeccable plugin

* Status: accepted
* Date: 2026-08-14
* Builds on: [ADR-0004](0004-tailwind-4-consumes-tokens.md),
  [ADR-0005](0005-astryx-primitives.md)

## Context

ADRs 0001 through 0006 settle how a color, a size, or a primitive reaches
the screen. None of them settles what a screen composed from those pieces
should look like, and the design system policy in the `project` repository
governs tokens and primitives rather than composition. The first frontend
story, ST-020, was accepted against the stack, the data path, WCAG 2.2 AA,
and a phone browser, all of which a plain, unconsidered screen satisfies.

Left alone, visual quality becomes a per-story judgement call, and the
screens drift apart at the rate we add them. The report and diagnosis
screens are larger than everything built so far, so the drift gets more
expensive from here, not less.

The Impeccable plugin, installed in the local Claude Code environment,
addresses exactly this gap. It reads two context documents, `PRODUCT.md`
and `DESIGN.md`, critiques and audits a shipped surface against them, and
derives `DESIGN.md` from the built artifact rather than from intentions.
It also draws the line this project needs drawn: refinement preserves the
incumbent visual identity, redesign replaces it, and the two are separate
acts.

The alternative considered was a written checklist in the design system
policy and reliance on review. It was rejected for the reason the policy
already gives about accessibility: quality that depends on someone
remembering it is quality we do not have.

## Decision

Any story that changes what a screen looks like goes through Impeccable.
In practice that means four things.

* Read `PRODUCT.md` and `DESIGN.md` before changing a surface. Both live
  at the root of this repository and are maintained documents, not
  snapshots.
* Critique and audit the existing surface before editing it, so the work
  answers findings rather than taste.
* Refine by default. Refinement preserves the incumbent identity,
  behavior, and copy that states a fact. A finding that the visual world
  should be replaced rather than refined is a decision for Sushanth and
  its own story, never something a refinement pass does on its own.
* Update `DESIGN.md` from what shipped, at the end, as part of the same
  pull request.

Impeccable is a local tool that edits our source. It is not a project
dependency: nothing enters `package.json` on its account, no gate depends
on it being installed, and it introduces no runtime code.

This adds a step to frontend work; it removes no existing rule. Every
visual decision still resolves to a semantic token per ADR-0003 and
ADR-0004, primitives still come from Astryx per ADR-0005, and the WCAG 2.2
AA floor and its `axe-core` checks still bind. Output from the plugin is
reviewed like any other diff and is exempt from nothing.

A frontend change that alters no visual decision, such as routing, data
fetching, or form wiring, is outside this record.

## Consequences

`DESIGN.md` becomes a load-bearing document with a maintained history,
which means a frontend pull request carries a `DESIGN.md` diff to review
alongside the code, and a stale `DESIGN.md` becomes a defect rather than a
curiosity.

The tool is local, so CI cannot enforce this and review is what holds it.
That is accepted: the artifact the rule exists to protect, `DESIGN.md`, is
in the repository and reviewable even when the tool is not available. If
the plugin disappears, the document and the practice of trueing it up
against shipped screens survive it, and this record is superseded rather
than quietly abandoned.
