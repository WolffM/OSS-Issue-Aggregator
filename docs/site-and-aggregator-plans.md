# hadoku-aggregator — Schema Migration & Platform Expansion Plan

## Current State

The aggregator is a Cloudflare Worker (Hono/OpenAPI) that:

- Reads `cached:{slug}` KV keys written by the old `ossissues` scraper module
- Has its own 6 platform adapters (GitHub, GitLab, Gitea, Phabricator, Bugzilla, Trac) as a live fallback
- Serves `/oss/api/issues/{slug}`, `/oss/api/projects`, etc.
- Has a planned `api/recon/` module (from AGGREGATOR-REQUIREMENTS.md) with kv-reader, scorers, dossier compiler

The planned recon module expects to read from **5 separate KV keys** per repo:

```
recon:{slug}:issues
recon:{slug}:merged-prs
recon:{slug}:rejected-prs
recon:{slug}:repo-meta
recon:{slug}:comments
```

## What Changes

### 1. Consolidated KV Schema (Breaking Change from Design Docs)

Per the scraper expansion plan, we're consolidating all 5 keys into **one key per repo** to stay within KV free tier write limits.

**New KV layout:**

```
recon:{slug}    → ConsolidatedReconData   (one write per repo per cycle)
```

**Schema:**

```typescript
interface ConsolidatedReconData {
  scrapedAt: string // ISO 8601
  source: string // "github" | "gitlab" | "gitea" | etc.
  platform: Platform // platform enum

  // All data packed into one value
  issues: ExtendedIssue[]
  mergedPrs: PRSample[]
  rejectedPrs: PRSample[]
  repoMeta: RepoMeta
  comments: IssueComments // keyed by issue number

  // Scrape metadata
  dataTypes: string[] // which sections were populated
  errors?: Record<string, string> // per-section errors (e.g. "comments": "rate limited")
}
```

The aggregator still writes its **analysis results** to separate keys (these are infrequent, aggregator-computed, not per-cycle):

```
recon:{slug}:health          → RepoHealth       (written after analysis)
recon:{slug}:scored-issues   → ScoredIssue[]    (written after scoring)
recon:{slug}:dossier         → Dossier          (written after compilation)
recon:{slug}:claims          → ClaimRecord[]    (written on claim/unclaim)
recon:watchlist              → string[]
```

This is fine because aggregator writes are event-driven (triggered by API calls or analysis runs), not periodic bulk writes. Maybe 10-20 writes/day for analysis updates across all repos.

### 2. OpenAPI Schema Import from Scraper

Instead of duplicating Pydantic models as Zod schemas, the aggregator should fetch the scraper's OpenAPI spec and derive types from it.

**Approach: Build-time code generation**

```bash
# In aggregator's package.json scripts:
"generate:types": "curl -s $SCRAPER_API_URL/openapi.json | npx openapi-typescript - -o src/generated/scraper-types.ts"
```

This uses `openapi-typescript` to generate TypeScript interfaces from the scraper's OpenAPI spec. Run it as a build step or pre-commit hook.

**Benefits:**

- Single source of truth: scraper's Pydantic models → OpenAPI spec → aggregator's TypeScript types
- No manual schema drift between repos
- Types update automatically when scraper schema changes

**Implementation:**

```typescript
// api/recon/types.ts — thin wrapper around generated types
import type {
  ConsolidatedReconData,
  ExtendedIssue,
  PRSample,
  RepoMeta,
  IssueComments
} from '../../generated/scraper-types'

// Re-export for convenience
export type { ConsolidatedReconData, ExtendedIssue, PRSample, RepoMeta, IssueComments }

// Aggregator-only types (not from scraper)
export interface ScoredIssue extends ExtendedIssue {
  cvs: number
  cvsTier: 'go' | 'likely' | 'maybe' | 'risky' | 'skip'
  lifecycleStage: 'fresh' | 'triaged' | 'accepted' | 'stale' | 'zombie'
  claimStatus: 'unclaimed' | 'claimed' | 'stale-claim'
  claimAuthor?: string
  repoKilled?: boolean
}

export interface RepoHealth {
  slug: string
  platform: Platform
  maintainerHealthScore: number
  mergeAccessibilityScore: number
  availabilityScore: number
  overallViability: number
  killed: boolean
  killReason?: string
  detectedQuirks: RepoQuirk[]
  lastAnalyzedAt: string
}
// ... etc
```

