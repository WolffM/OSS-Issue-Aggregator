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

export async function getReconIssues(
  kv: KVNamespace,
  slug: string
): Promise<ExtendedIssue[] | null> {
  try {
    const data = await kv.get<ReconIssueData>(`recon:${slug}:issues`, 'json')
    if (!data) return null
    return data.issues
  } catch {
    return null
  }
}

export async function getReconIssuesScrapedAt(
  kv: KVNamespace,
  slug: string
): Promise<string | null> {
  try {
    const data = await kv.get<ReconIssueData>(`recon:${slug}:issues`, 'json')
    return data?.scrapedAt ?? null
  } catch {
    return null
  }
}

export async function getMergedPRs(kv: KVNamespace, slug: string): Promise<PRSample[] | null> {
  try {
    const data = await kv.get<unknown>(`recon:${slug}:merged-prs`, 'json')
    if (!data) return null
    // Scraper writes { merged: PRSample[], ... } wrapper — unwrap it
    if (Array.isArray(data)) return data as PRSample[]
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.merged)) return obj.merged as PRSample[]
    if (Array.isArray(obj.prs)) return obj.prs as PRSample[]
    return null
  } catch {
    return null
  }
}

export async function getRejectedPRs(kv: KVNamespace, slug: string): Promise<PRSample[] | null> {
  try {
    const data = await kv.get<unknown>(`recon:${slug}:rejected-prs`, 'json')
    if (!data) return null
    // Scraper writes { rejected: PRSample[], ... } wrapper — unwrap it
    if (Array.isArray(data)) return data as PRSample[]
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.rejected)) return obj.rejected as PRSample[]
    if (Array.isArray(obj.prs)) return obj.prs as PRSample[]
    return null
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
  try {
    const data = await kv.get<RepoHealth>(`recon:${slug}:health`, 'json')
    return data ?? null
  } catch {
    return null
  }
}

export async function getScoredIssues(
  kv: KVNamespace,
  slug: string
): Promise<ScoredIssue[] | null> {
  try {
    const data = await kv.get<ScoredIssue[]>(`recon:${slug}:scored-issues`, 'json')
    return data ?? null
  } catch {
    return null
  }
}

export async function getClaims(kv: KVNamespace, slug: string): Promise<ClaimRecord[] | null> {
  try {
    const data = await kv.get<ClaimRecord[]>(`recon:${slug}:claims`, 'json')
    return data ?? null
  } catch {
    return null
  }
}

export async function getDossier(kv: KVNamespace, slug: string): Promise<Dossier | null> {
  try {
    const data = await kv.get<Dossier>(`recon:${slug}:dossier`, 'json')
    return data ?? null
  } catch {
    return null
  }
}
