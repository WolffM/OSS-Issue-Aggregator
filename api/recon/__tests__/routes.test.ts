import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReconRoutes } from '../index'
import {
  createMockKV,
  createMockExecutionCtx,
  makeExtendedIssue,
  makeConsolidatedReconData,
  makeRepoMeta,
  makeRepoHealth,
  makeScoredIssue,
  makeDossier,
  makeKVEnvelope,
  makePRSample
} from './helpers'

/**
 * Integration tests for recon Hono routes.
 * Uses Hono's built-in test helper (app.request) with a mock KV.
 */

function createTestApp(kv: KVNamespace, scraperApiUrl?: string) {
  const app = createReconRoutes()

  // Wrap with env bindings and mock ExecutionContext
  return {
    request: (path: string, init?: RequestInit) => {
      const req = new Request(`http://localhost${path}`, init)
      return app.fetch(
        req,
        {
          CACHE_KV: kv,
          SCRAPER_API_URL: scraperApiUrl
        },
        createMockExecutionCtx()
      )
    }
  }
}

describe('GET /:slug/health', () => {
  it('returns pending when no health data exists', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/health')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.status).toBe('pending')
  })

  it('returns health data when repo meta and PRs available', async () => {
    const recentDate = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const createdDate = new Date(Date.now() - 8 * 86_400_000).toISOString()
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ slug: 'fastify-fastify' }),
        mergedPrs: [
          makePRSample({
            authorAssociation: 'CONTRIBUTOR',
            createdAt: createdDate,
            mergedAt: recentDate
          })
        ]
      })
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/health')
    const body = await res.json()
    expect(body.data.overallViability).toBeGreaterThan(0)
    expect(body.data.killed).toBe(false)
    expect(body.data.slug).toBe('fastify-fastify')
  })
})

describe('GET /:slug/issues', () => {
  it('returns empty array when no issues exist', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issues')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.issues).toEqual([])
    expect(body.data.slug).toBe('fastify-fastify')
  })

  it('returns issues from KV', async () => {
    const issue = makeExtendedIssue()
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({ issues: [issue] })
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issues')
    const body = await res.json()
    expect(body.data.issues).toHaveLength(1)
    expect(body.data.issues[0].id).toBe(issue.id)
  })
})

