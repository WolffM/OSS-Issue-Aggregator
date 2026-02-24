import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReconRoutes } from '../index'
import {
  createMockKV,
  makeExtendedIssue,
  makeReconIssueData,
  makeRepoMeta,
  makePRSample
} from './helpers'

/**
 * Integration tests for recon Hono routes.
 * Uses Hono's built-in test helper (app.request) with a mock KV.
 */

function createTestApp(kv: KVNamespace, scraperApiUrl?: string) {
  const app = createReconRoutes()

  // Wrap with env bindings
  return {
    request: (path: string, init?: RequestInit) => {
      const req = new Request(`http://localhost${path}`, init)
      return app.fetch(req, {
        CACHE_KV: kv,
        SCRAPER_API_URL: scraperApiUrl
      })
    }
  }
}

describe('GET /watchlist', () => {
  it('returns empty watchlist', async () => {
    const app = createTestApp(createMockKV())
    const res = await app.request('/watchlist')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.slugs).toEqual([])
  })

  it('returns populated watchlist', async () => {
    const kv = createMockKV({
      'recon:watchlist': ['fastify-fastify', 'pytorch-pytorch']
    })
    const app = createTestApp(kv)
    const res = await app.request('/watchlist')

    const body = await res.json()
    expect(body.data.slugs).toEqual(['fastify-fastify', 'pytorch-pytorch'])
  })
})

describe('POST /watchlist/add', () => {
  it('adds a slug to the watchlist', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/watchlist/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'fastify-fastify' })
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.slug).toBe('fastify-fastify')
    expect(body.data.added).toBe(true)
  })

  it('normalizes owner/repo format', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/watchlist/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'fastify/fastify' })
    })

    const body = await res.json()
    expect(body.data.slug).toBe('fastify-fastify')
  })

  it('returns 400 for invalid slug', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/watchlist/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: '' })
    })

    expect(res.status).toBe(400)
  })

  it('triggers scraper when SCRAPER_API_URL is configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    const kv = createMockKV()
    const app = createTestApp(kv, 'https://scraper.example.com')

    await app.request('/watchlist/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'fastify-fastify' })
    })

    // Wait a tick for the fire-and-forget to execute
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(mockFetch).toHaveBeenCalledWith(
      'https://scraper.example.com/api/v1/oss-recon/scrape',
      expect.objectContaining({ method: 'POST' })
    )

    vi.restoreAllMocks()
  })
})

describe('POST /watchlist/remove', () => {
  it('removes a slug from the watchlist', async () => {
    const kv = createMockKV({
      'recon:watchlist': ['fastify-fastify']
    })
    const app = createTestApp(kv)

    const res = await app.request('/watchlist/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'fastify-fastify' })
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.removed).toBe(true)
  })
})

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
    const meta = makeRepoMeta({ slug: 'fastify-fastify' })
    const mergedPRs = [
      makePRSample({
        authorAssociation: 'CONTRIBUTOR',
        createdAt: createdDate,
        mergedAt: recentDate
      })
    ]
    const kv = createMockKV({
      'recon:fastify-fastify:repo-meta': meta,
      'recon:fastify-fastify:merged-prs': mergedPRs
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
      'recon:fastify-fastify:issues': makeReconIssueData([issue])
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issues')
    const body = await res.json()
    expect(body.data.issues).toHaveLength(1)
    expect(body.data.issues[0].id).toBe(issue.id)
  })
})

