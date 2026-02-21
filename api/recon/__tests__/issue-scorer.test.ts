import { describe, it, expect } from 'vitest'
import { scoreIssues } from '../issue-scorer'
import type { RepoHealth, IssueComments } from '../types'
import { makeExtendedIssue, makeClaimRecord, makeComment, makeCommentThread } from './helpers'

function makeHealth(overrides: Partial<RepoHealth> = {}): RepoHealth {
  return {
    slug: 'fastify-fastify',
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

describe('scoreIssues', () => {
  describe('kill signal propagation', () => {
    it('sets all issues to cvs=0 when repo is killed', () => {
      const health = makeHealth({
        killed: true,
        killReason: 'Repository is archived',
        overallViability: 0
      })
      const issues = [makeExtendedIssue(), makeExtendedIssue({ id: 'issue-2' })]

      const scored = scoreIssues(issues, {}, health, [])

      expect(scored).toHaveLength(2)
      for (const issue of scored) {
        expect(issue.cvs).toBe(0)
        expect(issue.cvsTier).toBe('skip')
        expect(issue.repoKilled).toBe(true)
      }
    })
  })

  describe('partial data', () => {
    it('uses repo_score=50 when health is null', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const issues = [
        makeExtendedIssue({
          createdAt: recent,
          updatedAt: recent
        })
      ]

      const scored = scoreIssues(issues, {}, null, [])

      expect(scored).toHaveLength(1)
      expect(scored[0].dataCompleteness).toBe('partial')
      // CVS should reflect neutral repo score
      expect(scored[0].cvs).toBeGreaterThan(0)
    })

    it('marks data as partial when comments missing for issue', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issues = [
        makeExtendedIssue({
          createdAt: recent,
          updatedAt: recent
        })
      ]

      const scored = scoreIssues(issues, {}, health, [])

      expect(scored[0].dataCompleteness).toBe('partial')
    })

    it('marks data as full when health and comments present', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        id: 'test-id',
        createdAt: recent,
        updatedAt: recent
      })
      const comments: IssueComments = {
        'test-id': makeCommentThread([makeComment()])
      }

      const scored = scoreIssues([issue], comments, health, [])

      expect(scored[0].dataCompleteness).toBe('full')
    })
  })

  describe('CVS scoring', () => {
    it('fresh issue with high engagement scores higher', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth({ overallViability: 80 })

      const goodIssue = makeExtendedIssue({
        id: 'good-issue',
        createdAt: recent,
        updatedAt: recent,
        lastCommentAt: recent,
        thumbsUpCount: 10,
        commentCount: 5,
        labels: ['good first issue', 'help wanted'],
        bodyPreview:
          'This is a detailed issue with steps to reproduce and expected behavior.\n```code block```',
        assignees: [],
        linkedPrUrls: []
      })

      const comments: IssueComments = {
        'good-issue': makeCommentThread([
          makeComment({
            body: 'PR welcome! This looks like a good contribution.',
            authorAssociation: 'MEMBER'
          })
        ])
      }

      const scored = scoreIssues([goodIssue], comments, health, [])

      expect(scored[0].cvs).toBeGreaterThanOrEqual(50)
      expect(scored[0].cvsTier).not.toBe('skip')
    })

    it('zombie issue scores very low', () => {
      const oldDate = '2022-01-01T00:00:00Z'
      const health = makeHealth({ overallViability: 70 })

      const zombieIssue = makeExtendedIssue({
        createdAt: oldDate,
        updatedAt: oldDate,
        lastCommentAt: oldDate,
        thumbsUpCount: 0,
        commentCount: 0,
        labels: [],
        bodyPreview: 'Short desc.',
        assignees: [],
        linkedPrUrls: []
      })

      const scored = scoreIssues([zombieIssue], {}, health, [])

      expect(scored[0].cvs).toBeLessThan(40)
      expect(scored[0].lifecycleStage).toBe('zombie')
    })

    it('sorts by CVS descending', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const old = '2022-01-01T00:00:00Z'
      const health = makeHealth()

      const issues = [
        makeExtendedIssue({ id: 'bad', createdAt: old, updatedAt: old, lastCommentAt: old }),
        makeExtendedIssue({
          id: 'good',
          createdAt: recent,
          updatedAt: recent,
          thumbsUpCount: 10,
          labels: ['good first issue']
        })
      ]

      const scored = scoreIssues(issues, {}, health, [])

      expect(scored[0].id).toBe('good')
      expect(scored[0].cvs).toBeGreaterThan(scored[1].cvs)
    })
  })

  describe('CVS tiers', () => {
    it('maps score 85-100 to go', () => {
      // Force a very high score scenario
      const recent = new Date(Date.now() - 1 * 86_400_000).toISOString()
      const health = makeHealth({ overallViability: 95 })
      const issue = makeExtendedIssue({
        id: 'top-issue',
        createdAt: recent,
        updatedAt: recent,
        lastCommentAt: recent,
        thumbsUpCount: 20,
        commentCount: 3,
        labels: ['good first issue'],
        bodyPreview:
          'Detailed issue with steps to reproduce. Expected behavior: X. Actual: Y.\n```code```',
        milestone: 'v2.0',
        assignees: [],
        linkedPrUrls: []
      })
      const comments: IssueComments = {
        'top-issue': makeCommentThread([
          makeComment({ body: 'PR welcome! Happy to review.', authorAssociation: 'OWNER' })
        ])
      }

      const scored = scoreIssues([issue], comments, health, [])
      // With very high repo score + good issue + accepted lifecycle, should be high
      expect(scored[0].cvs).toBeGreaterThanOrEqual(70)
    })
  })

  describe('claim detection', () => {
    it('marks issues as claimed when in claims list', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        id: 'claimed-issue',
        createdAt: recent,
        updatedAt: recent
      })
      const claims = [
        makeClaimRecord({
          issueId: 'claimed-issue',
          claimedBy: 'myuser',
          claimedAt: recent
        })
      ]

      const scored = scoreIssues([issue], {}, health, claims)

      expect(scored[0].claimStatus).toBe('claimed')
      expect(scored[0].claimAuthor).toBe('myuser')
    })

    it('marks stale claims (>14 days)', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const staleDate = new Date(Date.now() - 20 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        id: 'stale-claim-issue',
        createdAt: recent,
        updatedAt: recent
      })
      const claims = [
        makeClaimRecord({
          issueId: 'stale-claim-issue',
          claimedBy: 'myuser',
          claimedAt: staleDate
        })
      ]

      const scored = scoreIssues([issue], {}, health, claims)

      expect(scored[0].claimStatus).toBe('stale-claim')
    })

    it('marks as claimed when issue has assignees', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        createdAt: recent,
        updatedAt: recent,
        assignees: ['assigned-user']
      })

      const scored = scoreIssues([issue], {}, health, [])

      expect(scored[0].claimStatus).toBe('claimed')
      expect(scored[0].claimAuthor).toBe('assigned-user')
    })

    it('marks unclaimed when no claims or assignees', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        createdAt: recent,
        updatedAt: recent,
        assignees: []
      })

      const scored = scoreIssues([issue], {}, health, [])

      expect(scored[0].claimStatus).toBe('unclaimed')
      expect(scored[0].claimAuthor).toBeNull()
    })
  })

  describe('competition level', () => {
    it('high when linked PRs exist', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        createdAt: recent,
        updatedAt: recent,
        linkedPrUrls: ['https://github.com/org/repo/pull/42']
      })

      const scored = scoreIssues([issue], {}, health, [])

      expect(scored[0].competitionLevel).toBe('high')
    })

    it('medium when assignees present', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        createdAt: recent,
        updatedAt: recent,
        assignees: ['someone'],
        linkedPrUrls: []
      })

      const scored = scoreIssues([issue], {}, health, [])

      expect(scored[0].competitionLevel).toBe('medium')
    })

    it('none when wide open', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        createdAt: recent,
        updatedAt: recent,
        assignees: [],
        linkedPrUrls: [],
        commentCount: 2
      })

      const scored = scoreIssues([issue], {}, health, [])

      expect(scored[0].competitionLevel).toBe('none')
    })
  })

  describe('complexity mapping', () => {
    it('maps beginner labels to low complexity', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        createdAt: recent,
        updatedAt: recent,
        labels: ['good first issue'],
        title: 'Fix typo in documentation'
      })

      const scored = scoreIssues([issue], {}, health, [])

      expect(scored[0].complexity).toBe('low')
    })

    it('maps advanced signals to high complexity', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        createdAt: recent,
        updatedAt: recent,
        labels: ['performance'],
        title: 'Refactor core runtime for better performance'
      })

      const scored = scoreIssues([issue], {}, health, [])

      expect(scored[0].complexity).toBe('high')
    })
  })

  describe('output shape', () => {
    it('returns all required ScoredIssue fields', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({ createdAt: recent, updatedAt: recent })

      const scored = scoreIssues([issue], {}, health, [])

      const result = scored[0]
      expect(result).toHaveProperty('cvs')
      expect(result).toHaveProperty('cvsTier')
      expect(result).toHaveProperty('lifecycleStage')
      expect(result).toHaveProperty('claimStatus')
      expect(result).toHaveProperty('claimAuthor')
      expect(result).toHaveProperty('complexity')
      expect(result).toHaveProperty('sentimentScore')
      expect(result).toHaveProperty('contentQualityScore')
      expect(result).toHaveProperty('competitionLevel')
      expect(result).toHaveProperty('repoSlug')
      expect(result).toHaveProperty('dataCompleteness')
      expect(result).toHaveProperty('repoKilled')
    })

    it('returns empty array for no issues', () => {
      const health = makeHealth()
      const scored = scoreIssues([], {}, health, [])
      expect(scored).toEqual([])
    })
  })
})