describe('GET /:slug/scored-issues', () => {
  it('returns pending when no pre-computed data exists', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/scored-issues')
    const body = await res.json()
    expect(body.data.status).toBe('pending')
  })

  it('returns pre-computed scored issues from KV', async () => {
    const scored = makeScoredIssue()
    const kv = createMockKV({
      'recon:fastify-fastify:scored-issues': [scored]
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/scored-issues')
    const body = await res.json()

    expect(body.data.issues).toHaveLength(1)
    expect(body.data.issues[0].id).toBe(scored.id)
    expect(body.data.issues[0].cvs).toBe(scored.cvs)
    expect(body.data.slug).toBe('fastify-fastify')
  })
})

describe('GET /:slug/dossier', () => {
  it('returns pending when no pre-computed dossier exists', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/dossier')
    const body = await res.json()
    expect(body.data.status).toBe('pending')
  })

  it('returns pending when only consolidated data available (no pre-computed dossier)', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/dossier')
    const body = await res.json()
    expect(body.data.status).toBe('pending')
  })

  it('returns pre-computed dossier from KV', async () => {
    const dossier = {
      slug: 'fastify-fastify',
      generatedAt: new Date().toISOString(),
      sections: {
        overview: '## Overview',
        contributionRules: '## Contribution Rules',
        successPatterns: '## Success Patterns',
        antiPatterns: '## Anti-Patterns',
        issueBoard: '## Issue Board',
        environmentSetup: '## Environment Setup'
      }
    }
    const kv = createMockKV({
      'recon:fastify-fastify:dossier': dossier
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/dossier')
    const body = await res.json()
    expect(body.data.slug).toBe('fastify-fastify')
    expect(body.data.generatedAt).toBeDefined()
    expect(body.data.sections).toHaveProperty('overview')
    expect(body.data.sections).toHaveProperty('contributionRules')
    expect(body.data.sections).toHaveProperty('successPatterns')
    expect(body.data.sections).toHaveProperty('antiPatterns')
    expect(body.data.sections).toHaveProperty('issueBoard')
    expect(body.data.sections).toHaveProperty('environmentSetup')
  })
})

describe('GET /all-scored-issues', () => {
  it('returns empty when no repos have data', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues')
    const body = await res.json()
    expect(body.data.issues).toEqual([])
    expect(body.data.totalCount).toBe(0)
    expect(body.data.repoCount).toBe(0)
  })

  it('aggregates pre-computed issues from multiple repos', async () => {
    const scored1 = makeScoredIssue({ id: 'issue-1', title: 'Issue A', repoSlug: 'repo-a' })
    const scored2 = makeScoredIssue({ id: 'issue-2', title: 'Issue B', repoSlug: 'repo-b' })

    const kv = createMockKV({
      'recon:repo-a': makeConsolidatedReconData(),
      'recon:repo-b': makeConsolidatedReconData(),
      'recon:repo-a:scored-issues': [scored1],
      'recon:repo-b:scored-issues': [scored2]
    })
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues')
    const body = await res.json()
    expect(body.data.issues).toHaveLength(2)
    expect(body.data.repoCount).toBe(2)
  })

  it('skips repos without pre-computed scored issues', async () => {
    const scored = makeScoredIssue({ repoSlug: 'repo-a' })
    const kv = createMockKV({
      'recon:repo-a': makeConsolidatedReconData(),
      'recon:repo-a:scored-issues': [scored],
      'recon:repo-empty': makeConsolidatedReconData()
    })
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues')
    const body = await res.json()
    expect(body.data.issues).toHaveLength(1)
  })

  it('strips heavy fields to reduce payload size', async () => {
    const scored = makeScoredIssue({ id: 'issue-1', repoSlug: 'repo-a' })
    const kv = createMockKV({
      'recon:repo-a': makeConsolidatedReconData(),
      'recon:repo-a:scored-issues': [scored]
    })
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues')
    const body = await res.json()
    const issue = body.data.issues[0]

    // Essential fields must be present
    expect(issue.id).toBe('issue-1')
    expect(issue.cvs).toBeDefined()
    expect(issue.cvsTier).toBeDefined()
    expect(issue.repoSlug).toBe('repo-a')
    expect(issue.title).toBeDefined()

    // Heavy fields must be stripped
    expect(issue.sentimentSignals).toBeUndefined()
    expect(issue.commentDigest).toBeUndefined()
    expect(issue.likelyFiles).toBeUndefined()
    expect(issue.relatedIssues).toBeUndefined()
    expect(issue._scoring).toBeUndefined()
    expect(issue.bodyPreview).toBeUndefined()
    expect(issue.linkedPrUrls).toBeUndefined()
    expect(issue.assignees).toBeUndefined()
    expect(issue.difficultySignals).toBeUndefined()
    expect(issue.body).toBeUndefined()
    expect(issue.reactionGroups).toBeUndefined()
  })
})

describe('POST /:slug/refresh', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 500 when SCRAPER_API_URL is not configured', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv) // no scraperApiUrl

    const res = await app.request('/fastify-fastify/refresh', { method: 'POST' })
    expect(res.status).toBe(500)
  })

  it('triggers scraper and returns success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    const kv = createMockKV()
    const app = createTestApp(kv, 'https://scraper.example.com')

    const res = await app.request('/fastify-fastify/refresh', { method: 'POST' })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.status).toBe('triggered')
  })
})

