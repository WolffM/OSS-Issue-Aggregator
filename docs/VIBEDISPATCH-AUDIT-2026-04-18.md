# Aggregator audit — findings from vibedispatch Phase 4 target-selection

**Filed**: 2026-04-18 by vibedispatch
**Context**: crimson-kitty pipeline is entering Phase 4 — dispatching 20 real
external-upstream issues. While shortlisting from `/recon/all-scored-issues`
we audited every endpoint the pipeline consumes against 4 representative
targets (jestjs/jest, microsoft/TypeScript, sharkdp/bat, supabase/supabase,
huggingface/transformers) and spot-checked the remaining 16 targets.

Four blocker/high-priority issues, two moderate gaps, two minor cleanups.

---

## TL;DR

| #                                                               | Change                                                                              | Priority    | Blocks                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------- |
| [A1](#a1--issue-briefid-breaks-on-hyphenated-owner-slugs)       | Issue-brief endpoint breaks on hyphenated-owner slugs                               | **Blocker** | oven-sh/bun, microsoft/winget-cli, any `foo-bar/baz` |
| [A2](#a2--ai_policy-returns-unknown-on-every-repo)              | `ai_policy` always returns `"unknown"`                                              | **Blocker** | All external-upstream safety                         |
| [A3](#a3--killed-false-on-wound-down-repos)                     | `killed: false` on repos explicitly in maintenance mode                             | **Blocker** | microsoft/TypeScript, others                         |
| [A4](#a4--agentsmd-never-fetched)                               | `AGENTS.md` never fetched or served                                                 | High        | Agent-specific directives lost                       |
| [M1](#m1--likelyfiles-coverage-inconsistent)                    | `likelyFiles` populated for some repos, empty for others                            | Medium      | Agent scoping quality                                |
| [M2](#m2--rich-signals-computed-but-undocumented-for-consumers) | `detectedQuirks`, `commentDigest`, `relatedIssues`, etc. undocumented               | Medium      | Consumer discoverability                             |
| [m1](#m1--embedded-issue-url-inside-brief-text)                 | Brief text embeds `https://github.com/{slug}/issues/{n}` — force-scrubs on our side | Low         | Fragility                                            |
| [m2](#m2--repohealth-duplicated-inside-issue-brief)             | `repoHealth` duplicated inside `issue-brief` payload                                | Low         | Redundancy                                           |

---

## Blockers

### A1 — `/issue-brief/{id}` breaks on hyphenated-owner slugs

**Repro**:

```bash
# Health works — slug resolves fine
curl -sS https://hadoku.me/oss/api/recon/oven-sh-bun/health
# → success: true, data.slug: "oven-sh-bun"

# Issue-brief fails — ID parsing falls apart
curl -sS https://hadoku.me/oss/api/recon/oven-sh-bun/issue-brief/github-oven-sh-bun-14522
# → success: false, error: "issue not found: github-oven-sh-bun-14522"
```

**Cause**: The issue-ID format `github-{owner}-{repo}-{n}` is ambiguous when
the owner slug itself contains a hyphen. The parser presumably splits on
`-` and mis-attributes segments (e.g., `owner=oven`, `repo=sh-bun-14522`).

**Affected in current Phase 4 target list**:

- `oven-sh/bun#14522` (pick #9) — blocks eligibility

**Future affected slugs** in your bootstrap list where it'd also break:

- `oven-sh/bun`
- Any `gh` user/org with a hyphen — less common than hyphenated repos but
  exists; similar risk for `next-auth`-style repo names if owner were hyphenated
- Internally, WolffM-owned repos like `hadoku-task` / `hadoku-scraper` work
  only because the owner (`WolffM`) has no hyphen — fragile invariant.

**Proposed fixes (pick one)**:

1. **Query param** — move the issue number out of the path:

   ```
   GET /recon/{slug}/issue-brief?n=14522
   ```

   Simplest; no ambiguity possible.

2. **URL-encoded slug inside the ID**:

   ```
   GET /recon/{slug}/issue-brief/github-{owner%2Frepo}-{n}
   # becomes github-oven-sh%2Fbun-14522
   ```

   Matches the slash-delimited internal form; preserves the `github-{id}-{n}`
   envelope convention.

3. **Different separator** — reserve `--` as the slug/number delimiter:
   ```
   github-oven-sh-bun--14522
   ```
   Backward-compat friendly if you want to keep the same rough shape, but
   still brittle if a repo name contains `--` (rare).

Option 1 is safest. Option 2 is most backward-compatible with existing
consumers.

---

### A2 — `ai_policy` returns `"unknown"` on every repo

**Repro**:

```bash
for slug in jestjs-jest microsoft-TypeScript sharkdp-bat supabase-supabase huggingface-transformers; do
  curl -sS "https://hadoku.me/oss/api/recon/${slug}/contributing" \
    | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(f'{\"$slug\":<30} ai_policy={d[\"ai_policy\"]} dco={d[\"dco_required\"]} license={d[\"license_check_required\"]}')"
done
```

**Output** (audit-time):

```
jestjs-jest                    ai_policy=unknown dco=False license=False
microsoft-TypeScript           ai_policy=unknown dco=False license=False
sharkdp-bat                    ai_policy=unknown dco=False license=False
supabase-supabase              ai_policy=unknown dco=False license=False
huggingface-transformers       ai_policy=unknown dco=False license=False
```

**Expected**: some of these repos DO have relevant clauses. microsoft/TypeScript
CONTRIBUTING.md literally contains `<!-- CODING AGENTS: READ AGENTS.md BEFORE WRITING CODE -->`.
Other repos in the broader catalog have explicit AI disclosure requirements.

**Impact on vibedispatch**: Phase 4 opens PRs against external upstreams.
If we dispatch to a repo that prohibits AI-generated code without disclosure,
maintainers will close the PR, damage WolffM's reputation, and potentially
ban the account. The `ai_policy` field is the intended guardrail — and it's
always `unknown`, so the guardrail never fires.

**Proposed fix**:

Regex scan of (CONTRIBUTING.md OR AGENTS.md OR PR template) looking for
phrases in these buckets:

| Bucket              | Triggering phrases                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `prohibited`        | "no AI", "no LLM", "no Copilot", "no ChatGPT", "AI-generated code is prohibited", "will close AI PRs", "no auto-generated" |
| `disclose_required` | "must disclose", "must declare", "mention that you used", "flag AI-assisted", "label AI PRs", "disclose the use"           |
| `allowed`           | "AI-assisted contributions welcome", "LLM-assisted allowed", "you may use Copilot"                                         |
| `unknown`           | fallback                                                                                                                   |

Match case-insensitively, whole-word boundaries, any of the phrases. Return
`{ai_policy, matched_phrase, matched_in}` so consumers can show evidence.

This is a single regex pass over text you already fetch — cheap.

---

### A3 — `killed: false` on wound-down repos

**Repro**:

```bash
curl -sS https://hadoku.me/oss/api/recon/microsoft-TypeScript/health | python3 -m json.tool
```

Returns `killed: false, killReason: null, overallViability: 84`.

But the CONTRIBUTING.md for microsoft/TypeScript says (verbatim):

> 🚨 **Important** 🚨: All code changes should be submitted to the
> https://github.com/microsoft/typescript-go repo. Development in this
> codebase [is winding down](...) and PRs will only be merged if they fix
> **critical** 6.0 issues (at minimum, any bug that existed in 5.9 is not critical)

This is an explicit instruction: _don't submit here, submit to the other repo_.
If we dispatch, the PR gets closed without review.

**Proposed fix**: extend kill-detection with phrase-level pattern matching:

| Pattern                                                                        | Kill reason             |
| ------------------------------------------------------------------------------ | ----------------------- |
| `winding down`, `maintenance mode`, `no longer accepting contributions`        | `maintenance_mode`      |
| `archived`, `frozen for X release`                                             | `archived`              |
| `submit to {other_repo}`, `use {other_repo} instead`, `this repo has moved to` | `migrated:{other_repo}` |
| `PRs will only be merged if they {narrow-scope-condition}`                     | `restricted_scope`      |

If a pattern matches, set `killed: true` OR add a `detectedQuirks` entry
with `impact: blocking`. Either is fine for consumers; `killed` is simpler.

---

### A4 — `AGENTS.md` never fetched

MS TypeScript's CONTRIBUTING.md contains an explicit pointer:

```html
<!-- CODING AGENTS: READ AGENTS.md BEFORE WRITING CODE -->
```

There's an emerging convention of publishing an `AGENTS.md` specifically
for LLM/coding-agent contributors with directives like "run X before
submitting", "never touch files in Y/", "our PR review bot rejects
Z-shaped diffs".

The aggregator currently fetches:

- `CONTRIBUTING.md`
- PR template
- CODEOWNERS (planned per Q3 in vibedispatch open-questions)
- issue templates

but not `AGENTS.md`.

**Proposed fix**: add `GET /recon/{slug}/agents-md`:

```json
{
  "success": true,
  "data": {
    "exists": true,
    "path": "AGENTS.md",
    "raw_text": "...",
    "directives": [
      { "kind": "must_run", "text": "pnpm test before submitting" },
      { "kind": "must_not_touch", "text": "files in src/compiler/transformers/" }
    ]
  }
}
```

Parsing directives is optional (raw_text is enough for v1). Just fetching
and exposing it gets us 80% of the value.

---

## Moderate

### M1 — `likelyFiles` coverage inconsistent

**Repro**:

```bash
for entry in jestjs/jest:2070 eslint/eslint:19118 TanStack/query:2712 sharkdp/bat:3029; do
  slug="${entry%:*}"; num="${entry#*:}"; hslug="${slug//\//-}"
  curl -sS "https://hadoku.me/oss/api/recon/${hslug}/issue-brief/github-${hslug}-${num}" \
    | python3 -c "import sys,json; lf=json.load(sys.stdin)['data']['issue'].get('likelyFiles') or []; print(f'${slug}#${num}: {len(lf)} files: {lf[:3]}')"
done
```

**Output** (audit-time):

```
jestjs/jest#2070: 2 files: ['src/app/modules/module1/__mocks__/index.js', 'src/app/modules/module2/__mocks__/index.js']
eslint/eslint#19118: 0 files: []
TanStack/query#2712: 0 files: []
sharkdp/bat#3029: 0 files: []
```

Jest produced 2 useful files because the issue body contained a literal
file-tree code block. The other three had rich issue bodies but 0 files
extracted.

**Impact**: `likelyFiles` is a huge signal for agent scoping — if we tell
Copilot "here are the 3 files most likely to change", the blast radius
of the diff shrinks dramatically and `relevance` judge scores improve.
Currently only a minority of issues benefit.

**Proposed fix — widen the heuristic**:

| Current source (guess)    | Proposed additional sources                                         |
| ------------------------- | ------------------------------------------------------------------- |
| Code blocks in issue body | File paths in stack traces (`  at foo (src/bar.ts:12)`)             |
|                           | File paths mentioned in comments by maintainers                     |
|                           | `lastComment.body` regex for `<path>/<to>.<ext>`                    |
|                           | File paths in `linked_pr_urls` targets (for closed-but-related PRs) |

A file is a "likely file" if it appears in at least one of these sources
and exists in the repo's current default branch. Validating against the
branch avoids hallucinated paths.

---

### M2 — Rich signals computed but undocumented for consumers

The `issue-brief.issue` payload includes:

- `likelyFiles`
- `detectedQuirks` (nested in repoHealth)
- `commentDigest`
- `sentimentScore` / `sentimentSignals`
- `relatedIssues`
- `competitionLevel`
- `contentQualityScore`
- `dataCompleteness`

These aren't documented in PROJECT-DESIGN.md or AGGREGATOR-REQUIREMENTS.md.
Consumers (vibedispatch) don't know what the fields mean, how reliable
they are, or when to trust them.

**Proposed fix**: add a field reference section to AGGREGATOR-REQUIREMENTS.md
listing every field in each payload with:

- Short description
- How it's computed (1-line)
- Reliability caveats (e.g., "populated only when issue body contains file paths")
- Recommended consumer behavior when empty/unknown

Nothing API-breaking. Just publishes the contract.

---

## Minor / cleanup

### m1 — Embedded issue URL inside brief text

The `brief` field in `issue-brief` starts with:

```
# Task: [bug] duplicate manual mock found in separate directories

Issue: https://github.com/jestjs/jest/issues/2070
Repo: jestjs/jest | Complexity: low
...
```

The `https://github.com/jestjs/jest/issues/2070` and `Repo: jestjs/jest`
are raw upstream refs embedded in text. Vibedispatch's scrubber strips
them successfully, but it's safer if these were separate JSON fields
(`issue_url`, `repo_slug`) so consumers can include/omit deliberately
instead of regex-scrubbing.

**Proposed fix**: keep the brief text free of raw URLs/slugs; let consumers
compose them from structured fields when needed.

### m2 — `repoHealth` duplicated inside `issue-brief`

The issue-brief response returns the full `repoHealth` object inline. But
vibedispatch also calls `/recon/{slug}/health` separately. Minor extra
bandwidth + encourages consumers to double-fetch.

**Proposed fix**: either drop `repoHealth` from `issue-brief` (consumers
call `/health` explicitly), or keep it and document that `/health` is
redundant when you already have `issue-brief`.

---

## What's working well (acknowledgements)

Not everything is a complaint — want to call out what we're actively
benefiting from:

1. **Envelope consistency**. Every endpoint returns
   `{success, data, _meta: {scraped_at, computed_at, served_at}}`. Makes
   freshness tracking trivial.
2. **`dossier.sections` structure** — `overview`, `contributionRules`,
   `prPatterns` are ready-to-render.
3. **`health.prPatterns` signal quality** — `externalContributorMergeRate`,
   `medianTimeToMergeDays`, `medianFilesChanged` are all accurate on the
   samples we checked.
4. **`pr-template.sections`** — parsed into `{heading, required, placeholder}`
   lets the downstream renderer fill in sections mechanically.
5. **Brief embeds CRITICAL RULES for the agent** — lines like _"DO NOT use
   GitHub MCP tools to look up issues on other repositories"_ and _"DO NOT
   add Closes, Fixes, or Resolves directives"_ appear in the brief before
   the agent reads it. Effectively, the aggregator is doing part of our
   stealth work for us.

---

## Action matrix

| #             | Owner        | Change                                                        | Status                    |
| ------------- | ------------ | ------------------------------------------------------------- | ------------------------- |
| A1            | aggregator   | Fix issue-brief slug hyphen collision                         | Open — blocks oven-sh/bun |
| A2            | aggregator   | Populate `ai_policy` via phrase scan                          | Open — Phase 4 safety     |
| A3            | aggregator   | Detect wound-down repos → `killed: true`                      | Open — blocks TypeScript  |
| A4            | aggregator   | Serve `AGENTS.md` at `/recon/{slug}/agents-md`                | Open                      |
| M1            | aggregator   | Widen `likelyFiles` heuristic                                 | Open                      |
| M2            | aggregator   | Document field semantics in requirements doc                  | Open                      |
| m1            | aggregator   | Keep brief text free of raw URLs/slugs                        | Open                      |
| m2            | aggregator   | Decide whether `repoHealth` stays in issue-brief              | Open                      |
| consumer-side | vibedispatch | Start using `likelyFiles` + `detectedQuirks` in agent context | Open                      |

Happy to collaborate on rollout — A1/A2/A3 are the three we most want
before the Phase 4 dispatch.

---

**Filed against**: endpoints `/recon/{slug}/dossier`, `/recon/{slug}/health`,
`/recon/{slug}/issue-brief/{id}`, `/recon/{slug}/contributing`,
`/recon/{slug}/pr-template`, and the full scored-issues catalog.

**Probed from**: vibedispatch main branch at 2026-04-18T23:30 UTC.
