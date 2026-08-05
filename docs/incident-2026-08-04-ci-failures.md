# Incident: publish's version-sync commit killed by the dev pre-commit hook — 1 failure (2026-08-04)

> Written 2026-08-05 by an outside investigation run from `hadoku_site`, working
> only from GitHub Actions logs and commit history — it never ran anything in
> this checkout. Treat every claim below as a **hypothesis to verify against
> this repo's own evidence** before acting on it. Verify first, then fix.

## What the daily CI digest showed

`hadoku-aggregator / Publish Package` — **1 failure**, latest run green.
Failed run: 30952500237 (2026-08-04 21:28 UTC, commit `fix(a11y): stop using
fill colours as bare text`).

## Evidence gathered from outside

- The failure was in the **"Push version bump back to repo"** step: the
  version-sync bot commit triggered the dev `.husky/pre-commit` hook, whose
  typecheck kicked off a `pnpm install` — which failed with
  `[ERR_PNPM_FETCH_401] GET https://npm.pkg.github.com/download/@wolffm/themes/3.0.8`.
- `@wolffm/themes@3.0.8` is plausibly the very version **that run was in the
  middle of publishing** — a registry-propagation race (or a token-scope gap)
  during the seconds between publish and availability.
- Secondary bug in the same log: the hook's failure message executed
  `--no-verify` as a command (`.husky/pre-commit: 1: --no-verify: not found`)
  — backtick command-substitution inside a double-quoted echo. The **current**
  hook on main uses single quotes, so this looks already fixed; confirm.
- Four minutes later, run 30952787274 (`fix(ci): don't run the dev pre-commit
  hook on the version-sync bot commit`) went green, and every publish since
  has been green.

## Root-cause hypothesis

A CI bot commit ran a hook written for human dev machines. The hook's
typecheck needs an install, the install needed a package version that the same
workflow had not finished making available, and the whole publish went red for
a reason that had nothing to do with the code being published.

## Your task

1. **Verify independently.** Confirm: the version-sync commit path now skips
   the dev hook (find the exact mechanism — `--no-verify`, `core.hooksPath`,
   or env guard — and that it only applies to the bot, not to humans); the
   hook's `--no-verify` message is properly quoted on main; and whether the
   401 was propagation lag or a token that genuinely cannot read
   `@wolffm/themes` (check what token the runner's npmrc resolves).
2. **Then fix what verification confirms.** Candidates found from outside:
   - If any other CI step installs dependencies immediately after publishing
     (deploy jobs, smoke tests), it is exposed to the same
     just-published-version race — consider a short availability
     retry/backoff on install where that applies.
   - If the 401 was a token-scope issue rather than a race, that is a live bug
     the hook-skip merely papered over — chase it to the actual token.

If your investigation contradicts anything above, trust your evidence, not
this document — and correct this file so the record is right.
