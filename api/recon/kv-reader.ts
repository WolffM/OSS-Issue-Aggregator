/**
 * KV Reader for Recon Pipeline
 *
 * Reads recon:{slug} (consolidated scraper data) and
 * recon:{slug}:* (aggregator-computed data) from Cloudflare KV.
 *
 * Computed data is stored in KVEnvelope wrappers that carry
 * scraped_at / computed_at timestamps. The envelope-aware readers
 * fall back gracefully to bare (pre-migration) data.
 */

import type {
  ConsolidatedReconData,
  RepoHealth,
  ScoredIssue,
  ClaimRecord,
  Dossier,
  KVEnvelope
} from './types'
import type { SlimScoredIssue, AggregateVersion } from './kv-writer'

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

/**
 * Read an enveloped KV value. Falls back to bare data for backward compat
 * with KV entries written before the envelope migration.
 *
 * Detection: envelopes always have `data` + `computed_at` at the top level.
 * Bare RepoHealth/ScoredIssue[]/Dossier objects never have both.
 */
async function readEnvelopedKV<T>(kv: KVNamespace, key: string): Promise<KVEnvelope<T> | null> {
  try {
    const raw = await kv.get<Record<string, unknown>>(key, 'json')
    if (!raw) return null

    // Detect envelope vs. bare data
    if (raw.data !== undefined && typeof raw.computed_at === 'string') {
      return raw as unknown as KVEnvelope<T>
    }

    // Bare data (pre-migration): wrap with null timestamps,
    // extracting computed_at from existing timestamp fields if available
    return {
      data: raw as unknown as T,
      scraped_at: null,
      computed_at:
        (typeof raw.analyzedAt === 'string' ? raw.analyzedAt : null) ??
        (typeof raw.generatedAt === 'string' ? raw.generatedAt : null) ??
        ''
    }
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

/**
 * Names that live directly under `recon:` but are not repos: the pre-sorted
 * aggregate (`recon:agg:*`), its build markers, and the scraper's own watchlist
 * (`recon:watchlist`). Without this, `watchlist` was enumerated as a repo slug,
 * counted in `repoCount`, and failed every aggregate rebuild with "no scored
 * issues after compute".
 */
const RESERVED_KEY_NAMES = new Set(['agg', 'watchlist'])

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
        if (parts.length >= 2 && !RESERVED_KEY_NAMES.has(parts[1])) {
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
// Public API — Enveloped Readers (with freshness metadata)
// ============================================================================

export async function getRepoHealthEnveloped(
  kv: KVNamespace,
  slug: string
): Promise<KVEnvelope<RepoHealth> | null> {
  return readEnvelopedKV<RepoHealth>(kv, `recon:${slug}:health`)
}

export async function getScoredIssuesEnveloped(
  kv: KVNamespace,
  slug: string
): Promise<KVEnvelope<ScoredIssue[]> | null> {
  return readEnvelopedKV<ScoredIssue[]>(kv, `recon:${slug}:scored-issues`)
}

export async function getDossierEnveloped(
  kv: KVNamespace,
  slug: string
): Promise<KVEnvelope<Dossier> | null> {
  return readEnvelopedKV<Dossier>(kv, `recon:${slug}:dossier`)
}

// ============================================================================
// Public API — Bare Readers (backward-compatible, delegate to enveloped)
// ============================================================================

export async function getRepoHealth(kv: KVNamespace, slug: string): Promise<RepoHealth | null> {
  const env = await getRepoHealthEnveloped(kv, slug)
  return env?.data ?? null
}

export async function getScoredIssues(
  kv: KVNamespace,
  slug: string
): Promise<ScoredIssue[] | null> {
  const env = await getScoredIssuesEnveloped(kv, slug)
  return env?.data ?? null
}

export async function getClaims(kv: KVNamespace, slug: string): Promise<ClaimRecord[] | null> {
  return readKV<ClaimRecord[]>(kv, `recon:${slug}:claims`)
}

export async function getDossier(kv: KVNamespace, slug: string): Promise<Dossier | null> {
  const env = await getDossierEnveloped(kv, slug)
  return env?.data ?? null
}

// ============================================================================
// Public API — Aggregate Readers (pre-computed sorted issue lists)
// ============================================================================

export async function getAggregate(
  kv: KVNamespace,
  sortField: string
): Promise<SlimScoredIssue[] | null> {
  return readKV<SlimScoredIssue[]>(kv, `recon:agg:${sortField}`)
}

export async function getAggregateVersion(kv: KVNamespace): Promise<AggregateVersion | null> {
  return readKV<AggregateVersion>(kv, 'recon:agg:v')
}
