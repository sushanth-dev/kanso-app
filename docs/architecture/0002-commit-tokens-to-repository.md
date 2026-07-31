# 0002. Commit token sources to the repository

* Status: accepted
* Date: 2026-07-31

## Context

Token values have to live somewhere. The options were committing the
source files to this repository, treating a design tool as the source of
truth and exporting from it, or publishing a separate token package that
consumers install.

## Decision

The repository is the source of record. The DTCG source files live at
`tokens/` at the repository root, are reviewed and versioned like code,
and design tool exports land as committed files. Nothing flows from the
repository back into a design tool.

The flattened convenience copy, `tokens/_computed.json`, is generated
rather than authored, so it is gitignored along with the Style Dictionary
build output under `tokens/build/`.

## Consequences

Review, history, and the CI contrast check all live in one place, and a
token change is a pull request like any other. The design tool is a
consumer, never the source: a value that exists only in the tool is lost
the next time someone exports. Committed generated output is forbidden,
because a stale generated file is worse than no file.
