/**
 * Claim Tracking
 *
 * Reads/writes recon:{slug}:claims KV key (array of ClaimRecord).
 * Deduplicates by issueId — adding a claim for an already-claimed issue
 * replaces the existing claim.
 */

import type { ClaimRecord } from './types'

export async function addClaim(
  kv: KVNamespace,
  slug: string,
  claim: { issueId: string; claimedBy: string; forkIssueUrl?: string }
): Promise<ClaimRecord> {
  const existing = (await kv.get<ClaimRecord[]>(`recon:${slug}:claims`, 'json')) ?? []

  const record: ClaimRecord = {
    issueId: claim.issueId,
    claimedBy: claim.claimedBy,
    claimedAt: new Date().toISOString(),
    forkIssueUrl: claim.forkIssueUrl ?? null
  }

  // Deduplicate by issueId — replace existing claim for same issue
  const filtered = existing.filter(c => c.issueId !== claim.issueId)
  filtered.push(record)

  await kv.put(`recon:${slug}:claims`, JSON.stringify(filtered))
  return record
}

export async function removeClaim(
  kv: KVNamespace,
  slug: string,
  issueId: string
): Promise<boolean> {
  const existing = (await kv.get<ClaimRecord[]>(`recon:${slug}:claims`, 'json')) ?? []
  const filtered = existing.filter(c => c.issueId !== issueId)

  if (filtered.length === existing.length) return false

  await kv.put(`recon:${slug}:claims`, JSON.stringify(filtered))
  return true
}