**Zod validation schemas** still needed at the aggregator boundary (for runtime validation when reading from KV), but they can be auto-generated too:

```bash
# Alternative: use openapi-zod-schemas
"generate:schemas": "curl -s $SCRAPER_API_URL/openapi.json | npx openapi-zod-schemas - -o src/generated/scraper-schemas.ts"
```

Or manually write thin Zod wrappers that reference the generated types for shape, which is more maintainable:

```typescript
// api/recon/schemas.ts
import { z } from 'zod'

// Validate just the envelope — trust the scraper for field-level correctness
export const ConsolidatedReconDataSchema = z.object({
  scrapedAt: z.string().datetime(),
  source: z.string(),
  platform: z.string(),
  issues: z.array(z.any()), // trust scraper's validation
  mergedPrs: z.array(z.any()),
  rejectedPrs: z.array(z.any()),
  repoMeta: z.any(),
  comments: z.any(),
  dataTypes: z.array(z.string()),
  errors: z.record(z.string()).optional()
})
```

### 3. KV Reader Migration

**Current planned design (from AGGREGATOR-REQUIREMENTS.md):**

```typescript
// Reads 5 separate keys
export async function getReconIssues(kv: KVNamespace, slug: string): Promise<ExtendedIssue[] | null>
export async function getMergedPRs(kv: KVNamespace, slug: string): Promise<PRSample[] | null>
export async function getRepoMeta(kv: KVNamespace, slug: string): Promise<RepoMeta | null>
// ... etc, each reading a different KV key
```

**New design (consolidated):**

```typescript
// api/recon/kv-reader.ts

// Core: read the single consolidated key, cache in-memory for the request
const reconCache = new Map<string, ConsolidatedReconData | null>()

export async function getReconData(
  kv: KVNamespace,
  slug: string
): Promise<ConsolidatedReconData | null> {
  if (reconCache.has(slug)) return reconCache.get(slug)!

  const raw = await kv.get(`recon:${slug}`, 'json')
  if (!raw) {
    reconCache.set(slug, null)
    return null
  }

  const parsed = ConsolidatedReconDataSchema.safeParse(raw)
  if (!parsed.success) {
    console.error(`Invalid recon data for ${slug}:`, parsed.error)
    reconCache.set(slug, null)
    return null
  }

  reconCache.set(slug, parsed.data)
  return parsed.data
}

// Convenience accessors that unpack from the consolidated blob
export async function getReconIssues(
  kv: KVNamespace,
  slug: string
): Promise<ExtendedIssue[] | null> {
  const data = await getReconData(kv, slug)
  return data?.issues ?? null
}

export async function getMergedPRs(kv: KVNamespace, slug: string): Promise<PRSample[] | null> {
  const data = await getReconData(kv, slug)
  return data?.mergedPrs ?? null
}

export async function getRejectedPRs(kv: KVNamespace, slug: string): Promise<PRSample[] | null> {
  const data = await getReconData(kv, slug)
  return data?.rejectedPrs ?? null
}

export async function getRepoMeta(kv: KVNamespace, slug: string): Promise<RepoMeta | null> {
  const data = await getReconData(kv, slug)
  return data?.repoMeta ?? null
}

export async function getComments(kv: KVNamespace, slug: string): Promise<IssueComments | null> {
  const data = await getReconData(kv, slug)
  return data?.comments ?? null
}

export async function getScrapedAt(kv: KVNamespace, slug: string): Promise<string | null> {
  const data = await getReconData(kv, slug)
  return data?.scrapedAt ?? null
}

// Clear per-request cache (call at start of each request)
export function clearReconCache() {
  reconCache.clear()
}
```

**Key insight:** Since it's a Cloudflare Worker (stateless per-request), the in-memory cache just avoids redundant KV reads within a single request. Multiple accessor calls for the same slug hit KV once.

### 4. Deprecate Old Data Path

The aggregator currently has two data paths:

1. **Live path:** `api/adapters/*.ts` → direct API calls (fallback)
2. **Cached path:** `api/data-sources/cached-provider.ts` → reads `cached:{slug}` from KV

Both need to be migrated to read from `recon:{slug}` instead.

**Migration steps:**

