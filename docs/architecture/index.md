# Architecture

Significant technical decisions are recorded here as architecture decision
records. Each ADR states the context, the decision, and its consequences.
Once accepted, an ADR is never edited in place; a superseding decision gets
its own record that links back to the one it replaces.

The format and rules are in [ADR-0000](0000-record-architecture-decisions.md).
The first records are the frontend decisions, because the design system is
the first thing built. The backend framework, the database access layer,
and the hosting layout on AWS each get a record before implementation
starts.

## Records

* [0000. Record architecture decisions](0000-record-architecture-decisions.md)
* [0001. Store design tokens in DTCG format 2025.10](0001-dtcg-2025-10-token-format.md)
* [0002. Commit token sources to the repository](0002-commit-tokens-to-repository.md)
* [0003. Build tokens with Style Dictionary](0003-style-dictionary-token-build.md)
* [0004. Consume tokens through Tailwind CSS 4](0004-tailwind-4-consumes-tokens.md)
* [0005. Use Astryx for interface primitives](0005-astryx-primitives.md)
