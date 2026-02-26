import { describe, it, expect } from 'vitest'
import {
  getConsolidatedRecon,
  getRepoHealth,
  getScoredIssues,
  getClaims,
  getDossier
} from '../kv-reader'
import {
  createMockKV,
  makeExtendedIssue,
  makeConsolidatedReconData,
  makeClaimRecord,
  makePRSample,
  makeRepoMeta,
  makeComment,
  makeCommentThread
} from './helpers'
import type { RepoHealth, Dossier } from '../types'

describe('getConsolidatedRecon', () => {
  it('returns null when KV key does not exist', async () => {
    const kv = createMockKV()
    const result = await getConsolidatedRecon(kv, 'nonexistent-repo')
    expect(result).toBeNull()
  })

  it('returns consolidated data with all fields', async () => {
    const issue = makeExtendedIssue()
    const meta = makeRepoMeta()
    const merged = [makePRSample()]
    const rejected = [makePRSample({ closedAt: '2024-01-15T00:00:00Z', mergedAt: null })]
    const thread = makeCommentThread([makeComment()])

    const consolidated = makeConsolidatedReconData({
      issues: [issue],
      mergedPrs: merged,
      rejectedPrs: rejected,
      repoMeta: meta,
      comments: { threads: { '100': thread } }
    })

    const kv = createMockKV({ 'recon:fastify-fastify': consolidated })

    const result = await getConsolidatedRecon(kv, 'fastify-fastify')
    expect(result).not.toBeNull()
    expect(result!.issues).toHaveLength(1)
    expect(result!.issues[0].id).toBe(issue.id)
    expect(result!.issues[0].authorAssociation).toBe('NONE')
    expect(result!.mergedPrs).toHaveLength(1)
    expect(result!.mergedPrs[0].number).toBe(101)
    expect(result!.rejectedPrs).toHaveLength(1)
    expect(result!.repoMeta!.owner).toBe('fastify')
    expect(result!.repoMeta!.stars).toBe(30000)
    expect(result!.comments.threads['100'].comments).toHaveLength(1)
    expect(result!.scrapedAt).toBe('2024-01-20T14:45:00Z')
  })

  it('returns data with empty issues array', async () => {
    const consolidated = makeConsolidatedReconData({ issues: [] })
    const kv = createMockKV({ 'recon:fastify-fastify': consolidated })

    const result = await getConsolidatedRecon(kv, 'fastify-fastify')
    expect(result!.issues).toEqual([])
  })

  it('returns data with null repoMeta', async () => {
    const consolidated = makeConsolidatedReconData({ repoMeta: null })
    const kv = createMockKV({ 'recon:fastify-fastify': consolidated })

    const result = await getConsolidatedRecon(kv, 'fastify-fastify')
    expect(result!.repoMeta).toBeNull()
  })

  it('returns errors field when present', async () => {
    const consolidated = makeConsolidatedReconData({
      errors: { issues: 'rate limited' }
    })
    const kv = createMockKV({ 'recon:fastify-fastify': consolidated })

    const result = await getConsolidatedRecon(kv, 'fastify-fastify')
    expect(result!.errors).toEqual({ issues: 'rate limited' })
  })

  it('returns dataTypes array', async () => {
    const consolidated = makeConsolidatedReconData({
      dataTypes: ['issues', 'prs', 'meta', 'comments']
    })
    const kv = createMockKV({ 'recon:fastify-fastify': consolidated })

    const result = await getConsolidatedRecon(kv, 'fastify-fastify')
    expect(result!.dataTypes).toEqual(['issues', 'prs', 'meta', 'comments'])
  })
})

describe('getRepoHealth', () => {
  it('returns null when no data', async () => {
    const kv = createMockKV()
    expect(await getRepoHealth(kv, 'test-repo')).toBeNull()
  })

  it('returns health data from KV', async () => {
    const health: RepoHealth = {
      slug: 'test-repo',
      defaultBranch: 'main',
      maintainerHealthScore: 85,
      mergeAccessibilityScore: 72,
      availabilityScore: 68,
      overallViability: 75,
      killed: false,
      killReason: null,
      detectedQuirks: [],
      prPatterns: {
        medianFilesChanged: 3,
        medianAdditions: 45,
        medianTimeToMergeDays: 4.5,
        mergeStyle: 'squash',
        commitConvention: 'conventional',
        externalContributorMergeRate: 0.65,
        topRejectionReasons: []
      },
      analyzedAt: '2024-01-20T14:45:00Z'
    }
    const kv = createMockKV({ 'recon:test-repo:health': health })

    const result = await getRepoHealth(kv, 'test-repo')
    expect(result!.overallViability).toBe(75)
    expect(result!.killed).toBe(false)
  })
})

describe('getScoredIssues', () => {
  it('returns null when no data', async () => {
    const kv = createMockKV()
    expect(await getScoredIssues(kv, 'test-repo')).toBeNull()
  })
})

describe('getClaims', () => {
  it('returns null when no data', async () => {
    const kv = createMockKV()
    expect(await getClaims(kv, 'test-repo')).toBeNull()
  })

  it('returns claim records from KV', async () => {
    const claims = [makeClaimRecord()]
    const kv = createMockKV({ 'recon:test-repo:claims': claims })

    const result = await getClaims(kv, 'test-repo')
    expect(result).toHaveLength(1)
    expect(result![0].claimedBy).toBe('testuser')
  })
})

describe('getDossier', () => {
  it('returns null when no data', async () => {
    const kv = createMockKV()
    expect(await getDossier(kv, 'test-repo')).toBeNull()
  })

  it('returns dossier from KV', async () => {
    const dossier: Dossier = {
      slug: 'test-repo',
      generatedAt: '2024-01-20T14:45:00Z',
      sections: {
        overview: '# Overview\nTest repo...',
        contributionRules: '# Rules\n...',
        successPatterns: '# Success\n...',
        antiPatterns: '# Anti-Patterns\n...',
        issueBoard: '# Issues\n...',
        environmentSetup: '# Setup\n...'
      }
    }
    const kv = createMockKV({ 'recon:test-repo:dossier': dossier })

    const result = await getDossier(kv, 'test-repo')
    expect(result!.slug).toBe('test-repo')
    expect(result!.sections.overview).toContain('Overview')
  })
})
