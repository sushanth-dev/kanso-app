# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately
through [GitHub's private vulnerability reporting](../../security/advisories/new)
for this repository, and we will respond as quickly as a solo project
allows.

## Standing rules

These rules apply to every change, and every story or task carries a written
security assessment:

* No secrets in code, config, or documentation. Environment variables
  locally, a secrets manager in deployed environments.
* Parameterized queries only. No string-built SQL, ever.
* All input from users, chess engines, and external APIs is validated and
  sanitized at the boundary.
* Database roles, AWS permissions, and API tokens get the minimum access
  needed.
* Dependencies are pinned, and `npm audit` runs in CI. Known vulnerable
  versions do not merge.
