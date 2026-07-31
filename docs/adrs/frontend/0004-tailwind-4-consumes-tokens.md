# 0004. Consume tokens through Tailwind CSS 4

* Status: accepted
* Date: 2026-07-31
* Builds on: [ADR-0003](0003-style-dictionary-token-build.md)

## Context

The generated CSS custom properties have to become usable utilities. The
frontend stack already includes Tailwind, and Tailwind 4 moves
configuration into CSS, which fits a token pipeline: Style Dictionary
writes a CSS file, and Tailwind turns the custom properties in it into
utilities.

## Decision

Tailwind 4 consumes the generated CSS. Style Dictionary names its output
to match Tailwind's theme namespaces (`--color-*`, `--spacing-*`,
`--radius-*`, `--text-*`, `--font-*`, `--ease-*`), so a token emitted as
`--color-board-square-light` produces the utility
`bg-board-square-light` with no extra configuration. Tokens meant to
generate utilities go in `@theme`; tokens that should not go in `:root`.
The app imports both:

```css
@import "tailwindcss";
@import "./tokens.css";
```

Two consequences of how `@theme` works are accepted. A dark theme cannot
live inside `@theme`, so light values are generated into `@theme` and
theme overrides into a plain `[data-theme="dark"]` block of custom
properties, which the utilities already reference. And `@theme inline` is
used when a theme variable references another variable, so the reference
resolves at the use site rather than the definition site.

## Consequences

Theming stays file-based for now: each theme is its own token file merged
over the base set at build time, because the DTCG resolver module that
would model themes properly is a preview draft and Style Dictionary does
not support it yet. No CSS-in-JS library is added, and there is no
hand-maintained utility layer between the tokens and the components.