describe('GET /:slug/scored-issues', () => {
  it('returns empty array when no issues exist', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/scored-issues')
    const body = await res.json()
    expect(body.data.issues).toEqual([])
  })

  it('returns issues with computed CVS scores', async () => {
    const issue = makeExtendedIssue()
    const kv = createMockKV({
      'recon:fastify-fastify:issues': makeReconIssueData([issue])
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/scored-issues')
    const body = await res.json()

    expect(body.data.issues).toHaveLength(1)
    const scored = body.data.issues[0]

    // Verify scoring fields are present and reasonable
    expect(typeof scored.cvs).toBe('number')
    expect(scored.cvs).toBeGreaterThanOrEqual(0)
    expect(scored.cvs).toBeLessThanOrEqual(100)
    expect(['go', 'likely', 'maybe', 'risky', 'skip']).toContain(scored.cvsTier)
    expect(['fresh', 'triaged', 'accepted', 'stale', 'zombie']).toContain(scored.lifecycleStage)
    expect(scored.claimStatus).toBe('unclaimed')
    expect(scored.claimAuthor).toBeNull()
    expect(['low', 'medium', 'high']).toContain(scored.complexity)
    expect(typeof scored.sentimentScore).toBe('number')
    expect(typeof scored.contentQualityScore).toBe('number')
    expect(['none', 'low', 'medium', 'high']).toContain(scored.competitionLevel)
    expect(scored.dataCompleteness).toBe('partial') // no health data, no comments
    expect(scored.repoKilled).toBe(false)

    // Verify original issue fields preserved
    expect(scored.id).toBe(issue.id)
    expect(scored.title).toBe(issue.title)
    expect(scored.authorAssociation).toBe('NONE')
  })
})

describe('GET /:slug/dossier', () => {
  it('returns pending when no dossier exists', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/dossier')
    const body = await res.json()
    expect(body.data.status).toBe('pending')
  })

  it('returns compiled dossier when repo meta available', async () => {
    const recentDate = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const createdDate = new Date(Date.now() - 8 * 86_400_000).toISOString()
    const meta = makeRepoMeta({ slug: 'fastify-fastify' })
    const mergedPRs = [
      makePRSample({
        authorAssociation: 'CONTRIBUTOR',
        createdAt: createdDate,
        mergedAt: recentDate
      })
    ]
    const kv = createMockKV({
      'recon:fastify-fastify:repo-meta': meta,
      'recon:fastify-fastify:merged-prs': mergedPRs
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

  it('aggregates issues from multiple repos', async () => {
    const issue1 = makeExtendedIssue({ id: 'issue-1', title: 'Issue A' })
    const issue2 = makeExtendedIssue({ id: 'issue-2', title: 'Issue B' })

    const kv = createMockKV({
      'recon:repo-a:issues': makeReconIssueData([issue1]),
      'recon:repo-b:issues': makeReconIssueData([issue2])
    })
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues')
    const body = await res.json()
    expect(body.data.issues).toHaveLength(2)
    expect(body.data.repoCount).toBe(2)
  })

  it('skips repos with no issue data', async () => {
    const issue = makeExtendedIssue()
    const kv = createMockKV({
      'recon:repo-a:issues': makeReconIssueData([issue]),
      'recon:repo-empty:repo-meta': { owner: 'repo', repo: 'empty' }
    })
    const app = createTestApp(kv)

    const res = await app.request('/all-scored-issues')
    const body = await res.json()
    expect(body.data.issues).toHaveLength(1)
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
  it('returns body field falling back to bodyPreview when body not in KV', async () => {
    const issue = makeExtendedIssue({
      id: 'github-fastify-fastify-100',
      bodyPreview: 'This is the body preview text...'
    })
    const kv = createMockKV({
      'recon:fastify-fastify:issues': makeReconIssueData([issue]),
      'recon:fastify-fastify:repo-meta': makeRepoMeta()
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issue-brief/github-fastify-fastify-100')
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.data.issue.body).toBe('This is the body preview text...')
    expect(json.data.issue.bodyPreview).toBe('This is the body preview text...')
  })

  it('returns body field from KV when scraper provides it', async () => {
    const issue = makeExtendedIssue({
      id: 'github-fastify-fastify-100',
      body: 'Full body text with all the details and code blocks etc.',
      bodyPreview: 'Full body text with all the...'
    })
    const kv = createMockKV({
      'recon:fastify-fastify:issues': makeReconIssueData([issue]),
      'recon:fastify-fastify:repo-meta': makeRepoMeta()
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issue-brief/github-fastify-fastify-100')
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.data.issue.body).toBe('Full body text with all the details and code blocks etc.')
    expect(json.data.issue.bodyPreview).toBe('Full body text with all the...')
  })

  it('returns 404 for unknown issue ID', async () => {
    const issue = makeExtendedIssue({ id: 'github-fastify-fastify-100' })
    const kv = createMockKV({
      'recon:fastify-fastify:issues': makeReconIssueData([issue]),
      'recon:fastify-fastify:repo-meta': makeRepoMeta()
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/issue-brief/nonexistent-id')
    expect(res.status).toBe(404)
  })

  it('returns brief and repoHealth alongside issue', async () => {
    const issue = makeExtendedIssue({ id: 'github-fastify-fastify-100' })
    const kv = createMockKV({
      'recon:fastify-fastify:issues': makeReconIssueData([issue]),
      'recon:fastify-fastify:repo-meta': makeRepoMeta()
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
