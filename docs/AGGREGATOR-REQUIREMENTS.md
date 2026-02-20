# hadoku-aggregator — OSS Recon Requirements

> Read PROJECT-DESIGN.md first for full context, shared contracts, and milestone plan.

## Role in the Pipeline

hadoku-aggregator is the **intelligence + API layer**. It reads raw scraped data from Cloudflare KV, runs analysis (CVS scoring, repo health, lifecycle classification, comment sentiment), compiles dossiers, and serves results via Hono API endpoints. vibedispatch consumes these endpoints to power its UI and orchestration.

**Analogy:** The aggregator is like the .yml workflow definition in vibecheck — it defines what the pipeline does and how results are interpreted. But instead of a GitHub Actions workflow, it's a Cloudflare Worker that reads data from KV and serves scored results.

## What Already Exists

- `api/adapters/` — 6 platform-specific API fetchers (GitHub, GitLab, Gitea, Phabricator, Bugzilla, Trac)
- `api/data-sources/` — `IssueDataProvider` interface with `LiveApiProvider` implementation
- `api/scoring.ts` — Difficulty heuristic engine (label + keyword matching)
- `api/handler.ts` — Hono OpenAPI handler with `/health`, `/projects`, `/issues/{slug}`, issue marking endpoints
- `api/types.ts` — `Issue`, `ProjectConfig`, `CachedIssues`, `MarkedIssue` types
- `api/config.ts` — 20 projects across 6 platforms with pool categorization
- `src/` — React frontend (project selector, difficulty badges, themes)
- `SCRAPER_INTEGRATION.md` — Full contract for scraper → KV → aggregator flow
- KV caching infrastructure (`CACHE_KV` binding)
- `createOSSFetcher()` programmatic API access

## What to Build

### New Module: `api/recon/`

Create a new module alongside existing `api/` code for the recon pipeline. The existing issue aggregation (`/oss/api/issues/*`) continues unchanged.

### File Structure

```
api/recon/
├── index.ts              # Hono route registration for /oss/api/recon/*
├── kv-reader.ts          # Reads recon:{slug}:* keys from KV
├── watchlist.ts          # Watchlist CRUD (reads/writes recon:watchlist KV key)
├── claims.ts             # Claim tracking (reads/writes recon:{slug}:claims KV key)
├── health-scorer.ts      # Repo health scoring engine
├── issue-scorer.ts       # CVS scoring engine (extends existing scoring.ts)
├── lifecycle.ts          # Issue lifecycle classifier (fresh/triaged/accepted/stale/zombie)
├── sentiment.ts          # Comment sentiment analysis (pattern matching)
├── quirks.ts             # Repo quirk detector (changesets, CLA, conventional commits)
├── dossier-compiler.ts   # Markdown dossier generation
├── types.ts              # RepoHealth, ScoredIssue, Dossier, PRPatterns, ClaimRecord, etc.
└── triggers.ts           # Calls scraper API to trigger re-scrapes
```

---

## Milestone 1: KV Reader + API Stubs

**Duration:** 2-3 days
**Dependencies:** None — can start with manually seeded KV data or test fixtures
**Parallel with:** Scraper M1 (extended issue fetching), vibedispatch M1 (fork/assign/review flow)

### What to Build

1. **`recon/types.ts`** — TypeScript types matching the contracts in PROJECT-DESIGN.md §4:
   - `ExtendedIssue`, `PRSample`, `RepoMeta`, `IssueComments`, `Comment`
   - `ReconIssueData` (KV envelope for issues — Zod schema needed for kv-reader to unwrap)
   - `ScoredIssue`, `RepoHealth`, `RepoQuirk`, `PRPatterns`, `Dossier`
   - Use Zod schemas (same pattern as existing `api/schemas.ts`) for runtime validation

2. **`recon/kv-reader.ts`** — KV access layer
   - Read from `recon:{slug}:*` keys
   - Parse and validate against Zod schemas
   - Handle missing/stale data gracefully (return null, not throw)
   - Same KV binding as existing `CACHE_KV`
   - **Envelope handling:** `recon:{slug}:issues` KV value is wrapped in a `ReconIssueData` envelope with `scrapedAt`, `source`, `dataTypes` fields. The reader unwraps it and returns the `issues` array. Expose `scrapedAt` via a separate `getReconIssuesScrapedAt()` function for freshness checks.

   ```typescript
   export async function getReconIssues(
     kv: KVNamespace,
     slug: string
   ): Promise<ExtendedIssue[] | null>
   export async function getReconIssuesScrapedAt(
     kv: KVNamespace,
     slug: string
   ): Promise<string | null>
   export async function getMergedPRs(kv: KVNamespace, slug: string): Promise<PRSample[] | null>
   export async function getRejectedPRs(kv: KVNamespace, slug: string): Promise<PRSample[] | null>
   export async function getRepoMeta(kv: KVNamespace, slug: string): Promise<RepoMeta | null>
   export async function getComments(kv: KVNamespace, slug: string): Promise<IssueComments | null>
   export async function getRepoHealth(kv: KVNamespace, slug: string): Promise<RepoHealth | null>
   export async function getScoredIssues(
     kv: KVNamespace,
     slug: string
   ): Promise<ScoredIssue[] | null>
   export async function getClaims(kv: KVNamespace, slug: string): Promise<ClaimRecord[] | null>
   ```

