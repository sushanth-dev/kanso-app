# Architecture decision records

Significant technical decisions are recorded here as architecture decision
records. Each ADR states the context, the decision, and its consequences.
Once accepted, an ADR is never edited in place; a superseding decision gets
its own record that links back to the one it replaces. The format and rules
are in [ADR-0000](frontend/0000-record-architecture-decisions.md).

Records are grouped by area, and the groups share one number sequence: a
number is assigned once, never reused, and never restarted per folder.
"ADR-0003" means exactly one decision, in code comments and documents alike.

## Records

* [Frontend](frontend/index.md) - the record format and the design-system
  decisions.
* [Backend](backend/index.md) - the API service: framework, validation,
  data access, chess handling, authentication, and engine analysis.
