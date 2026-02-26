/**
 * KV Reader for Recon Pipeline
 *
 * Reads recon:{slug} (consolidated scraper data) and
 * recon:{slug}:* (aggregator-computed data) from Cloudflare KV.
 */

import type { ConsolidatedReconData, RepoHealth, ScoredIssue, ClaimRecord, Dossier } from './types'

// ============================================================================
// Generic Helpers
// ============================================================================

async function readKV<T>(kv: KVNamespace, key: string): Promise<T | null> {
  try {
    const data = await kv.get<T>(key, 'json')
    return data ?? null
  } catch {
    return null
  }
}

// ============================================================================
// Public API — Scraper Data (consolidated key)
// ============================================================================

export async function getConsolidatedRecon(
  kv: KVNamespace,
  slug: string
): Promise<ConsolidatedReconData | null> {
  return readKV<ConsolidatedReconData>(kv, `recon:${slug}`)
}

export async function getScrapedSlugs(kv: KVNamespace): Promise<string[]> {
  try {
    const slugs = new Set<string>()
    let cursor: string | undefined

    do {
      const result = await kv.list({
        prefix: 'recon:',
        ...(cursor ? { cursor } : {})
      })

      for (const key of result.keys) {
        // Keys are recon:{slug} or recon:{slug}:{dataType} — extract the slug
        const parts = key.name.split(':')
        if (parts.length >= 2 && parts[1] !== 'watchlist') {
          slugs.add(parts[1])
        }
      }

      cursor = result.list_complete ? undefined : result.cursor
    } while (cursor)

    return [...slugs].sort()
  } catch {
    return []
  }
}

// ============================================================================
// Public API — Aggregator-computed data (separate keys)
// ============================================================================

export async function getRepoHealth(kv: KVNamespace, slug: string): Promise<RepoHealth | null> {
  return readKV<RepoHealth>(kv, `recon:${slug}:health`)
}

export async function getScoredIssues(
  kv: KVNamespace,
  slug: string
): Promise<ScoredIssue[] | null> {
  return readKV<ScoredIssue[]>(kv, `recon:${slug}:scored-issues`)
}

export async function getClaims(kv: KVNamespace, slug: string): Promise<ClaimRecord[] | null> {
  return readKV<ClaimRecord[]>(kv, `recon:${slug}:claims`)
}

export async function getDossier(kv: KVNamespace, slug: string): Promise<Dossier | null> {
  return readKV<Dossier>(kv, `recon:${slug}:dossier`)
}