3. **`recon/claims.ts`** — Claim tracking
   - Read/write `recon:{slug}:claims` KV key (array of `ClaimRecord`)
   - `addClaim(kv, slug, { issueId, claimedBy, forkIssueUrl })` → appends to array, deduplicates by issueId
   - `removeClaim(kv, slug, issueId)` → removes from array
   - Issue scorer reads claims to set `claimStatus` and `claimAuthor` on `ScoredIssue`

4. **`recon/watchlist.ts`** — Watchlist management
   - Read/write `recon:watchlist` KV key (array of slug strings)
   - Add/remove slugs
   - **Canonical slug format:** Validate and normalize to `{owner}-{repo}` (hyphenated). Reject slugs containing `/` — convert to hyphenated on input.

5. **`recon/index.ts`** — Hono routes (stubs that return raw KV data)

   ```typescript
   // Watchlist
   GET  /oss/api/recon/watchlist              → { slugs: string[] }
   POST /oss/api/recon/watchlist/add          → { slug: string } → { success: true }
   POST /oss/api/recon/watchlist/remove       → { slug: string } → { success: true }

   // Per-repo endpoints (stubs — return raw KV data, scoring added in M2)
   GET  /oss/api/recon/:slug/health           → RepoHealth | { status: "pending" }
   GET  /oss/api/recon/:slug/issues           → ExtendedIssue[]
   GET  /oss/api/recon/:slug/scored-issues    → ScoredIssue[] (stub: return issues with placeholder scores)
   GET  /oss/api/recon/:slug/dossier          → Dossier | { status: "pending" }

   // Aggregate (excludes killed repos by default)
   GET  /oss/api/recon/all-scored-issues      → ScoredIssue[] (across all watchlist repos)
   GET  /oss/api/recon/all-scored-issues?includeKilled=true  → includes killed repos

   // Trigger
   POST /oss/api/recon/:slug/refresh          → { status: "triggered" }

   // Claims (vibedispatch reports claims here — see PROJECT-DESIGN.md §4.8)
   POST /oss/api/recon/:slug/claim            → { issueId: string, claimedBy: string, forkIssueUrl?: string }
   POST /oss/api/recon/:slug/unclaim          → { issueId: string }
   ```

   Note: vibedispatch calls these endpoints using `AGGREGATOR_API_URL` (e.g., `https://hadoku.me/oss/api`)
   as the base URL and appends `/recon/...` paths. The `/oss/api` prefix is part of the Hono route
   registration — vibedispatch strips it from the endpoint path definition to avoid doubling.

