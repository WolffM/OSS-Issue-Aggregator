/**
 * KV Writer for Recon Pipeline
 *
 * Writes pre-computed recon:{slug}:* results to Cloudflare KV.
 * Mirrors the read functions in kv-reader.ts.
 */

import type { RepoHealth, ScoredIssue, Dossier } from './types'

export async function putRepoHealth(
  kv: KVNamespace,
  slug: string,
  health: RepoHealth
): Promise<void> {
  await kv.put(`recon:${slug}:health`, JSON.stringify(health))
}

export async function putScoredIssues(
  kv: KVNamespace,
  slug: string,
  issues: ScoredIssue[]
): Promise<void> {
  await kv.put(`recon:${slug}:scored-issues`, JSON.stringify(issues))
}

export async function putDossier(kv: KVNamespace, slug: string, dossier: Dossier): Promise<void> {
  await kv.put(`recon:${slug}:dossier`, JSON.stringify(dossier))
}
