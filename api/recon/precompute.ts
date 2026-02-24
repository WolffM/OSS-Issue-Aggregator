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

import type { ScoredIssue, ClaimRecord, ClaimStatus } from './types'
import {
  getReconIssues,
  getComments,
  getClaims,
  getRepoMeta,
  getMergedPRs,
  getRejectedPRs,
  getScrapedSlugs
} from './kv-reader'
import { putRepoHealth, putScoredIssues, putDossier } from './kv-writer'
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
  const [issues, comments, claims, meta, merged, rejected] = await Promise.all([
    getReconIssues(kv, slug),
    getComments(kv, slug),
    getClaims(kv, slug),
    getRepoMeta(kv, slug),
    getMergedPRs(kv, slug),
    getRejectedPRs(kv, slug)
  ])

  if (!meta) {
    return { slug, healthComputed: false, scoredCount: 0, dossierGenerated: false }
  }

  const health = scoreRepoHealth(meta, merged ?? [], rejected ?? [])
  const scored =
    issues && issues.length > 0 ? scoreIssues(issues, comments ?? {}, health, claims ?? []) : []
  const dossier = compileDossier(slug, meta, health, scored, merged ?? [], rejected ?? [])

  await Promise.all([
    putRepoHealth(kv, slug, health),
    putScoredIssues(kv, slug, scored),
    putDossier(kv, slug, dossier)
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

  return { results }
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