describe('GET /:slug/issue-brief/:issueId', () => {
  it('returns pending when no pre-computed data exists', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issue-brief/github-fastify-fastify-100')
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.data.status).toBe('pending')
  })

  it('returns body field falling back to bodyPreview when body not in KV', async () => {
    const scored = makeScoredIssue({
      id: 'github-fastify-fastify-100',
      bodyPreview: 'This is the body preview text...'
    })
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData(),
      'recon:fastify-fastify:scored-issues': [scored],
      'recon:fastify-fastify:health': makeRepoHealth()
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issue-brief/github-fastify-fastify-100')
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.data.issue.body).toBe('This is the body preview text...')
    expect(json.data.issue.bodyPreview).toBe('This is the body preview text...')
  })

  it('returns body field from KV when scraper provides it', async () => {
    const scored = makeScoredIssue({
      id: 'github-fastify-fastify-100',
      body: 'Full body text with all the details and code blocks etc.',
      bodyPreview: 'Full body text with all the...'
    })
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData(),
      'recon:fastify-fastify:scored-issues': [scored],
      'recon:fastify-fastify:health': makeRepoHealth()
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issue-brief/github-fastify-fastify-100')
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.data.issue.body).toBe('Full body text with all the details and code blocks etc.')
    expect(json.data.issue.bodyPreview).toBe('Full body text with all the...')
  })

  it('returns 404 when the ID is in neither scored-issues nor raw consolidated data', async () => {
    const scored = makeScoredIssue({ id: 'github-fastify-fastify-100' })
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData(),
      'recon:fastify-fastify:scored-issues': [scored],
      'recon:fastify-fastify:health': makeRepoHealth()
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issue-brief/github-fastify-fastify-999')
    expect(res.status).toBe(404)

    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('github-fastify-fastify-999')
  })

  it('falls back to raw consolidated data when issue is absent from scored-issues', async () => {
    const agedOut = makeExtendedIssue({
      id: 'github-fastify-fastify-777',
      title: 'Aged-out bug report',
      bodyPreview: 'Original report body...',
      labels: ['bug']
    })
    const inScored = makeScoredIssue({ id: 'github-fastify-fastify-100' })
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        issues: [makeExtendedIssue({ id: 'github-fastify-fastify-100' }), agedOut]
      }),
      'recon:fastify-fastify:scored-issues': [inScored],
      'recon:fastify-fastify:health': makeRepoHealth()
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issue-brief/github-fastify-fastify-777')
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.issue.id).toBe('github-fastify-fastify-777')
    expect(json.data.issue.title).toBe('Aged-out bug report')
    expect(json.data.issue.dataCompleteness).toBe('raw')
    expect(json.data.issue._scoring.data_completeness).toBe('raw')
    expect(json.data.issue._scoring.signals_used).toEqual([])
    expect(json.data.issue.cvs).toBe(0)
    // Brief still includes repo-level rules even without scoring
    expect(json.data.brief).toContain('# Task: Aged-out bug report')
    expect(json.data.brief).toContain('## CRITICAL RULES')
    expect(json.data.brief).toContain('## Contribution Rules')
    expect(json.data.repoHealth).toBeDefined()
    // _meta for raw fallback: scraped_at present, computed_at null
    expect(json._meta.scraped_at).toBeTruthy()
    expect(json._meta.computed_at).toBeNull()
  })

  it('POST /:slug/compose-brief composes a brief from a caller-supplied raw issue', async () => {
    // Simulates vibedispatch: they snapshotted an issue at shortlist time.
    // Later, the scraper has re-scraped and this issue is no longer in
    // scored-issues OR consolidated.issues. They POST the snapshot; the
    // aggregator composes a brief using live repo-level health/meta.
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        issues: [] // snapshot issue is gone from raw data
      }),
      'recon:fastify-fastify:scored-issues': [],
      'recon:fastify-fastify:health': makeRepoHealth()
    })
    const app = createTestApp(kv)

    const snapshot = makeExtendedIssue({
      id: 'github-fastify-fastify-7777',
      title: 'Snapshot-supplied bug',
      bodyPreview: 'Body captured at shortlist time',
      labels: ['bug']
    })

    const res = await app.request('/fastify-fastify/compose-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: snapshot })
    })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.issue.id).toBe('github-fastify-fastify-7777')
    expect(json.data.issue.title).toBe('Snapshot-supplied bug')
    expect(json.data.issue.dataCompleteness).toBe('raw')
    expect(json.data.brief).toContain('# Task: Snapshot-supplied bug')
    expect(json.data.brief).toContain('## CRITICAL RULES')
    expect(json.data.brief).toContain('## Contribution Rules')
    expect(json.data.repoHealth.slug).toBe('fastify-fastify')
    expect(json._meta.computed_at).toBeNull()
  })

  it('POST /:slug/compose-brief returns pending when health or meta is missing', async () => {
    const kv = createMockKV({
      // only raw recon exists, no health
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    const app = createTestApp(kv)
    const snapshot = makeExtendedIssue({ id: 'github-fastify-fastify-7777' })

    const res = await app.request('/fastify-fastify/compose-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: snapshot })
    })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.data.status).toBe('pending')
  })

  it('POST /:slug/compose-brief applies claim overlay to snapshot issue', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({ issues: [] }),
      'recon:fastify-fastify:health': makeRepoHealth(),
      'recon:fastify-fastify:claims': [
        {
          issueId: 'github-fastify-fastify-7777',
          claimedBy: 'claimer',
          claimedAt: new Date().toISOString(),
          forkIssueUrl: null
        }
      ]
    })
    const app = createTestApp(kv)
    const snapshot = makeExtendedIssue({ id: 'github-fastify-fastify-7777' })

    const res = await app.request('/fastify-fastify/compose-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: snapshot })
    })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.data.issue.claimStatus).toBe('claimed')
    expect(json.data.issue.claimAuthor).toBe('claimer')
  })

  it('applies claim overlay to raw-fallback issue', async () => {
    const agedOut = makeExtendedIssue({ id: 'github-fastify-fastify-777' })
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({ issues: [agedOut] }),
      'recon:fastify-fastify:scored-issues': [],
      'recon:fastify-fastify:health': makeRepoHealth(),
      'recon:fastify-fastify:claims': [
        {
          issueId: 'github-fastify-fastify-777',
          claimedBy: 'claimer',
          claimedAt: new Date().toISOString(),
          forkIssueUrl: null
        }
      ]
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issue-brief/github-fastify-fastify-777')
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.data.issue.claimStatus).toBe('claimed')
    expect(json.data.issue.claimAuthor).toBe('claimer')
    expect(json.data.issue.dataCompleteness).toBe('raw')
  })

  it('returns 400 for a malformed issue ID (e.g. bare issue number)', async () => {
    const scored = makeScoredIssue({ id: 'github-fastify-fastify-100' })
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData(),
      'recon:fastify-fastify:scored-issues': [scored],
      'recon:fastify-fastify:health': makeRepoHealth()
    })
    const app = createTestApp(kv)

    // Bare issue number — the format the crimson-kitty consumer was sending.
    const res = await app.request('/fastify-fastify/issue-brief/100')
    expect(res.status).toBe(400)
  })

  it('returns brief and repoHealth alongside issue', async () => {
    const scored = makeScoredIssue({ id: 'github-fastify-fastify-100' })
    const health = makeRepoHealth()
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData(),
      'recon:fastify-fastify:scored-issues': [scored],
      'recon:fastify-fastify:health': health
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issue-brief/github-fastify-fastify-100')
    const json = await res.json()

    expect(json.data.brief).toContain('# Task:')
    expect(json.data.repoHealth).toBeDefined()
    expect(json.data.repoHealth.slug).toBe('fastify-fastify')
  })
})

