/**
 * Test helpers for recon module tests.
 * Provides a mock KVNamespace and fixture data.
 */

import type {
  ExtendedIssue,
  ReconIssueData,
  ClaimRecord,
  PRSample,
  RepoMeta,
  RepoHealth,
  ScoredIssue,
  Comment,
  CommentThread
} from '../types'

// ============================================================================
// KV Mock
// ============================================================================

export function createMockKV(initial: Record<string, unknown> = {}): KVNamespace {
  const store = new Map<string, string>()

  for (const [key, value] of Object.entries(initial)) {
    store.set(key, JSON.stringify(value))
  }

  return {
    get(key: string, options?: unknown) {
      const raw = store.get(key)
      if (!raw) return Promise.resolve(null)
      if (options === 'json') return Promise.resolve(JSON.parse(raw) as unknown)
      return Promise.resolve(raw)
    },
    put(key: string, value: string) {
      store.set(key, value)
      return Promise.resolve()
    },
    delete(key: string) {
      store.delete(key)
      return Promise.resolve()
    },
    list(options?: { prefix?: string; cursor?: string }) {
      let keyNames = [...store.keys()]
      if (options?.prefix) {
        keyNames = keyNames.filter(k => k.startsWith(options.prefix!))
      }
      const keys = keyNames.map(name => ({ name }))
      return Promise.resolve({ keys, list_complete: true, cacheStatus: null })
    },
    getWithMetadata() {
      return Promise.resolve({ value: null, metadata: null, cacheStatus: null })
    }
  } as unknown as KVNamespace
}

// ============================================================================
// Fixtures
// ============================================================================

export function makeExtendedIssue(overrides: Partial<ExtendedIssue> = {}): ExtendedIssue {
  return {
    id: 'github-fastify-fastify-100',
    platform: 'github',
    project: 'fastify',
    title: 'Add support for async hooks',
    url: 'https://github.com/fastify/fastify/issues/100',
    difficulty: 'beginner',
    difficultyScore: 25,
    difficultySignals: ['good-first-issue'],
    labels: ['good first issue', 'help wanted'],
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-20T14:45:00Z',
    author: 'contributor1',
    authorAssociation: 'NONE',
    bodyPreview: 'This issue is about adding async hooks support...',
    commentCount: 3,
    thumbsUpCount: 5,
    assignees: [],
    milestone: null,
    linkedPrUrls: [],
    lastCommentAt: '2024-01-18T09:00:00Z',
    lastCommentAuthor: 'maintainer1',
    lastCommentAuthorAssociation: 'MEMBER',
    ...overrides
  }
}

export function makeReconIssueData(
  issues: ExtendedIssue[] = [makeExtendedIssue()]
): ReconIssueData {
  return {
    issues,
    scrapedAt: '2024-01-20T14:45:00Z',
    source: 'hadoku-scraper',
    dataTypes: ['issues']
  }
}

export function makeClaimRecord(overrides: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    issueId: 'github-fastify-fastify-100',
    claimedBy: 'testuser',
    claimedAt: '2024-01-20T14:45:00Z',
    forkIssueUrl: null,
    ...overrides
  }
}

export function makePRSample(overrides: Partial<PRSample> = {}): PRSample {
  return {
    number: 101,
    title: 'Fix typo in README',
    url: 'https://github.com/fastify/fastify/pull/101',
    author: 'external-dev',
    authorAssociation: 'CONTRIBUTOR',
    createdAt: '2024-01-10T10:00:00Z',
    mergedAt: '2024-01-12T14:00:00Z',
    closedAt: null,
    additions: 15,
    deletions: 3,
    changedFiles: 2,
    reviewCount: 1,
    labels: ['bug'],
    headRefName: 'fix/readme-typo',
    baseRefName: 'main',
    mergeCommitSha: 'abc123',
    ...overrides
  }
}

export function makeRepoMeta(overrides: Partial<RepoMeta> = {}): RepoMeta {
  return {
    owner: 'fastify',
    repo: 'fastify',
    slug: 'fastify-fastify',
    stars: 30000,
    forks: 2200,
    language: 'TypeScript',
    license: 'MIT',
    hasContributing: true,
    contributingContent: null,
    hasPrTemplate: false,
    prTemplateContent: null,
    hasCodeOfConduct: true,
    hasCodeowners: false,
    defaultBranch: 'main',
    isArchived: false,
    openIssueCount: 150,
    openPrCount: 25,
    lastPushedAt: new Date().toISOString(),
    topics: ['nodejs', 'http'],
    externalTools: [],
    scrapedAt: '2024-01-20T14:45:00Z',
    ...overrides
  }
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    author: 'maintainer1',
    authorAssociation: 'MEMBER',
    body: 'Thanks for reporting this!',
    createdAt: '2024-01-16T10:00:00Z',
    reactions: { thumbsUp: 0, thumbsDown: 0, heart: 0 },
    ...overrides
  }
}

export function makeCommentThread(
  comments: Comment[] = [makeComment()],
  overrides: Partial<Omit<CommentThread, 'comments'>> = {}
): CommentThread {
  return {
    issueNumber: 100,
    comments,
    scrapedAt: '2024-01-20T14:45:00Z',
    ...overrides
  }
}

export function makeRepoHealth(overrides: Partial<RepoHealth> = {}): RepoHealth {
  return {
    slug: 'fastify-fastify',
    defaultBranch: 'main',
    maintainerHealthScore: 70,
    mergeAccessibilityScore: 65,
    availabilityScore: 60,
    overallViability: 65,
    killed: false,
    killReason: null,
    detectedQuirks: [],
    prPatterns: {
      medianFilesChanged: 3,
      medianAdditions: 45,
      medianTimeToMergeDays: 4.5,
      mergeStyle: 'squash',
      commitConvention: null,
      externalContributorMergeRate: 0.65,
      topRejectionReasons: []
    },
    analyzedAt: new Date().toISOString(),
    ...overrides
  }
}

export function makeScoredIssue(overrides: Partial<ScoredIssue> = {}): ScoredIssue {
  return {
    ...makeExtendedIssue(),
    cvs: 65,
    cvsTier: 'maybe',
    lifecycleStage: 'fresh',
    claimStatus: 'unclaimed',
    claimAuthor: null,
    complexity: 'low',
    sentimentScore: 0,
    contentQualityScore: 40,
    competitionLevel: 'none',
    repoSlug: 'fastify-fastify',
    dataCompleteness: 'full',
    repoKilled: false,
    likelyFiles: [],
    relatedIssues: [],
    ...overrides
  }
}
