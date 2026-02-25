/**
 * KV Reader for Recon Pipeline
 *
 * Reads recon:{slug}:* keys from Cloudflare KV.
 * Follows the same pattern as getMarkedIssues() in handler.ts.
 */

import type {
  ExtendedIssue,
  ReconIssueData,
  PRSample,
  RepoMeta,
  IssueComments,
  RepoHealth,
  ScoredIssue,
  ClaimRecord,
  Dossier
} from './types'

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

function unwrapPRs(data: unknown, primaryKey: string): PRSample[] | null {
  if (!data) return null
  if (Array.isArray(data)) return data as PRSample[]
  const obj = data as Record<string, unknown>
  if (Array.isArray(obj[primaryKey])) return obj[primaryKey] as PRSample[]
  if (Array.isArray(obj.prs)) return obj.prs as PRSample[]
  return null
}

// ============================================================================
// Public API
// ============================================================================

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
        // Keys are recon:{slug}:{dataType} — extract the slug
        const parts = key.name.split(':')
        if (parts.length >= 3 && parts[1] !== 'watchlist') {
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

export async function getReconIssues(
  kv: KVNamespace,
  slug: string
): Promise<ExtendedIssue[] | null> {
  const data = await readKV<ReconIssueData>(kv, `recon:${slug}:issues`)
  return data?.issues ?? null
}

export async function getReconIssuesScrapedAt(
  kv: KVNamespace,
  slug: string
): Promise<string | null> {
  const data = await readKV<ReconIssueData>(kv, `recon:${slug}:issues`)
  return data?.scrapedAt ?? null
}

export async function getMergedPRs(kv: KVNamespace, slug: string): Promise<PRSample[] | null> {
  try {
    const data = await kv.get<unknown>(`recon:${slug}:merged-prs`, 'json')
    return unwrapPRs(data, 'merged')
  } catch {
    return null
  }
}

export async function getRejectedPRs(kv: KVNamespace, slug: string): Promise<PRSample[] | null> {
  try {
    const data = await kv.get<unknown>(`recon:${slug}:rejected-prs`, 'json')
    return unwrapPRs(data, 'rejected')
  } catch {
    return null
  }
}

export async function getRepoMeta(kv: KVNamespace, slug: string): Promise<RepoMeta | null> {
  try {
    const data = await kv.get<unknown>(`recon:${slug}:repo-meta`, 'json')
    if (!data) return null
    const obj = data as Record<string, unknown>
    // Scraper writes { meta: RepoMeta, ... } wrapper — unwrap it
    if (obj.meta && typeof obj.meta === 'object') return obj.meta as RepoMeta
    // Already unwrapped (has RepoMeta fields directly)
    if (typeof obj.owner === 'string' && typeof obj.repo === 'string') return data as RepoMeta
    return null
  } catch {
    return null
  }
}

export async function getComments(kv: KVNamespace, slug: string): Promise<IssueComments | null> {
  try {
    const data = await kv.get<unknown>(`recon:${slug}:comments`, 'json')
    if (!data) return null
    const obj = data as Record<string, unknown>
    // Scraper writes { threads: IssueComments, ... } wrapper — unwrap it
    if (obj.threads && typeof obj.threads === 'object') return obj.threads as IssueComments
    // Already unwrapped (keys are issue numbers)
    return data as IssueComments
  } catch {
    return null
  }
}

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