1. Update `CachedProvider` to read from `recon:{slug}` and unpack `.issues` from the consolidated blob
2. Map `ExtendedIssue` → `Issue` for backward compatibility with existing `/oss/api/issues/{slug}` endpoint (existing frontend expects the old schema)
3. Keep `LiveApiProvider` as emergency fallback but log a warning when it's used
4. After confirming recon data flows correctly, remove `api/adapters/` directory entirely

```typescript
// api/data-sources/cached-provider.ts (updated)
import { getReconData } from '../recon/kv-reader'

export class CachedProvider implements IssueDataProvider {
  async fetchIssues(config: ProjectConfig, env: OSSEnv): Promise<Issue[]> {
    const recon = await getReconData(env.CACHE_KV, config.slug)
    if (!recon) {
      // Fallback: try old cached:{slug} key during migration
      const legacy = (await env.CACHE_KV.get(
        `cached:${config.slug}`,
        'json'
      )) as CachedIssues | null
      if (legacy) return legacy.issues
      return []
    }

    // Map ExtendedIssue → Issue for backward compat
    return recon.issues.map(ei => ({
      id: ei.id,
      platform: recon.platform,
      project: ei.project,
      title: ei.title,
      url: ei.url,
      difficulty: ei.difficulty ?? 'unknown',
      difficultyScore: ei.difficultyScore ?? 50,
      difficultySignals: ei.difficultySignals ?? [],
      labels: ei.labels,
      createdAt: ei.createdAt,
      updatedAt: ei.updatedAt,
      author: ei.author
    }))
  }
}
```

### 5. Platform Column in API + Frontend

The existing aggregator API already includes `platform` in the `Issue` schema and `ProjectConfig`. The new concern is that issue URLs now point to different hosts, and the frontend should indicate this.

**API changes:**

Add platform metadata to the recon endpoints:

```typescript
// GET /oss/api/recon/:slug/issues response
{
  issues: ExtendedIssue[],
  platform: "gitlab",
  platformUrl: "https://gitlab.gnome.org",  // NEW: base URL for the platform instance
  repoUrl: "https://gitlab.gnome.org/GNOME/gnome-shell",  // NEW: direct repo link
  scrapedAt: "2026-02-25T..."
}
```

Add to `/oss/api/projects` response:

```typescript
{
  projects: [
    {
      slug: 'gnome-gnome-shell',
      name: 'GNOME Shell',
      platform: 'gitlab',
      platformUrl: 'https://gitlab.gnome.org', // NEW
      pools: ['desktop'],
      contributingUrl: 'https://...'
    }
  ]
}
```

**Frontend changes:**

The React frontend's project selector and issue list need platform awareness:

```typescript
// Update config.ts to include platformUrl
interface ProjectConfig {
  slug: string
  name: string
  platform: Platform
  platformUrl: string // NEW: "https://github.com" | "https://gitlab.gnome.org" | etc.
  apiBase: string
  projectId: string
  beginnerLabels: string[]
  contributingUrl: string
  pool: string[]
}
```

The issue URL field already contains the full URL (e.g., `https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/123`), so clicking an issue link already works regardless of platform. The platform badge is just a visual indicator.

### 6. Config Expansion: 141 Repos

The aggregator's `api/config.ts` currently has 20 projects hardcoded. With 141 repos, this needs to come from the scraper's watchlist instead.

**Option A: Fetch from scraper at build time (recommended)**

```bash
# Build step: pull config from scraper
"generate:config": "curl -s $SCRAPER_API_URL/api/v1/oss-recon/config | node scripts/gen-config.js > src/generated/project-config.ts"
```

**Option B: Fetch from watchlist KV at runtime**

```typescript
// Read watchlist from KV, merge with any hardcoded overrides
export async function getProjects(kv: KVNamespace): Promise<ProjectConfig[]> {
  const watchlist = (await kv.get('recon:watchlist', 'json')) as string[] | null
  if (!watchlist) return HARDCODED_PROJECTS // fallback

  // For each slug in watchlist, read recon:{slug} to get platform/metadata
  const projects = await Promise.all(
    watchlist.map(async slug => {
      const data = await getReconData(kv, slug)
      if (!data) return null
      return {
        slug,
        name: data.repoMeta?.name ?? slug,
        platform: data.platform,
        platformUrl: data.repoMeta?.platformUrl ?? 'https://github.com'
        // ... map other fields from repoMeta
      }
    })
  )
  return projects.filter(Boolean)
}
```

