/**
 * Pre-computation Pipeline
 *
 * Reads raw scraper data from KV, runs scoring + dossier compilation,
 * and writes results back to KV. GET routes then serve pre-computed data
 * instead of computing on every request.
 *
 * Designed to be called from environments without CPU limits
 * (GitHub Actions, scraper post-hook) via the exported npm package,
 * or via the POST /compute endpoint for small repos.
 */

import type {
  ScoredIssue,
  ClaimRecord,
  ClaimStatus,
  LifecycleStage,
  Complexity,
  CompetitionLevel
} from './types'
import { getConsolidatedRecon, getClaims, getScrapedSlugs, getScoredIssues } from './kv-reader'
import {
  putRepoHealth,
  putScoredIssues,
  putDossier,
  putAggregate,
  putAggregateVersion,
  type SlimScoredIssue
} from './kv-writer'
import { scoreRepoHealth } from './health-scorer'
import { scoreIssues } from './issue-scorer'
import { compileDossier } from './dossier-compiler'
import { daysSince } from './utils'

export interface ComputeResult {
  slug: string
  healthComputed: boolean
  scoredCount: number
  dossierGenerated: boolean
}

/**
 * Reads raw data for a single repo, computes health + scored issues + dossier,
 * and writes all three to KV.
 */
export async function computeAndStore(kv: KVNamespace, slug: string): Promise<ComputeResult> {
  const [consolidated, claims] = await Promise.all([
    getConsolidatedRecon(kv, slug),
    getClaims(kv, slug)
  ])

  const meta = consolidated?.repoMeta ?? null
  if (!meta) {
    return { slug, healthComputed: false, scoredCount: 0, dossierGenerated: false }
  }

  const scraped_at = consolidated?.scrapedAt ?? null
  const issues = consolidated?.issues ?? []
  const comments = consolidated?.comments?.threads ?? {}
  const merged = consolidated?.mergedPrs ?? []
  const rejected = consolidated?.rejectedPrs ?? []

  const health = scoreRepoHealth(meta, merged, rejected)
  const scored = issues.length > 0 ? scoreIssues(issues, comments, health, claims ?? []) : []
  const dossier = compileDossier(slug, meta, health, scored, merged, rejected)

  await Promise.all([
    putRepoHealth(kv, slug, health, scraped_at),
    putScoredIssues(kv, slug, scored, scraped_at),
    putDossier(kv, slug, dossier, scraped_at)
  ])

  return {
    slug,
    healthComputed: true,
    scoredCount: scored.length,
    dossierGenerated: true
  }
}

/**
 * Runs computeAndStore for every scraped repo sequentially.
 * Sequential to avoid overwhelming KV write limits.
 */
export async function computeAndStoreAll(kv: KVNamespace): Promise<{ results: ComputeResult[] }> {
  const slugs = await getScrapedSlugs(kv)
  const results: ComputeResult[] = []

  for (const slug of slugs) {
    const result = await computeAndStore(kv, slug)
    results.push(result)
  }

  // Build pre-sorted aggregate KV keys for paginated listing
  await buildAndWriteAggregates(kv, slugs)

  return { results }
}

// ============================================================================
// Aggregate Builder — pre-sorted slimmed issue lists
// ============================================================================

const SORT_FIELDS = [
  'cvs',
  'title',
  'repo',
  'lifecycle',
  'complexity',
  'sentiment',
  'competition',
  'createdAt'
] as const

export type AggregateSortField = (typeof SORT_FIELDS)[number]

const LIFECYCLE_ORDER: Record<LifecycleStage, number> = {
  fresh: 0,
  triaged: 1,
  accepted: 2,
  stale: 3,
  zombie: 4
}

const COMPLEXITY_ORDER: Record<Complexity, number> = {
  low: 0,
  medium: 1,
  high: 2
}

const COMPETITION_ORDER: Record<CompetitionLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3
}

/** Strip heavy fields from a ScoredIssue for the aggregate listing. */
function slimIssueForAggregate(issue: ScoredIssue): SlimScoredIssue {
  const {
    body: _body,
    reactionGroups: _rg,
    sentimentSignals: _ss,
    commentDigest: _cd,
    likelyFiles: _lf,
    relatedIssues: _ri,
    _scoring,
    difficultySignals: _ds,
    bodyPreview: _bp,
    linkedPrUrls: _lp,
    assignees: _as,
    ...slim
  } = issue
  return slim
}

