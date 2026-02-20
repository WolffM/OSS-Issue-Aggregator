import { describe, it, expect } from 'vitest'
import {
  getReconIssues,
  getReconIssuesScrapedAt,
  getMergedPRs,
  getRejectedPRs,
  getRepoMeta,
  getComments,
  getRepoHealth,
  getScoredIssues,
  getClaims,
  getDossier
} from '../kv-reader'
import { createMockKV, makeExtendedIssue, makeReconIssueData, makeClaimRecord } from './helpers'
import type { PRSample, RepoMeta, RepoHealth, ScoredIssue, Dossier } from '../types'

describe('getReconIssues', () => {
  it('returns null when KV key does not exist', async () => {
    const kv = createMockKV()
    const result = await getReconIssues(kv, 'nonexistent-repo')
    expect(result).toBeNull()
  })

  it('unwraps ReconIssueData envelope and returns issues array', async () => {
    const issue = makeExtendedIssue()
    const kv = createMockKV({
      'recon:fastify-fastify:issues': makeReconIssueData([issue])
    })

    const result = await getReconIssues(kv, 'fastify-fastify')
    expect(result).toHaveLength(1)
    expect(result![0].id).toBe(issue.id)
    expect(result![0].authorAssociation).toBe('NONE')
  })

  it('returns empty array from envelope with no issues', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify:issues': makeReconIssueData([])
    })

    const result = await getReconIssues(kv, 'fastify-fastify')
    expect(result).toEqual([])
  })
})

describe('getReconIssuesScrapedAt', () => {
  it('returns null when KV key does not exist', async () => {
    const kv = createMockKV()
    const result = await getReconIssuesScrapedAt(kv, 'nonexistent-repo')
    expect(result).toBeNull()
  })

  it('returns scrapedAt timestamp from envelope', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify:issues': makeReconIssueData()
    })

    const result = await getReconIssuesScrapedAt(kv, 'fastify-fastify')
    expect(result).toBe('2024-01-20T14:45:00Z')
  })
})

describe('getMergedPRs', () => {
  it('returns null when no data', async () => {
    const kv = createMockKV()
    expect(await getMergedPRs(kv, 'test-repo')).toBeNull()
  })

  it('returns PR samples from KV', async () => {
    const pr: PRSample = {
      number: 123,
      title: 'Fix bug',
      url: 'https://github.com/org/repo/pull/123',
      author: 'dev1',
      authorAssociation: 'CONTRIBUTOR',
      createdAt: '2024-01-10T00:00:00Z',
      mergedAt: '2024-01-15T00:00:00Z',
      closedAt: null,
      additions: 10,
      deletions: 5,
      changedFiles: 2,
      reviewCount: 1,
      labels: ['bug'],
      headRefName: 'fix/bug',
      baseRefName: 'main',
      mergeCommitSha: 'abc123'
    }
    const kv = createMockKV({ 'recon:test-repo:merged-prs': [pr] })

    const result = await getMergedPRs(kv, 'test-repo')
    expect(result).toHaveLength(1)
    expect(result![0].number).toBe(123)
  })
})

describe('getRejectedPRs', () => {
  it('returns null when no data', async () => {
    const kv = createMockKV()
    expect(await getRejectedPRs(kv, 'test-repo')).toBeNull()
  })
})

describe('getRepoMeta', () => {
  it('returns null when no data', async () => {
    const kv = createMockKV()
    expect(await getRepoMeta(kv, 'test-repo')).toBeNull()
  })

  it('returns repo meta from KV', async () => {
    const meta: RepoMeta = {
      owner: 'fastify',
      repo: 'fastify',
      slug: 'fastify-fastify',
      stars: 30000,
      forks: 2200,
      language: 'TypeScript',
      license: 'MIT',
      hasContributing: true,
      contributingContent: '# Contributing\nPlease read...',
      hasPrTemplate: false,
      prTemplateContent: null,
      hasCodeOfConduct: true,
      hasCodeowners: false,
      defaultBranch: 'main',
      isArchived: false,
      openIssueCount: 150,
      openPrCount: 25,
      lastPushedAt: '2024-01-20T00:00:00Z',
      topics: ['nodejs', 'http'],
      externalTools: [],
      scrapedAt: '2024-01-20T14:45:00Z'
    }
    const kv = createMockKV({ 'recon:fastify-fastify:repo-meta': meta })

    const result = await getRepoMeta(kv, 'fastify-fastify')
    expect(result).not.toBeNull()
    expect(result!.owner).toBe('fastify')
    expect(result!.stars).toBe(30000)
  })
})

describe('getComments', () => {
  it('returns null when no data', async () => {
    const kv = createMockKV()
    expect(await getComments(kv, 'test-repo')).toBeNull()
  })

  it('returns comment threads keyed by issue number', async () => {
    const comments = {
      '100': {
        issueNumber: 100,
        comments: [
          {
            author: 'maintainer',
            authorAssociation: 'MEMBER',
            body: 'PR welcome!',
            createdAt: '2024-01-16T00:00:00Z',
            reactions: { thumbsUp: 2, thumbsDown: 0, heart: 1 }
          }
        ],
        scrapedAt: '2024-01-20T14:45:00Z'
      }
    }
    const kv = createMockKV({ 'recon:test-repo:comments': comments })

    const result = await getComments(kv, 'test-repo')
    expect(result).not.toBeNull()
    expect(result!['100'].comments).toHaveLength(1)
    expect(result!['100'].comments[0].body).toBe('PR welcome!')
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