**Recommendation: Option B.** The watchlist is the single source of truth (in KV), and the aggregator already reads from KV. No build-time coupling to the scraper's availability. The hardcoded `config.ts` becomes a bootstrap-only fallback.

### 7. Update PROJECT-DESIGN.md

The consolidated KV schema is a breaking change from the design docs. Update:

- §4.1: Change 5-key pattern to 1-key pattern for scraper-written data
- §4.2: Note that aggregator-written keys (health, scored-issues, dossier, claims) remain separate
- §4.3: Add `ConsolidatedReconData` interface
- §4.4: Update KV budget analysis

---

## Implementation Order

| Step      | Task                                                                                           | Days          | Blocked By                   |
| --------- | ---------------------------------------------------------------------------------------------- | ------------- | ---------------------------- |
| 1         | **Type generation pipeline** — set up `openapi-typescript` to pull from scraper's OpenAPI spec | 0.5           | Scraper has OpenAPI endpoint |
| 2         | **KV reader migration** — consolidated single-key reader with in-memory cache                  | 0.5           | Step 1 (types)               |
| 3         | **CachedProvider update** — read from `recon:{slug}` with legacy `cached:{slug}` fallback      | 0.5           | Step 2                       |
| 4         | **Watchlist-driven config** — replace hardcoded 20 projects with KV watchlist                  | 0.5           | Step 2                       |
| 5         | **Platform metadata in API** — add `platformUrl`, `repoUrl` to responses                       | 0.5           | Step 3                       |
| 6         | **Frontend platform badges** — show GitHub/GitLab/Codeberg icons in UI                         | 0.5           | Step 5                       |
| 7         | **Update design docs** — reflect consolidated schema in PROJECT-DESIGN.md                      | 0.5           | Steps 1-3                    |
| 8         | **Deprecate old paths** — remove `api/adapters/`, delete `cached:{slug}` reads                 | 0.5           | Steps 3-4 confirmed working  |
| **Total** |                                                                                                | **~3-4 days** |                              |

---

## Risk Summary

| Risk                                                        | Mitigation                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Scraper OpenAPI spec not available yet                      | Write types manually first, switch to generated later                      |
| Consolidated blob too large for some repos (>25MB KV limit) | Scraper caps at `max_issues_per_repo: 100`, estimated ~500KB avg. Monitor. |
| Legacy frontend breaks during migration                     | CachedProvider has fallback to old `cached:{slug}` keys                    |
| Watchlist KV key empty on first deploy                      | Hardcoded config.ts serves as bootstrap fallback                           |
| Type drift between scraper Pydantic and aggregator Zod      | OpenAPI generation pipeline catches this at build time                     |

---

## Cross-Repo Contract Summary

```
                    ┌─────────────────────────┐
                    │      hadoku-site         │
                    │  (cron trigger only)     │
                    └──────────┬──────────────┘
                               │ POST /api/v1/oss-recon/scrape-all
                               ▼
                    ┌─────────────────────────┐
                    │     hadoku-scrape        │
                    │  (Python, PM2/Actions)   │
                    │                         │
                    │  OpenAPI spec at:        │
                    │  /openapi.json           │
                    └──────────┬──────────────┘
                               │ KV write: recon:{slug} (consolidated)
                               ▼
                    ┌─────────────────────────┐
                    │    Cloudflare KV         │
                    │                         │
                    │  recon:{slug}  ← scraper │
                    │  recon:{slug}:health     │
                    │  recon:{slug}:scored     │  ← aggregator
                    │  recon:{slug}:dossier    │
                    │  recon:{slug}:claims     │
                    │  recon:watchlist         │
                    └──────────┬──────────────┘
                               │ KV read
                               ▼
                    ┌─────────────────────────┐
                    │   hadoku-aggregator      │
                    │  (CF Worker, Hono)       │
                    │                         │
                    │  Types from scraper's    │
                    │  OpenAPI spec            │
                    │                         │
                    │  /oss/api/recon/*        │
                    │  /oss/api/issues/*       │
                    └──────────┬──────────────┘
                               │ HTTP API
                               ▼
                    ┌─────────────────────────┐
                    │   hadoku-site frontend   │
                    │  + vibedispatch          │
                    └─────────────────────────┘
```

**Scraper writes, aggregator reads.** Aggregator writes only its own analysis outputs. Types flow from scraper → OpenAPI → aggregator (build-time codegen). Watchlist is the single source of truth for which repos to track.