export function sortComparator(
  field: AggregateSortField
): (a: SlimScoredIssue, b: SlimScoredIssue) => number {
  switch (field) {
    case 'cvs':
      return (a, b) => a.cvs - b.cvs
    case 'title':
      return (a, b) => a.title.localeCompare(b.title)
    case 'repo':
      return (a, b) => a.repoSlug.localeCompare(b.repoSlug)
    case 'lifecycle':
      return (a, b) => LIFECYCLE_ORDER[a.lifecycleStage] - LIFECYCLE_ORDER[b.lifecycleStage]
    case 'complexity':
      return (a, b) => COMPLEXITY_ORDER[a.complexity] - COMPLEXITY_ORDER[b.complexity]
    case 'sentiment':
      return (a, b) => a.sentimentScore - b.sentimentScore
    case 'competition':
      return (a, b) => COMPETITION_ORDER[a.competitionLevel] - COMPETITION_ORDER[b.competitionLevel]
    case 'createdAt':
      return (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  }
}

/**
 * Collects all scored issues across repos, slims them, applies claims,
 * pre-sorts into 8 KV keys (one per sort field), and writes a version key.
 */
// Process slugs in chunks rather than one 206-wide Promise.all. Each slug
// can trigger an inline computeAndStore (a consolidated-recon read + scoring
// + 3 KV writes), so a fully-parallel fan-out over 200+ repos can blow the
// Cloudflare Worker subrequest / CPU limits mid-rebuild — and because the
// whole thing ran inside waitUntil() with no error logging, a thrown limit
// looked identical to "the new repos silently didn't make it in" (the
// 2026-05-28 missing-12-repos incident). Chunking bounds concurrency;
// per-slug try/catch keeps one bad repo from killing the whole aggregate;
// the recon:agg:last-build status key makes the outcome observable without
// Cloudflare log access.
const AGGREGATE_CHUNK_SIZE = 20

interface SlugBuildOutcome {
  slug: string
  issueCount: number
  computedInline: boolean
  error?: string
}

export async function buildAndWriteAggregates(kv: KVNamespace, slugs: string[]): Promise<void> {
  const startedAt = Date.now()
  const outcomes: SlugBuildOutcome[] = []
  const collected: ScoredIssue[][] = []

  for (let i = 0; i < slugs.length; i += AGGREGATE_CHUNK_SIZE) {
    const chunk = slugs.slice(i, i + AGGREGATE_CHUNK_SIZE)
    const chunkResults = await Promise.all(
      chunk.map(async (slug): Promise<ScoredIssue[]> => {
        try {
          const [initialScored, claims] = await Promise.all([
            getScoredIssues(kv, slug),
            getClaims(kv, slug)
          ])
          let scored = initialScored
          let computedInline = false
          // If scored-issues is missing, the scraper's fire-and-forget
          // /{slug}/compute may not have written it yet — compute inline so
          // a freshly-added slug isn't silently dropped from the aggregate.
          if (!scored) {
            await computeAndStore(kv, slug)
            scored = await getScoredIssues(kv, slug)
            computedInline = true
          }
          if (!scored) {
            outcomes.push({
              slug,
              issueCount: 0,
              computedInline,
              error: 'no scored issues after compute'
            })
            return []
          }
          const overlaid = applyClaimOverlay(scored, claims ?? [])
          outcomes.push({ slug, issueCount: overlaid.length, computedInline })
          return overlaid
        } catch (err) {
          // One repo's failure must not abort the whole rebuild — record it
          // and continue so the other 205 repos still aggregate.
          const msg = err instanceof Error ? err.message : String(err)
          outcomes.push({ slug, issueCount: 0, computedInline: false, error: msg })
          console.error(`buildAndWriteAggregates: slug=${slug} failed: ${msg}`)
          return []
        }
      })
    )
    collected.push(...chunkResults)
  }

  const allIssues = collected.flat()
  const slimmed = allIssues.map(slimIssueForAggregate)

  // Write pre-sorted KV keys in parallel (one per sort field, ascending order)
  await Promise.all(
    SORT_FIELDS.map(field => {
      const sorted = [...slimmed].sort(sortComparator(field))
      return putAggregate(kv, field, sorted)
    })
  )

  // Build unique project list from all issues
  const projectMap = new Map<string, string>()
  for (const issue of slimmed) {
    if (!projectMap.has(issue.repoSlug)) {
      projectMap.set(issue.repoSlug, issue.project)
    }
  }
  const projects = [...projectMap.entries()]
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Write version metadata
  await putAggregateVersion(kv, {
    version: Date.now(),
    repoCount: slugs.length,
    totalCount: slimmed.length,
    projects
  })

  // Observability: persist a build status so operators can see what the
  // (otherwise log-less, waitUntil-backgrounded) rebuild actually did.
  // Read via GET /recon/agg/build-status.
  const zeroIssueSlugs = outcomes.filter(o => o.issueCount === 0 && !o.error).map(o => o.slug)
  const erroredSlugs = outcomes.filter(o => o.error).map(o => ({ slug: o.slug, error: o.error }))
  const status = {
    builtAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    requestedSlugs: slugs.length,
    processedSlugs: outcomes.length,
    totalIssues: slimmed.length,
    zeroIssueSlugs,
    erroredSlugs
  }
  await kv.put('recon:agg:last-build', JSON.stringify(status))
  console.log(
    `buildAndWriteAggregates done: requested=${slugs.length} processed=${outcomes.length} ` +
      `issues=${slimmed.length} zeroIssue=${zeroIssueSlugs.length} errored=${erroredSlugs.length}`
  )
}

/**
 * Patches claimStatus and claimAuthor onto pre-computed scored issues
 * using live claims from KV. This is O(n) and runs well within the
 * CF Worker 10ms CPU limit.
 *
 * Claims don't affect CVS scores — the CVS formula uses repoScore,
 * issueScore, timing, reactions, and commentSentiment, none of which
 * come from the claims KV store.
 */
export function applyClaimOverlay(
  scoredIssues: ScoredIssue[],
  claims: ClaimRecord[]
): ScoredIssue[] {
  if (claims.length === 0) {
    // No claims — reset any previously-claimed issues to unclaimed
    return scoredIssues.map(issue =>
      issue.claimStatus !== 'unclaimed'
        ? { ...issue, claimStatus: 'unclaimed' as ClaimStatus, claimAuthor: null }
        : issue
    )
  }

  const claimMap = new Map(claims.map(c => [c.issueId, c]))

  return scoredIssues.map(issue => {
    const claim = claimMap.get(issue.id)
    if (claim) {
      const staleDays = daysSince(claim.claimedAt)
      const status: ClaimStatus = staleDays > 14 ? 'stale-claim' : 'claimed'
      return { ...issue, claimStatus: status, claimAuthor: claim.claimedBy }
    }
    // No active claim — ensure unclaimed
    if (issue.claimStatus !== 'unclaimed') {
      return { ...issue, claimStatus: 'unclaimed' as ClaimStatus, claimAuthor: null }
    }
    return issue
  })
}
