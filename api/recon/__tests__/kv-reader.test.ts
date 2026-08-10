import { describe, it, expect } from 'vitest'
import {
  getConsolidatedRecon,
  getRepoHealth,
  getScoredIssues,
  getClaims,
  getDossier,
  getRepoHealthEnveloped,
  getScoredIssuesEnveloped,
  getDossierEnveloped
} from '../kv-reader'
import {
  createMockKV,
  makeExtendedIssue,
  makeConsolidatedReconData,
  makeClaimRecord,
  makePRSample,
  makeRepoMeta,
  makeComment,
  makeCommentThread,
  makeRepoHealth,
  makeScoredIssue,
  makeDossier,
  makeKVEnvelope
} from './helpers'
import type { RepoHealth, Dossier, KVEnvelope } from '../types'

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
      // Required by RepoHealth. Omitted here since the fixture was written by
      // hand rather than via makeRepoHealth(), so the field was simply missed.
      language: 'TypeScript',
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
      },
      completeness: {
        overview: true,
        contributionRules: true,
        successPatterns: true,
        antiPatterns: true,
        issueBoard: true,
        environmentSetup: true,
        score: 6,
        total: 6
      }
    }
    const kv = createMockKV({ 'recon:test-repo:dossier': dossier })

    const result = await getDossier(kv, 'test-repo')
    expect(result!.slug).toBe('test-repo')
    expect(result!.sections.overview).toContain('Overview')
  })
})

// ============================================================================
// Enveloped KV Readers
// ============================================================================

describe('getRepoHealthEnveloped', () => {
  it('returns null when no data', async () => {
    const kv = createMockKV()
    expect(await getRepoHealthEnveloped(kv, 'test-repo')).toBeNull()
  })

  it('reads new envelope format with scraped_at and computed_at', async () => {
    const health = makeRepoHealth({ slug: 'test-repo' })
    const envelope = makeKVEnvelope(health, {
      scraped_at: '2024-06-01T00:00:00Z',
      computed_at: '2024-06-01T01:00:00Z'
    })
    const kv = createMockKV({ 'recon:test-repo:health': envelope })

    const result = await getRepoHealthEnveloped(kv, 'test-repo')
    expect(result).not.toBeNull()
    expect(result!.data.slug).toBe('test-repo')
    expect(result!.data.overallViability).toBe(65)
    expect(result!.scraped_at).toBe('2024-06-01T00:00:00Z')
    expect(result!.computed_at).toBe('2024-06-01T01:00:00Z')
  })

  it('falls back to bare data for pre-migration KV entries', async () => {
    // Bare RepoHealth (no envelope wrapper) — simulates pre-migration data
    const health = makeRepoHealth({ slug: 'test-repo', analyzedAt: '2024-03-15T12:00:00Z' })
    const kv = createMockKV({ 'recon:test-repo:health': health })

    const result = await getRepoHealthEnveloped(kv, 'test-repo')
    expect(result).not.toBeNull()
    expect(result!.data.slug).toBe('test-repo')
    expect(result!.scraped_at).toBeNull()
    // Should extract computed_at from analyzedAt field
    expect(result!.computed_at).toBe('2024-03-15T12:00:00Z')
  })
})

describe('getScoredIssuesEnveloped', () => {
  it('returns null when no data', async () => {
    const kv = createMockKV()
    expect(await getScoredIssuesEnveloped(kv, 'test-repo')).toBeNull()
  })

  it('reads new envelope format', async () => {
    const issues = [makeScoredIssue({ id: 'issue-1' }), makeScoredIssue({ id: 'issue-2' })]
    const envelope = makeKVEnvelope(issues, {
      scraped_at: '2024-06-01T00:00:00Z',
      computed_at: '2024-06-01T01:00:00Z'
    })
    const kv = createMockKV({ 'recon:test-repo:scored-issues': envelope })

    const result = await getScoredIssuesEnveloped(kv, 'test-repo')
    expect(result).not.toBeNull()
    expect(result!.data).toHaveLength(2)
    expect(result!.data[0].id).toBe('issue-1')
    expect(result!.scraped_at).toBe('2024-06-01T00:00:00Z')
    expect(result!.computed_at).toBe('2024-06-01T01:00:00Z')
  })

  it('falls back to bare array for pre-migration KV entries', async () => {
    // Bare array (no envelope) — simulates pre-migration data
    const issues = [makeScoredIssue({ id: 'issue-1' })]
    const kv = createMockKV({ 'recon:test-repo:scored-issues': issues })

    const result = await getScoredIssuesEnveloped(kv, 'test-repo')
    expect(result).not.toBeNull()
    // Bare arrays don't have .data at top level, so readEnvelopedKV wraps them
    expect(result!.scraped_at).toBeNull()
  })
})

