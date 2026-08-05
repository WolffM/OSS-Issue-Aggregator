# Incident: publish's version-sync commit killed by the dev pre-commit hook — 1 failure (2026-08-04)

> Written 2026-08-05 by an outside investigation run from `hadoku_site`, working
> only from GitHub Actions logs and commit history. Verified in-repo on
> 2026-08-05 (see "Verification findings" below) — the original propagation-race
> hypothesis was **wrong**; the corrected root cause is recorded here.

## What the daily CI digest showed

`hadoku-aggregator / Publish Package` — **1 failure**, latest run green.
Failed run: 30952500237 (2026-08-04 21:28 UTC, commit `dac907a` — `fix(a11y):
stop using fill colours as bare text`).

## Verification findings (2026-08-05, in-repo)

Every claim below was checked against the run's full logs, this repo's git
history, and the GitHub Packages version API.

1. **The 401 was NOT a registry-propagation race and NOT a scope gap on the
   real token.** `@wolffm/themes@3.0.8` was published 2026-08-03T23:34Z —
   almost 22 hours before the failure — and this repo publishes
   `@wolffm/hadoku-aggregator`, not themes, so "the version that run was
   publishing" was never a possible explanation. The same run's own "Install
   dependencies" step resolved `@wolffm/themes 3.0.8` successfully at
   21:28:59, eighteen seconds before the 401.

2. **The 401 was setup-node's literal placeholder token.** `setup-node` with
   `registry-url` writes a temp npmrc (`NPM_CONFIG_USERCONFIG`, which shadows
   `~/.npmrc`) containing `_authToken=${NODE_AUTH_TOKEN}`, and exports
   `NODE_AUTH_TOKEN=XXXXX-XXXXX-XXXXX-XXXXX` as a default for every later
   step. Each npm-touching step in publish.yml overrides that env with
   `HADOKU_SITE_TOKEN` — except "Push version bump back to repo", which only
   ran git commands until the pre-commit hook's typecheck triggered a
   `pnpm install`. That install also ran without `--config.store-dir`, so it
   used a store that didn't have the themes tarball, forcing a network fetch
   authenticated with the placeholder → 401. The failing step's log shows the
   unmasked placeholder in its env block.

3. **The bot-commit hook skip is `git commit --no-verify`** in publish.yml's
   "Push version bump back to repo" step, landed in `1495496` (2026-08-04
   21:32 UTC, run 30952787274, four minutes after the failure). It applies
   only to the workflow's version-sync commit; human commits still run the
   hook. `1495496`'s own commit message already contains the correct
   placeholder-token diagnosis — the outside report's race hypothesis was
   written without seeing it.

4. **The unquoted `--no-verify` message is fixed.** The failed log shows
   `.husky/pre-commit: 1: --no-verify: not found` (backticks inside a
   double-quoted echo executed as command substitution). The same commit
   `1495496` switched the message to single quotes; confirmed on main.

5. **One live instance of the same bug class remained:** update-wolffm.yml's
   auto-update bot commit ran `git commit` without `--no-verify`. Whether the
   hook fires there depends on leftover runner state (husky's `prepare` from
   any earlier install in the same persistent workdir sets `core.hooksPath`;
   `checkout` reuses the .git dir) — recent auto-update commits show no hook
   side effects, but the failed publish run proves husky does get activated
   on these runners. When it fires, the hook re-bumps the version (it bumps
   whenever package.json is staged) and typechecks. Fixed 2026-08-05 by
   adding `--no-verify` to that commit.

6. **No install-after-publish backoff is needed.** The suggested
   retry/backoff on "install right after publishing" addressed the race
   hypothesis, which the evidence disproved. No workflow in this repo
   installs its own just-published version, and no propagation lag was
   observed anywhere in this incident.

## Root cause (corrected)

A CI bot commit ran a hook written for human dev machines. The hook's
typecheck kicked off a `pnpm install` in the one step that still had
setup-node's placeholder `NODE_AUTH_TOKEN`, so the fetch of a cross-repo
`@wolffm/*` tarball got 401 Unauthorized — and the publish went red for a
reason that had nothing to do with the code being published (the package
itself had already published successfully; only the push-back and the
parent-repo notification were lost).