6. **`recon/triggers.ts`** — Call scraper API to trigger re-scrapes
   - `POST {SCRAPER_API_URL}/api/v1/oss-recon/scrape` with slug and optional data_types
   - Fire-and-forget (don't wait for scraper to complete)
   - Config: `SCRAPER_API_URL` env var bound to worker

7. **Wire routes into `api/handler.ts`**
   - Import recon routes and mount under `/oss/api/recon/*`
   - Add to OpenAPI spec

### Validation

- [ ] `GET /oss/api/recon/watchlist` returns slug list from KV
- [ ] `POST /oss/api/recon/watchlist/add` adds a slug to KV
- [ ] `POST /oss/api/recon/watchlist/add` normalizes `owner/repo` to `owner-repo` (hyphenated)
- [ ] `POST /oss/api/recon/watchlist/add` rejects invalid slug formats
- [ ] `GET /oss/api/recon/{slug}/issues` returns ExtendedIssue[] from KV
- [ ] `GET /oss/api/recon/{slug}/scored-issues` returns issues (with placeholder CVS for now)
- [ ] `POST /oss/api/recon/{slug}/refresh` calls scraper API
- [ ] `POST /oss/api/recon/{slug}/claim` writes claim to KV, returns success
- [ ] `POST /oss/api/recon/{slug}/unclaim` removes claim from KV
- [ ] Duplicate claims for same issueId are deduplicated (idempotent)
- [ ] All endpoints return `null` / `{ status: "pending" }` for slugs with no data (not 500)
- [ ] Routes appear in OpenAPI spec

---

## Milestone 2: Analysis Engine

**Duration:** 4-5 days
**Dependencies:** Scraper M1 data in KV (extended issues). Can start with test fixtures.
**Parallel with:** vibedispatch M2 (Stage 1-2 UI, can mock aggregator responses)

### What to Build

1. **`recon/health-scorer.ts`** — Repo health scoring

   Reads `recon:{slug}:repo-meta`, `recon:{slug}:merged-prs`, `recon:{slug}:rejected-prs`.

   Computes:
   - **Maintainer Health Score (0-100):** Based on PR review patterns, response times derived from PR timestamps, external contributor merge rate
   - **Merge Accessibility Score (0-100):** Based on merge rate of external PRs, review rounds (estimated from merged PR → created_at vs merged_at gap), merge style detection
   - **Availability Score (0-100, higher = more open for contributors):** Based on inverse of (open PR count / issue count ratio), uniqueness of recent PR authors, CI failure rate of external PRs
   - **Overall Viability (0-100):** Weighted composite

   **Vibe-coder saturation detection (M4 — aggregator-side):** Per-repo pattern matching was
   deferred from scraper M3 due to high false positive rates (conventional commits match "fix: X",
   PR templates match "This PR addresses"). The aggregator will handle this in M4 using cross-repo
   signals that aren't available to the per-repo scraper:
   - Same author opening >5 PRs across different watchlist repos in 24h
   - > 50% CI failure rate on external PRs for a given repo (high noise indicator)
   - Unusually high ratio of closed-without-merge PRs from external contributors
     For M2, `availabilityScore` uses only PR count ratios and author uniqueness — no vibe-coder signals.

   Kill signals (auto-disqualify the entire repo):
   - `isArchived: true`
   - No merged PR in last 90 days
   - No external contributor PR merged in last 90 days

   **Kill signal propagation:** When a repo is killed, `scoreRepoHealth` returns
   `overallViability: 0` and `killed: true`. The issue scorer then sets ALL issues for
   that repo to `cvs: 0, cvsTier: 'skip', repoKilled: true`. The `all-scored-issues`
   endpoint excludes killed repos by default.

   ```typescript
   export function scoreRepoHealth(
     meta: RepoMeta,
     mergedPRs: PRSample[],
     rejectedPRs: PRSample[]
   ): RepoHealth // includes killed: boolean
   ```

2. **`recon/issue-scorer.ts`** — CVS scoring engine

   Reads `recon:{slug}:issues`, `recon:{slug}:comments`, `recon:{slug}:health`, `recon:{slug}:claims`.

   Extends existing `scoring.ts` difficulty scoring with:
   - **Freshness score:** Issue age → points (newer = better)
   - **Activity score:** Comment patterns, reactions, assignee status
   - **Claim detection:** Check `recon:{slug}:claims` KV for our own claims, check assignees and "I'll work on this" comments for external claims, stale claims (>14 days)
   - **Author context:** Use `authorAssociation` to detect maintainer-filed issues (if a MEMBER files and self-assigns, external contributors should not compete)
   - **Content quality:** bodyPreview analysis (has reproduction steps? has code references?)
   - **Competition level:** Linked PRs, recent comments from non-maintainers
   - **Timing score:** Freshness relative to repo's typical response time

   Composite CVS:

   ```
   cvs = repo_score * 0.30 + issue_score * 0.50 + timing_score * 0.20
   ```

   **Partial data handling:** If `RepoHealth` is null (scraper hasn't completed M2 yet),
   use `repo_score = 50` (neutral) and set `dataCompleteness: 'partial'` on the ScoredIssue.
   If the repo is killed, short-circuit: all issues get `cvs: 0, cvsTier: 'skip', repoKilled: true`.

   CVS tiers:
   - 85-100: **go** — strong signal, act immediately
   - 70-84: **likely** — good candidate, worth pursuing
   - 50-69: **maybe** — proceed with caution
   - 30-49: **risky** — significant concerns
   - 0-29: **skip** — don't bother

   ```typescript
   export function scoreIssues(
     issues: ExtendedIssue[],
     comments: IssueComments,
     health: RepoHealth | null, // null = partial data, use neutral repo_score
     claims: ClaimRecord[]
   ): ScoredIssue[]
   ```

3. **`recon/lifecycle.ts`** — Issue lifecycle classifier

   Uses issue metadata + comments to classify. Note: lifecycle describes _maintainer engagement_,
   not _contribution readiness_. A `triaged` issue may still have negative sentiment (e.g., "needs RFC").
   The CVS scorer uses lifecycle AND sentiment together — a triaged issue with negative sentiment
   will still score low.
   - **fresh:** Created < 7 days ago, no maintainer response
   - **triaged:** Has maintainer comment or label assignment (maintainer is aware, NOT necessarily ready for PRs)
   - **accepted:** Maintainer explicitly confirmed ("PR welcome", "good first issue" added after creation, milestone assigned)
   - **stale:** No activity > 60 days
   - **zombie:** No activity > 180 days

   ```typescript
   export function classifyLifecycle(
     issue: ExtendedIssue,
     comments: CommentThread | undefined
   ): LifecycleStage
   ```

4. **`recon/sentiment.ts`** — Comment sentiment analysis

   Pattern matching on comment text (not ML — simple and fast):

   **Positive signals (+1 each):**
   - "PR welcome", "would accept a PR", "contributions welcome"
   - "good idea", "makes sense", "agreed"
   - Maintainer added "help wanted" or "good first issue" label

   **Negative signals (-1 each):**
   - "won't fix", "by design", "not planned"
   - "working on this", "I'll take this" (from non-maintainer = claimed)
   - "please open an issue first", "need RFC"
   - "closing as stale", "duplicate of"

   **Neutral (0):**
   - Bot comments (Dependabot, CodeRabbit, etc.)
   - Pure questions without maintainer response

   Output: sentiment score (-1 to 1, average of signals)

   ```typescript
   export function analyzeSentiment(comments: CommentThread): { score: number; signals: string[] }
   ```

5. **Wire scoring into API endpoints**
   - `GET /oss/api/recon/{slug}/health` → now returns computed `RepoHealth`
   - `GET /oss/api/recon/{slug}/scored-issues` → now returns `ScoredIssue[]` with CVS
   - `GET /oss/api/recon/all-scored-issues` → aggregated across watchlist, sorted by CVS desc
   - Scoring runs on-request (CF Worker compute) reading from KV
   - Consider caching scored results in `recon:{slug}:scored-issues` KV key with TTL

### Validation

- [ ] `GET /oss/api/recon/{slug}/health` returns computed scores (not just raw meta)
- [ ] Health score meaningfully differentiates active vs abandoned repos
- [ ] `GET /oss/api/recon/{slug}/scored-issues` returns issues sorted by CVS
- [ ] CVS > 70 issues are genuinely viable (spot-check 10 issues across 3 repos)
- [ ] CVS < 30 issues have clear disqualifying factors (claimed, stale, zombie)
- [ ] Issues with active claims in `recon:{slug}:claims` show `claimStatus: 'claimed'` in scored output
- [ ] `authorAssociation` on issues correctly influences competition scoring (MEMBER self-assign = skip)
- [ ] Lifecycle classification is correct for sample issues (manual verification)
- [ ] Sentiment score identifies "PR welcome" vs "won't fix" correctly
- [ ] Kill signals correctly disqualify archived/abandoned repos
- [ ] Killed repos: all issues get `cvs: 0, cvsTier: 'skip', repoKilled: true`
- [ ] `all-scored-issues` excludes killed repos by default, includes with `?includeKilled=true`
- [ ] Partial data: repos without health data get `repo_score = 50` (neutral) and `dataCompleteness: 'partial'`
- [ ] COLLABORATOR authorAssociation correctly classified as internal (not external) for merge rate

---

## Milestone 3: Dossier Compilation + Quirk Detection

**Duration:** 4-5 days
**Dependencies:** M2 analysis engine complete
**Parallel with:** vibedispatch M3 (dossier viewer, outcome tracking)

### What to Build

1. **`recon/quirks.ts`** — Repo quirk detector

   Reads `recon:{slug}:repo-meta` (CONTRIBUTING.md content, PR template), `recon:{slug}:merged-prs`, `recon:{slug}:rejected-prs` (PR comments for bot detection in M3 scraper data).

   Detection rules:
   | Quirk | Detection | Impact |
   |---|---|---|
   | Changeset required | `contributingContent` contains "changeset" OR `.changeset/` in merged PR file lists | blocker |
   | Conventional commits | `contributingContent` contains "conventional commit" OR "commitlint" | important |
   | CLA/DCO required | PR comments contain "CLA" or "signed-off-by" patterns | blocker |
   | Specific branch target | `contributingContent` mentions "develop" or "dev" branch, or merged PRs target non-default branch | important |
   | Issue linking required | PR template contains "Fixes #" or "Related issue" | important |
   | RFC/discussion first | `contributingContent` says "open an issue first" | important |

   ```typescript
   export function detectQuirks(
     meta: RepoMeta,
     mergedPRs: PRSample[],
     rejectedPRs: PRSample[]
   ): RepoQuirk[]
   ```

2. **`recon/dossier-compiler.ts`** — Markdown dossier generation

   Reads all `recon:{slug}:*` data + computed health/scores.

   Generates 6 sections:

   **Overview:** Repo name, stars, language, health score summary, viability verdict, detected quirks as warnings.

   **Contribution Rules:** Parsed CONTRIBUTING.md highlights, PR template requirements, detected quirks with evidence, default branch, required labels.

   **Success Patterns:** Based on merged PRs — median size, typical branch naming, merge style, review cycle time, which file areas get merged easily.

   **Anti-Patterns:** Based on rejected PRs — common rejection reasons (estimated from PR title/label patterns), too-large PRs, wrong branch, missing tests.

   **Issue Board:** Top 10 scored issues with CVS, tier, lifecycle stage, claim status. Formatted as a ranked markdown table. Note: this is for human reading in the dossier panel. For programmatic access to issue data (filtering, sorting, clicking), use the `/recon/{slug}/scored-issues` endpoint directly.

   **Environment Setup:** Language, build system (inferred from repo meta), CI tools, test framework (inferred from file patterns), link to CONTRIBUTING.md.

   ```typescript
   export function compileDossier(
     slug: string,
     meta: RepoMeta,
     health: RepoHealth,
     scoredIssues: ScoredIssue[],
     mergedPRs: PRSample[],
     rejectedPRs: PRSample[]
   ): Dossier
   ```

3. **Wire into API**
   - `GET /oss/api/recon/{slug}/dossier` → returns compiled `Dossier`
   - Include quirks in `GET /oss/api/recon/{slug}/health` response
   - Cache dossier in KV (regenerate on scraper webhook notification)

4. **PR Patterns analysis**
   - Compute `PRPatterns` from merged PRs:
     - Median files changed, additions, deletions
     - Merge style (squash if all merge commits have "squash", etc.)
     - Commit convention (detect `feat:`, `fix:` patterns in branch/commit names)
     - Time to merge (created → merged gap)
     - External contributor merge rate

### Validation

- [ ] Quirk detection identifies changesets on a repo known to require them (e.g., Turborepo)
- [ ] Dossier for fastify includes meaningful contribution rules from CONTRIBUTING.md
- [ ] Success patterns section reflects actual merged PR characteristics
- [ ] Anti-patterns section identifies common rejection reasons
- [ ] Issue board shows top 10 issues with accurate CVS
- [ ] Dossier markdown renders cleanly when viewed as markdown
- [ ] `GET /oss/api/recon/{slug}/dossier` returns complete dossier

---

## Implementation Notes

### CF Worker Constraints

- No filesystem access — all data through KV
- 128MB memory limit — keep scoring lightweight
- 30s CPU time limit on free plan — ensure analysis completes within budget
- Consider using KV `cacheTtl` for frequently accessed keys

**M3 CPU budget concern:** Dossier compilation reads all KV keys for a repo, runs sentiment
analysis on comments, and generates 6 markdown sections. For repos with 100+ issues and
thousands of comments, this could approach the 30s limit. Mitigations:

1. **Pre-compute on write:** When the scraper triggers a webhook after writing new data,
   the aggregator runs dossier compilation async (via Worker Queue or scheduled handler)
   and writes the result to `recon:{slug}:dossier` KV. The GET endpoint just reads the cached dossier.
2. **Incremental updates:** Only recompute sections whose source data changed (e.g., if
   only issues changed, regenerate Issue Board but keep Success Patterns from last run).
3. **Worker Queue fallback:** If compilation exceeds budget on-request, return
   `{ status: "compiling" }` and schedule compilation in a Worker Queue.

### Testing

- Use Miniflare for local development (KV simulation)
- Seed test KV data from JSON fixtures
- Unit test scoring functions with known inputs/outputs
- Integration test: seed KV → call API → verify response shape and score ranges

### Performance

- Scoring all issues for a repo should complete in < 5 seconds
- Dossier compilation should complete in < 10 seconds
- For `all-scored-issues` across 20 repos, consider pagination or limit to top 50

### Existing Code Reuse

- `scoring.ts` difficulty scoring → import into `issue-scorer.ts` as one input dimension
- `types.ts` `Issue` interface → `ExtendedIssue` extends it
- `schemas.ts` Zod patterns → same validation approach for recon types
- `handler.ts` Hono route pattern → same for recon routes
- `config.ts` project list → seed initial watchlist from existing 20 projects