describe('POST /:slug/claim', () => {
  it('creates a claim record', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issueId: 'github-fastify-fastify-100',
        claimedBy: 'testuser'
      })
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.issueId).toBe('github-fastify-fastify-100')
    expect(body.data.claimedBy).toBe('testuser')
    expect(body.data.claimedAt).toBeTruthy()
  })
})

describe('POST /:slug/unclaim', () => {
  it('removes a claim', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify:claims': [
        {
          issueId: 'github-fastify-fastify-100',
          claimedBy: 'testuser',
          claimedAt: '2024-01-20T00:00:00Z',
          forkIssueUrl: null
        }
      ]
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/unclaim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueId: 'github-fastify-fastify-100' })
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.removed).toBe(true)
  })

  it('returns removed: false for non-existent claim', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/unclaim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueId: 'nonexistent' })
    })

    const body = await res.json()
    expect(body.data.removed).toBe(false)
  })
})

// ============================================================================
// _meta on all route responses
// ============================================================================

describe('_meta freshness metadata', () => {
  function expectMeta(meta: Record<string, unknown>) {
    expect(meta).toBeDefined()
    expect(typeof meta.served_at).toBe('string')
    expect(new Date(meta.served_at as string).getTime()).not.toBeNaN()
  }

  describe('data routes with enveloped KV', () => {
    it('GET /:slug/health includes _meta from envelope', async () => {
      const health = makeRepoHealth()
      const envelope = makeKVEnvelope(health, {
        scraped_at: '2024-06-01T00:00:00Z',
        computed_at: '2024-06-01T01:00:00Z'
      })
      const kv = createMockKV({ 'recon:fastify-fastify:health': envelope })
      const app = createTestApp(kv)

      const res = await app.request('/fastify-fastify/health')
      const body = await res.json()

      expectMeta(body._meta)
      expect(body._meta.scraped_at).toBe('2024-06-01T00:00:00Z')
      expect(body._meta.computed_at).toBe('2024-06-01T01:00:00Z')
    })

    it('GET /:slug/health fallback has _meta with null scraped_at', async () => {
      // No pre-computed health — falls back to on-the-fly computation
      const recentDate = new Date(Date.now() - 5 * 86_400_000).toISOString()
      const kv = createMockKV({
        'recon:fastify-fastify': makeConsolidatedReconData({
          repoMeta: makeRepoMeta(),
          mergedPrs: [makePRSample({ mergedAt: recentDate, createdAt: recentDate })]
        })
      })
      const app = createTestApp(kv)

      const res = await app.request('/fastify-fastify/health')
      const body = await res.json()

      expectMeta(body._meta)
      expect(body._meta.scraped_at).toBeNull()
      expect(body._meta.computed_at).toBeNull()
    })

    it('GET /:slug/issues includes _meta with scraped_at from consolidated', async () => {
      const kv = createMockKV({
        'recon:fastify-fastify': makeConsolidatedReconData({
          scrapedAt: '2024-06-01T00:00:00Z'
        })
      })
      const app = createTestApp(kv)

      const res = await app.request('/fastify-fastify/issues')
      const body = await res.json()

      expectMeta(body._meta)
      expect(body._meta.scraped_at).toBe('2024-06-01T00:00:00Z')
      expect(body._meta.computed_at).toBeNull()
    })

    it('GET /:slug/scored-issues includes _meta from envelope', async () => {
      const scored = makeScoredIssue()
      const envelope = makeKVEnvelope([scored], {
        scraped_at: '2024-06-01T00:00:00Z',
        computed_at: '2024-06-01T01:00:00Z'
      })
      const kv = createMockKV({ 'recon:fastify-fastify:scored-issues': envelope })
      const app = createTestApp(kv)

      const res = await app.request('/fastify-fastify/scored-issues')
      const body = await res.json()

      expectMeta(body._meta)
      expect(body._meta.scraped_at).toBe('2024-06-01T00:00:00Z')
      expect(body._meta.computed_at).toBe('2024-06-01T01:00:00Z')
    })

    it('GET /:slug/dossier includes _meta from envelope', async () => {
      const dossier = makeDossier()
      const envelope = makeKVEnvelope(dossier, {
        scraped_at: '2024-06-01T00:00:00Z',
        computed_at: '2024-06-01T01:00:00Z'
      })
      const kv = createMockKV({ 'recon:fastify-fastify:dossier': envelope })
      const app = createTestApp(kv)

      const res = await app.request('/fastify-fastify/dossier')
      const body = await res.json()

      expectMeta(body._meta)
      expect(body._meta.scraped_at).toBe('2024-06-01T00:00:00Z')
      expect(body._meta.computed_at).toBe('2024-06-01T01:00:00Z')
    })

    it('GET /:slug/issue-brief/:issueId includes _meta from scored-issues envelope', async () => {
      const scored = makeScoredIssue({ id: 'github-fastify-fastify-100' })
      const health = makeRepoHealth()
      const scoredEnvelope = makeKVEnvelope([scored], {
        scraped_at: '2024-06-01T00:00:00Z',
        computed_at: '2024-06-01T01:00:00Z'
      })
      const healthEnvelope = makeKVEnvelope(health)
      const kv = createMockKV({
        'recon:fastify-fastify': makeConsolidatedReconData(),
        'recon:fastify-fastify:scored-issues': scoredEnvelope,
        'recon:fastify-fastify:health': healthEnvelope
      })
      const app = createTestApp(kv)

      const res = await app.request('/fastify-fastify/issue-brief/github-fastify-fastify-100')
      const body = await res.json()

      expectMeta(body._meta)
      expect(body._meta.scraped_at).toBe('2024-06-01T00:00:00Z')
      expect(body._meta.computed_at).toBe('2024-06-01T01:00:00Z')
    })
  })

  describe('all-scored-issues timestamp aggregation', () => {
    it('uses oldest scraped_at and computed_at across repos', async () => {
      const scored1 = makeScoredIssue({ id: 'issue-1', repoSlug: 'repo-a' })
      const scored2 = makeScoredIssue({ id: 'issue-2', repoSlug: 'repo-b' })

      const envelope1 = makeKVEnvelope([scored1], {
        scraped_at: '2024-06-01T00:00:00Z',
        computed_at: '2024-06-01T01:00:00Z'
      })
      const envelope2 = makeKVEnvelope([scored2], {
        scraped_at: '2024-05-15T00:00:00Z',
        computed_at: '2024-05-15T01:00:00Z'
      })

      const kv = createMockKV({
        'recon:repo-a': makeConsolidatedReconData(),
        'recon:repo-b': makeConsolidatedReconData(),
        'recon:repo-a:scored-issues': envelope1,
        'recon:repo-b:scored-issues': envelope2
      })
      const app = createTestApp(kv)

      const res = await app.request('/all-scored-issues')
      const body = await res.json()

      expectMeta(body._meta)
      // Oldest scraped_at should win
      expect(body._meta.scraped_at).toBe('2024-05-15T00:00:00Z')
      expect(body._meta.computed_at).toBe('2024-05-15T01:00:00Z')
    })

    it('handles mix of enveloped and bare data for timestamp aggregation', async () => {
      const scored1 = makeScoredIssue({ id: 'issue-1', repoSlug: 'repo-a' })
      const scored2 = makeScoredIssue({ id: 'issue-2', repoSlug: 'repo-b' })

      // repo-a has envelope, repo-b has bare data
      const envelope1 = makeKVEnvelope([scored1], {
        scraped_at: '2024-06-01T00:00:00Z',
        computed_at: '2024-06-01T01:00:00Z'
      })

      const kv = createMockKV({
        'recon:repo-a': makeConsolidatedReconData(),
        'recon:repo-b': makeConsolidatedReconData(),
        'recon:repo-a:scored-issues': envelope1,
        'recon:repo-b:scored-issues': [scored2] // bare array
      })
      const app = createTestApp(kv)

      const res = await app.request('/all-scored-issues')
      const body = await res.json()

      expectMeta(body._meta)
      // Should have scraped_at from the one repo that has it
      expect(body._meta.scraped_at).toBe('2024-06-01T00:00:00Z')
    })

    it('returns null timestamps when no repos have envelope data', async () => {
      const kv = createMockKV()
      const app = createTestApp(kv)

      const res = await app.request('/all-scored-issues')
      const body = await res.json()

      expectMeta(body._meta)
      expect(body._meta.scraped_at).toBeNull()
      expect(body._meta.computed_at).toBeNull()
    })
  })
})