describe('getDossierEnveloped', () => {
  it('returns null when no data', async () => {
    const kv = createMockKV()
    expect(await getDossierEnveloped(kv, 'test-repo')).toBeNull()
  })

  it('reads new envelope format', async () => {
    const dossier = makeDossier({ slug: 'test-repo' })
    const envelope = makeKVEnvelope(dossier, {
      scraped_at: '2024-06-01T00:00:00Z',
      computed_at: '2024-06-01T01:00:00Z'
    })
    const kv = createMockKV({ 'recon:test-repo:dossier': envelope })

    const result = await getDossierEnveloped(kv, 'test-repo')
    expect(result).not.toBeNull()
    expect(result!.data.slug).toBe('test-repo')
    expect(result!.data.completeness).toBeDefined()
    expect(result!.scraped_at).toBe('2024-06-01T00:00:00Z')
    expect(result!.computed_at).toBe('2024-06-01T01:00:00Z')
  })

  it('falls back to bare dossier for pre-migration KV entries', async () => {
    // Bare Dossier without envelope — simulates pre-migration
    const dossier: Dossier = {
      slug: 'test-repo',
      generatedAt: '2024-03-15T12:00:00Z',
      sections: {
        overview: '# Overview\nTest...',
        contributionRules: '# Rules\n...',
        successPatterns: '# Success\n...',
        antiPatterns: '# Anti\n...',
        issueBoard: '# Issues\n...',
        environmentSetup: '# Setup\n...'
      },
      completeness: {
        overview: true,
        contributionRules: true,
        successPatterns: true,
        antiPatterns: true,
        issueBoard: true,
        environmentSetup: true,
        score: 6,
        total: 6
      }
    }
    const kv = createMockKV({ 'recon:test-repo:dossier': dossier })

    const result = await getDossierEnveloped(kv, 'test-repo')
    expect(result).not.toBeNull()
    expect(result!.data.slug).toBe('test-repo')
    expect(result!.scraped_at).toBeNull()
    // Should extract computed_at from generatedAt field
    expect(result!.computed_at).toBe('2024-03-15T12:00:00Z')
  })
})

describe('bare readers delegate to enveloped', () => {
  it('getRepoHealth unwraps envelope data', async () => {
    const health = makeRepoHealth({ slug: 'test-repo', overallViability: 88 })
    const envelope = makeKVEnvelope(health)
    const kv = createMockKV({ 'recon:test-repo:health': envelope })

    const result = await getRepoHealth(kv, 'test-repo')
    expect(result).not.toBeNull()
    expect(result!.slug).toBe('test-repo')
    expect(result!.overallViability).toBe(88)
  })

  it('getScoredIssues unwraps envelope data', async () => {
    const issues = [makeScoredIssue({ id: 'issue-1', cvs: 90 })]
    const envelope = makeKVEnvelope(issues)
    const kv = createMockKV({ 'recon:test-repo:scored-issues': envelope })

    const result = await getScoredIssues(kv, 'test-repo')
    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
    expect(result![0].cvs).toBe(90)
  })

  it('getDossier unwraps envelope data', async () => {
    const dossier = makeDossier({ slug: 'test-repo' })
    const envelope = makeKVEnvelope(dossier)
    const kv = createMockKV({ 'recon:test-repo:dossier': envelope })

    const result = await getDossier(kv, 'test-repo')
    expect(result).not.toBeNull()
    expect(result!.slug).toBe('test-repo')
    expect(result!.completeness).toBeDefined()
  })
})
