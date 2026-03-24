/**
 * KV Writer for Recon Pipeline
 *
 * Writes pre-computed recon:{slug}:* results to Cloudflare KV.
 * Mirrors the read functions in kv-reader.ts.
 *
 * All writes are wrapped in a KVEnvelope that carries scraped_at
 * and computed_at timestamps for freshness tracking.
 */

import type { RepoHealth, ScoredIssue, Dossier, KVEnvelope } from './types'

// Slim issue type used by aggregate KV keys (heavy fields already stripped)
export type SlimScoredIssue = Omit<
  ScoredIssue,
  | 'body'
  | 'reactionGroups'
  | 'sentimentSignals'
  | 'commentDigest'
  | 'likelyFiles'
  | 'relatedIssues'
  | '_scoring'
  | 'difficultySignals'
  | 'bodyPreview'
  | 'linkedPrUrls'
  | 'assignees'
>

export interface AggregateVersion {
  version: number
  repoCount: number
  totalCount: number
  projects: { slug: string; name: string }[]
}

export async function putRepoHealth(
  kv: KVNamespace,
  slug: string,
  health: RepoHealth,
  scraped_at: string | null
): Promise<void> {
  const envelope: KVEnvelope<RepoHealth> = {
    data: health,
    scraped_at,
    computed_at: new Date().toISOString()
  }
  await kv.put(`recon:${slug}:health`, JSON.stringify(envelope))
}

export async function putScoredIssues(
  kv: KVNamespace,
  slug: string,
  issues: ScoredIssue[],
  scraped_at: string | null
): Promise<void> {
  const envelope: KVEnvelope<ScoredIssue[]> = {
    data: issues,
    scraped_at,
    computed_at: new Date().toISOString()
  }
  await kv.put(`recon:${slug}:scored-issues`, JSON.stringify(envelope))
}

export async function putDossier(
  kv: KVNamespace,
  slug: string,
  dossier: Dossier,
  scraped_at: string | null
): Promise<void> {
  const envelope: KVEnvelope<Dossier> = {
    data: dossier,
    scraped_at,
    computed_at: new Date().toISOString()
  }
  await kv.put(`recon:${slug}:dossier`, JSON.stringify(envelope))
}

export async function putAggregate(
  kv: KVNamespace,
  sortField: string,
  issues: SlimScoredIssue[]
): Promise<void> {
  await kv.put(`recon:agg:${sortField}`, JSON.stringify(issues))
}

export async function putAggregateVersion(kv: KVNamespace, meta: AggregateVersion): Promise<void> {
  await kv.put('recon:agg:v', JSON.stringify(meta))
}
