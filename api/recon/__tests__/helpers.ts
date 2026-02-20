/**
 * Test helpers for recon module tests.
 * Provides a mock KVNamespace and fixture data.
 */

import type { ExtendedIssue, ReconIssueData, ClaimRecord } from '../types'

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
    list() {
      const keys = [...store.keys()].map(name => ({ name }))
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
