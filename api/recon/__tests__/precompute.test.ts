import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeAndStore, computeAndStoreAll, applyClaimOverlay } from '../precompute'
import {
  createMockKV,
  makeConsolidatedReconData,
  makeExtendedIssue,
  makeRepoMeta,
  makePRSample,
  makeComment,
  makeCommentThread,
  makeClaimRecord,
  makeScoredIssue,
  makeRepoHealth
} from './helpers'

// ============================================================================
// applyClaimOverlay
// ============================================================================

describe('applyClaimOverlay', () => {
  it('returns issues unchanged when no claims and all unclaimed', () => {
    const issues = [makeScoredIssue({ id: 'issue-1' }), makeScoredIssue({ id: 'issue-2' })]
    const result = applyClaimOverlay(issues, [])
    expect(result[0].claimStatus).toBe('unclaimed')
    expect(result[1].claimStatus).toBe('unclaimed')
  })

  it('marks issue as claimed when matching claim exists', () => {
    const issues = [makeScoredIssue({ id: 'issue-1' })]
    const claims = [
      makeClaimRecord({
        issueId: 'issue-1',
        claimedBy: 'user-a',
        claimedAt: new Date().toISOString()
      })
    ]
    const result = applyClaimOverlay(issues, claims)
    expect(result[0].claimStatus).toBe('claimed')
    expect(result[0].claimAuthor).toBe('user-a')
  })

  it('marks issue as stale-claim when claim is older than 14 days', () => {
    const issues = [makeScoredIssue({ id: 'issue-1' })]
    const staleDate = new Date(Date.now() - 20 * 86_400_000).toISOString()
    const claims = [
      makeClaimRecord({ issueId: 'issue-1', claimedBy: 'user-b', claimedAt: staleDate })
    ]
    const result = applyClaimOverlay(issues, claims)
    expect(result[0].claimStatus).toBe('stale-claim')
    expect(result[0].claimAuthor).toBe('user-b')
  })

  it('resets previously-claimed issues when claim is removed', () => {
    const issues = [
      makeScoredIssue({ id: 'issue-1', claimStatus: 'claimed', claimAuthor: 'old-user' })
    ]
    const result = applyClaimOverlay(issues, [])
    expect(result[0].claimStatus).toBe('unclaimed')
    expect(result[0].claimAuthor).toBeNull()
  })

  it('does not modify CVS scores', () => {
    const issues = [makeScoredIssue({ id: 'issue-1', cvs: 75 })]
    const claims = [
      makeClaimRecord({
        issueId: 'issue-1',
        claimedBy: 'user-c',
        claimedAt: new Date().toISOString()
      })
    ]
    const result = applyClaimOverlay(issues, claims)
    expect(result[0].cvs).toBe(75)
  })

  it('handles mix of claimed and unclaimed issues', () => {
    const issues = [
      makeScoredIssue({ id: 'issue-1' }),
      makeScoredIssue({ id: 'issue-2' }),
      makeScoredIssue({ id: 'issue-3' })
    ]
    const claims = [
      makeClaimRecord({
        issueId: 'issue-2',
        claimedBy: 'user-d',
        claimedAt: new Date().toISOString()
      })
    ]
    const result = applyClaimOverlay(issues, claims)
    expect(result[0].claimStatus).toBe('unclaimed')
    expect(result[1].claimStatus).toBe('claimed')
    expect(result[1].claimAuthor).toBe('user-d')
    expect(result[2].claimStatus).toBe('unclaimed')
  })
})

// ============================================================================
// computeAndStore
// ============================================================================

describe('computeAndStore', () => {
  it('returns empty result when repo meta is missing', async () => {
    const kv = createMockKV({})
    const result = await computeAndStore(kv, 'missing-repo')
    expect(result.healthComputed).toBe(false)
    expect(result.scoredCount).toBe(0)
    expect(result.dossierGenerated).toBe(false)
  })

  it('computes and writes health, scored issues, and dossier to KV', async () => {
    const issue = makeExtendedIssue({ id: 'issue-1' })
    const meta = makeRepoMeta()
    const merged = [makePRSample()]
    const rejected = [makePRSample({ closedAt: '2024-01-15T00:00:00Z', mergedAt: null })]

    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        issues: [issue],
        repoMeta: meta,
        mergedPrs: merged,
        rejectedPrs: rejected,
        comments: {
          threads: {
            'issue-1': makeCommentThread([makeComment()])
          }
        }
      })
    })

    const result = await computeAndStore(kv, 'fastify-fastify')

    expect(result.healthComputed).toBe(true)
    expect(result.scoredCount).toBe(1)
    expect(result.dossierGenerated).toBe(true)

    // Verify KV was written
    const storedHealth = await kv.get('recon:fastify-fastify:health', 'json')
    expect(storedHealth).toBeTruthy()

    const storedScored = await kv.get('recon:fastify-fastify:scored-issues', 'json')
    expect(storedScored).toBeTruthy()
    expect(Array.isArray(storedScored)).toBe(true)

    const storedDossier = await kv.get('recon:fastify-fastify:dossier', 'json')
    expect(storedDossier).toBeTruthy()
  })

  it('handles repos with no issues', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({ issues: [] })
    })

    const result = await computeAndStore(kv, 'fastify-fastify')
    expect(result.healthComputed).toBe(true)
    expect(result.scoredCount).toBe(0)
    expect(result.dossierGenerated).toBe(true)
  })
})

// ============================================================================
// computeAndStoreAll
// ============================================================================

describe('computeAndStoreAll', () => {
  it('processes all scraped slugs', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        issues: [makeExtendedIssue()]
      }),
      'recon:other-repo': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ owner: 'other', repo: 'repo' }),
        issues: []
      })
    })

    const result = await computeAndStoreAll(kv)
    expect(result.results).toHaveLength(2)
    expect(result.results.map(r => r.slug).sort()).toEqual(['fastify-fastify', 'other-repo'].sort())
  })

  it('returns empty results when no repos exist', async () => {
    const kv = createMockKV({})
    const result = await computeAndStoreAll(kv)
    expect(result.results).toHaveLength(0)
  })
})