// ============================================================================
// Pagination via pre-aggregated KV keys
// ============================================================================

describe('GET /all-scored-issues (paginated with aggregate KV)', () => {
  function setupAggregateKV() {
    // 5 issues with different CVS scores and titles
    const issues = [
      {
        id: 'i1',
        cvs: 90,
        title: 'Alpha',
        repoSlug: 'r-a',
        sentimentScore: 0.5,
        lifecycleStage: 'fresh' as const,
        complexity: 'low' as const,
        competitionLevel: 'none' as const,
        createdAt: '2024-01-01T00:00:00Z'
      },
      {
        id: 'i2',
        cvs: 70,
        title: 'Bravo',
        repoSlug: 'r-b',
        sentimentScore: 0.3,
        lifecycleStage: 'triaged' as const,
        complexity: 'medium' as const,
        competitionLevel: 'low' as const,
        createdAt: '2024-02-01T00:00:00Z'
      },
      {
        id: 'i3',
        cvs: 80,
        title: 'Charlie',
        repoSlug: 'r-a',
        sentimentScore: -0.2,
        lifecycleStage: 'accepted' as const,
        complexity: 'high' as const,
        competitionLevel: 'medium' as const,
        createdAt: '2024-03-01T00:00:00Z'
      },
      {
        id: 'i4',
        cvs: 60,
        title: 'Delta',
        repoSlug: 'r-c',
        sentimentScore: 0.8,
        lifecycleStage: 'stale' as const,
        complexity: 'low' as const,
        competitionLevel: 'high' as const,
        createdAt: '2024-04-01T00:00:00Z'
      },
      {
        id: 'i5',
        cvs: 85,
        title: 'Echo',
        repoSlug: 'r-b',
        sentimentScore: 0.0,
        lifecycleStage: 'zombie' as const,
        complexity: 'medium' as const,
        competitionLevel: 'none' as const,
        createdAt: '2024-05-01T00:00:00Z'
      }
    ].map(overrides => {
      const s = makeScoredIssue(overrides)
      // Strip heavy fields to simulate what buildAndWriteAggregates stores
      const {
        body: _,
        reactionGroups: _rg,
        sentimentSignals: _ss,
        commentDigest: _cd,
        likelyFiles: _lf,
        relatedIssues: _ri,
        _scoring: _sc,
        difficultySignals: _ds,
        bodyPreview: _bp,
        linkedPrUrls: _lp,
        assignees: _as,
        ...slim
      } = s
      return slim
    })

    // Pre-sort: ascending CVS = [60, 70, 80, 85, 90]
    const byCvs = [...issues].sort((a, b) => a.cvs - b.cvs)
    const byTitle = [...issues].sort((a, b) => a.title.localeCompare(b.title))

    const versionMeta = {
      version: Date.now(),
      repoCount: 3,
      totalCount: 5,
      projects: [
        { slug: 'r-a', name: 'org/repo-a' },
        { slug: 'r-b', name: 'org/repo-b' },
        { slug: 'r-c', name: 'org/repo-c' }
      ]
    }

    const kv = createMockKV({
      'recon:agg:cvs': byCvs,
      'recon:agg:title': byTitle,
      'recon:agg:v': versionMeta
    })
    return { kv, issues, byCvs, byTitle, versionMeta }
  }

  it('returns paginated results with limit param', async () => {
    const { kv } = setupAggregateKV()
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues?sort=cvs&dir=desc&offset=0&limit=2')
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.issues).toHaveLength(2)
    expect(body.data.totalCount).toBe(5)
    expect(body.data.repoCount).toBe(3)
    expect(body.data.hasMore).toBe(true)
    expect(body.data.offset).toBe(0)

    // desc CVS: highest first
    expect(body.data.issues[0].cvs).toBe(90)
    expect(body.data.issues[1].cvs).toBe(85)
  })

  it('returns correct page with offset', async () => {
    const { kv } = setupAggregateKV()
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues?sort=cvs&dir=desc&offset=3&limit=2')
    const body = await res.json()

    expect(body.data.issues).toHaveLength(2)
    expect(body.data.hasMore).toBe(false)

    // desc CVS offset=3: [70, 60]
    expect(body.data.issues[0].cvs).toBe(70)
    expect(body.data.issues[1].cvs).toBe(60)
  })

  it('returns hasMore=false when offset exceeds total', async () => {
    const { kv } = setupAggregateKV()
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues?sort=cvs&dir=desc&offset=10&limit=2')
    const body = await res.json()

    expect(body.data.issues).toHaveLength(0)
    expect(body.data.hasMore).toBe(false)
  })

  it('sorts by title ascending', async () => {
    const { kv } = setupAggregateKV()
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues?sort=title&dir=asc&limit=5')
    const body = await res.json()

    expect(body.data.issues[0].title).toBe('Alpha')
    expect(body.data.issues[4].title).toBe('Echo')
  })

  it('returns all issues when limit is not provided (backward compat)', async () => {
    const { kv } = setupAggregateKV()
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues')
    const body = await res.json()

    expect(body.data.issues).toHaveLength(5)
    expect(body.data.totalCount).toBe(5)
    expect(body.data.hasMore).toBeUndefined()
    expect(body.data.offset).toBeUndefined()
  })

  it('falls back to N+1 reads when aggregate KV keys are missing', async () => {
    const scored = makeScoredIssue({ id: 'issue-1', repoSlug: 'repo-a' })
    const kv = createMockKV({
      'recon:repo-a': makeConsolidatedReconData(),
      'recon:repo-a:scored-issues': [scored]
      // No recon:agg:* keys
    })
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues?sort=cvs&dir=desc&limit=10')
    const body = await res.json()

    // Fallback still works, returns all issues
    expect(body.data.issues).toHaveLength(1)
    expect(body.data.issues[0].id).toBe('issue-1')
  })

  it('fallback path respects sort and dir params', async () => {
    const issueA = makeScoredIssue({
      id: 'a',
      title: 'Alpha',
      cvs: 60,
      repoSlug: 'repo-a'
    })
    const issueB = makeScoredIssue({
      id: 'b',
      title: 'Bravo',
      cvs: 90,
      repoSlug: 'repo-a'
    })
    const issueC = makeScoredIssue({
      id: 'c',
      title: 'Charlie',
      cvs: 75,
      repoSlug: 'repo-a'
    })
    const kv = createMockKV({
      'recon:repo-a': makeConsolidatedReconData(),
      'recon:repo-a:scored-issues': [issueA, issueB, issueC]
      // No recon:agg:* keys — forces fallback
    })
    const app = createTestApp(kv)

    // Sort by title ascending
    const resAsc = await app.request('/all-scored-issues?sort=title&dir=asc&limit=10')
    const bodyAsc = await resAsc.json()
    expect(bodyAsc.data.issues.map((i: { title: string }) => i.title)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie'
    ])

    // Sort by title descending
    const resDesc = await app.request('/all-scored-issues?sort=title&dir=desc&limit=10')
    const bodyDesc = await resDesc.json()
    expect(bodyDesc.data.issues.map((i: { title: string }) => i.title)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha'
    ])

    // Sort by CVS ascending
    const resCvsAsc = await app.request('/all-scored-issues?sort=cvs&dir=asc&limit=10')
    const bodyCvsAsc = await resCvsAsc.json()
    expect(bodyCvsAsc.data.issues.map((i: { cvs: number }) => i.cvs)).toEqual([60, 75, 90])

    // Sort by CVS descending
    const resCvsDesc = await app.request('/all-scored-issues?sort=cvs&dir=desc&limit=10')
    const bodyCvsDesc = await resCvsDesc.json()
    expect(bodyCvsDesc.data.issues.map((i: { cvs: number }) => i.cvs)).toEqual([90, 75, 60])
  })

  it('includes Cache-Control header when serving from aggregate', async () => {
    const { kv } = setupAggregateKV()
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues?sort=cvs&dir=desc&limit=2')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=120, stale-while-revalidate=300')
  })

  it('clamps limit to 500', async () => {
    const { kv } = setupAggregateKV()
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues?sort=cvs&dir=desc&limit=1000')
    const body = await res.json()

    // Should return all 5 (limit clamped to 500, total is 5)
    expect(body.data.issues).toHaveLength(5)
  })

  it('defaults invalid sort to cvs', async () => {
    const { kv } = setupAggregateKV()
    const app = createTestApp(kv)

    // 'invalid' is not a valid sort field, should fall back to cvs
    // But recon:agg:invalid won't exist, so it falls through to N+1
    // However recon:agg:cvs does exist when using default 'cvs'
    const res = await app.request('/all-scored-issues?sort=cvs&dir=desc&limit=2')
    const body = await res.json()
    expect(body.data.issues[0].cvs).toBe(90)
  })

  function setupAggregateKVWithKilled() {
    // 4 issues: 2 from a live repo r-live, 2 from a killed repo r-dead.
    const raw = [
      { id: 'L1', repoSlug: 'r-live', title: 'Live 1', cvs: 80, repoKilled: false },
      { id: 'L2', repoSlug: 'r-live', title: 'Live 2', cvs: 70, repoKilled: false },
      { id: 'D1', repoSlug: 'r-dead', title: 'Dead 1', cvs: 0, repoKilled: true },
      { id: 'D2', repoSlug: 'r-dead', title: 'Dead 2', cvs: 0, repoKilled: true }
    ].map(o => {
      const s = makeScoredIssue(o)
      const {
        body: _b,
        reactionGroups: _rg,
        sentimentSignals: _ss,
        commentDigest: _cd,
        likelyFiles: _lf,
        relatedIssues: _ri,
        _scoring: _sc,
        difficultySignals: _ds,
        bodyPreview: _bp,
        linkedPrUrls: _lp,
        assignees: _as,
        ...slim
      } = s
      return slim
    })
    const byCvs = [...raw].sort((a, b) => a.cvs - b.cvs)
    const versionMeta = {
      version: Date.now(),
      repoCount: 2,
      totalCount: 4,
      projects: [
        { slug: 'r-live', name: 'org/r-live' },
        { slug: 'r-dead', name: 'org/r-dead' }
      ]
    }
    return createMockKV({
      'recon:agg:cvs': byCvs,
      'recon:agg:v': versionMeta
    })
  }

  it('filters out killed repos by default', async () => {
    const kv = setupAggregateKVWithKilled()
    const app = createTestApp(kv)
    const res = await app.request('/all-scored-issues?sort=cvs&dir=desc')
    const body = await res.json()

    const slugs = body.data.issues.map((i: { repoSlug: string }) => i.repoSlug)
    expect(slugs).not.toContain('r-dead')
    expect(body.data.totalCount).toBe(2)
    expect(body.data.repoCount).toBe(1)
  })

  it('includes killed repos when includeKilled=true', async () => {
    const kv = setupAggregateKVWithKilled()
    const app = createTestApp(kv)
    const res = await app.request('/all-scored-issues?sort=cvs&dir=desc&includeKilled=true')
    const body = await res.json()

    const slugs = new Set(body.data.issues.map((i: { repoSlug: string }) => i.repoSlug))
    expect(slugs.has('r-dead')).toBe(true)
    expect(slugs.has('r-live')).toBe(true)
    expect(body.data.totalCount).toBe(4)
    expect(body.data.repoCount).toBe(2)
  })
})

describe('GET /all-scored-issues/version', () => {
  it('returns version metadata with projects when aggregate has been built', async () => {
    const projects = [
      { slug: 'fastify-fastify', name: 'fastify/fastify' },
      { slug: 'vercel-next.js', name: 'vercel/next.js' }
    ]
    const kv = createMockKV({
      'recon:agg:v': { version: 1700000000000, repoCount: 10, totalCount: 500, projects }
    })
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues/version')
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.version).toBe(1700000000000)
    expect(body.data.repoCount).toBe(10)
    expect(body.data.totalCount).toBe(500)
    expect(body.data.projects).toHaveLength(2)
    expect(body.data.projects[0]).toEqual({ slug: 'fastify-fastify', name: 'fastify/fastify' })
  })

  it('returns zeros and empty projects when no aggregate exists', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues/version')
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.version).toBe(0)
    expect(body.data.repoCount).toBe(0)
    expect(body.data.totalCount).toBe(0)
    expect(body.data.projects).toEqual([])
  })
})
