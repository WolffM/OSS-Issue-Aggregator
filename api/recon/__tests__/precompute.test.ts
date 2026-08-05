import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  computeAndStore,
  computeAndStoreAll,
  applyClaimOverlay,
  buildAndWriteAggregates,
  claimRebuild,
  REBUILD_STARTED_KEY
} from '../precompute'
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

    // Verify KV was written as envelopes with freshness timestamps
    const storedHealth = (await kv.get('recon:fastify-fastify:health', 'json')) as Record<
      string,
      unknown
    >
    expect(storedHealth).toBeTruthy()
    expect(storedHealth.data).toBeTruthy()
    expect(storedHealth.computed_at).toEqual(expect.any(String))
    expect(storedHealth.scraped_at).toBe('2024-01-20T14:45:00Z')

    const storedScored = (await kv.get('recon:fastify-fastify:scored-issues', 'json')) as Record<
      string,
      unknown
    >
    expect(storedScored).toBeTruthy()
    expect(Array.isArray(storedScored.data)).toBe(true)
    expect(storedScored.computed_at).toEqual(expect.any(String))
    expect(storedScored.scraped_at).toBe('2024-01-20T14:45:00Z')

    const storedDossier = (await kv.get('recon:fastify-fastify:dossier', 'json')) as Record<
      string,
      unknown
    >
    expect(storedDossier).toBeTruthy()
    expect(storedDossier.data).toBeTruthy()
    expect(storedDossier.computed_at).toEqual(expect.any(String))
    expect(storedDossier.scraped_at).toBe('2024-01-20T14:45:00Z')
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

// ============================================================================
// buildAndWriteAggregates
// ============================================================================

describe('buildAndWriteAggregates', () => {
  it('self-heals when scored-issues is missing for a freshly scraped slug', async () => {
    // Simulate the race: scraper wrote consolidated `recon:{slug}` but the
    // fire-and-forget /:slug/compute hasn't written scored-issues yet when
    // scrape-complete fires. buildAndWriteAggregates should compute inline
    // rather than silently dropping the slug.
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        issues: [makeExtendedIssue({ id: 'github-fastify-fastify-1' })]
      }),
      'recon:ollama-ollama': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ owner: 'ollama', repo: 'ollama', slug: 'ollama-ollama' }),
        issues: [makeExtendedIssue({ id: 'github-ollama-ollama-1' })]
      })
    })

    await buildAndWriteAggregates(kv, ['fastify-fastify', 'ollama-ollama'])

    // scored-issues now exists for both (inline-computed for ollama)
    const ollamaScored = (await kv.get('recon:ollama-ollama:scored-issues', 'json')) as Record<
      string,
      unknown
    >
    expect(ollamaScored).toBeTruthy()
    expect(Array.isArray(ollamaScored.data)).toBe(true)
    expect((ollamaScored.data as unknown[]).length).toBe(1)

    // Aggregate includes ollama
    const agg = (await kv.get('recon:agg:cvs', 'json')) as Array<{ repoSlug: string }>
    expect(agg).toBeTruthy()
    const slugsInAgg = new Set(agg.map(i => i.repoSlug))
    expect(slugsInAgg.has('ollama-ollama')).toBe(true)
    expect(slugsInAgg.has('fastify-fastify')).toBe(true)
  })
})

// ============================================================================
// claimRebuild — stampede guard for the read-path fallback
// ============================================================================

describe('claimRebuild', () => {
  it('allows a rebuild when no marker exists', async () => {
    const kv = createMockKV()
    expect(await claimRebuild(kv)).toBe(true)
  })

  it('suppresses a second trigger while a rebuild is in flight', async () => {
    const kv = createMockKV()
    await kv.put(REBUILD_STARTED_KEY, JSON.stringify({ startedAt: new Date().toISOString() }))
    // The read-path fallback runs per REQUEST. Without this, every hit on a
    // stale aggregate starts its own ~23s, ~20MB rebuild.
    expect(await claimRebuild(kv)).toBe(false)
  })

  it('allows a retry once the claim has aged out', async () => {
    const kv = createMockKV()
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    await kv.put(REBUILD_STARTED_KEY, JSON.stringify({ startedAt: old }))
    // A rebuild killed mid-flight (OOM) never clears its own marker, so the
    // claim MUST expire or the aggregate can never recover.
    expect(await claimRebuild(kv)).toBe(true)
  })

  it('fails OPEN on an unreadable or malformed marker', async () => {
    const kv = createMockKV()
    await kv.put(REBUILD_STARTED_KEY, 'not json at all')
    // Bookkeeping must never be the reason the data stays stale.
    expect(await claimRebuild(kv)).toBe(true)
  })
})

describe('buildAndWriteAggregates start marker', () => {
  it('records that a rebuild BEGAN, before doing any work', async () => {
    const kv = createMockKV()
    await buildAndWriteAggregates(kv, [])
    const marker = await kv.get(REBUILD_STARTED_KEY, 'json')
    // `recon:agg:last-build` is written at the very END and so cannot report an
    // OOM — the isolate dies first. A start marker with no matching finish is
    // the only in-band evidence that a rebuild died.
    expect(marker).toBeTruthy()
    expect((marker as { startedAt: string }).startedAt).toBeTruthy()
  })
})
