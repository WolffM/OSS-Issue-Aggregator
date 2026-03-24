import { describe, it, expect } from 'vitest'
import { scoreIssues } from '../issue-scorer'
import type { RepoHealth, IssueComments } from '../types'
import { makeExtendedIssue, makeClaimRecord, makeComment, makeCommentThread } from './helpers'

function makeHealth(overrides: Partial<RepoHealth> = {}): RepoHealth {
  return {
    slug: 'fastify-fastify',
    defaultBranch: 'main',
    language: 'TypeScript',
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
  describe('low-viability repo scoring', () => {
    it('scores issues normally even with very low repo viability', () => {
      const health = makeHealth({
        overallViability: 5
      })
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const issues = [
        makeExtendedIssue({
          createdAt: recent,
          updatedAt: recent,
          bodyPreview: 'A clear bug report with steps to reproduce and expected behavior.'
        })
      ]

      const scored = scoreIssues(issues, {}, health, [])

      expect(scored).toHaveLength(1)
      expect(scored[0].cvs).toBeGreaterThan(0)
      expect(scored[0].repoKilled).toBe(false)
      expect(scored[0].contentQualityScore).toBeGreaterThan(0)
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
    it('maps high score to go tier with reactions and sentiment', () => {
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
        linkedPrUrls: [],
        reactionGroups: [
          { content: 'THUMBS_UP', totalCount: 15 },
          { content: 'HEART', totalCount: 5 }
        ]
      })
      const comments: IssueComments = {
        'top-issue': makeCommentThread([
          makeComment({ body: 'PR welcome! Happy to review.', authorAssociation: 'OWNER' }),
          makeComment({ body: '+1 need this', authorAssociation: 'NONE' })
        ])
      }

      const scored = scoreIssues([issue], comments, health, [])
      // With reactions + sentiment bonuses, should reach go tier (>=80)
      expect(scored[0].cvs).toBeGreaterThanOrEqual(80)
      expect(scored[0].cvsTier).toBe('go')
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

  describe('reaction scoring', () => {
    it('boosts CVS for issues with reactionGroups', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth({ overallViability: 70 })

      const issueWithReactions = makeExtendedIssue({
        id: 'reactions-issue',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: [
          { content: 'THUMBS_UP', totalCount: 10 },
          { content: 'HEART', totalCount: 5 },
          { content: 'ROCKET', totalCount: 3 }
        ]
      })

      const issueWithout = makeExtendedIssue({
        id: 'no-reactions',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: []
      })

      const scored = scoreIssues([issueWithReactions, issueWithout], {}, health, [])
      const withReactions = scored.find(i => i.id === 'reactions-issue')!
      const without = scored.find(i => i.id === 'no-reactions')!

      expect(withReactions.cvs).toBeGreaterThan(without.cvs)
    })

    it('caps reaction score at ±15', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth({ overallViability: 70 })

      // Massive positive reactions — should still cap at +15
      const issue = makeExtendedIssue({
        id: 'mega-reactions',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: [
          { content: 'THUMBS_UP', totalCount: 100 },
          { content: 'HEART', totalCount: 50 }
        ]
      })

      const baseline = makeExtendedIssue({
        id: 'baseline',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: []
      })

      const scored = scoreIssues([issue, baseline], {}, health, [])
      const mega = scored.find(i => i.id === 'mega-reactions')!
      const base = scored.find(i => i.id === 'baseline')!

      // Difference should be at most 15 (the cap)
      expect(mega.cvs - base.cvs).toBeLessThanOrEqual(15)
    })

    it('penalizes for negative reactions', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth({ overallViability: 70 })

      const negativeIssue = makeExtendedIssue({
        id: 'negative-reactions',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: [
          { content: 'THUMBS_DOWN', totalCount: 5 },
          { content: 'CONFUSED', totalCount: 3 }
        ]
      })

      const neutralIssue = makeExtendedIssue({
        id: 'neutral',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: []
      })

      const scored = scoreIssues([negativeIssue, neutralIssue], {}, health, [])
      const negative = scored.find(i => i.id === 'negative-reactions')!
      const neutral = scored.find(i => i.id === 'neutral')!

      expect(negative.cvs).toBeLessThan(neutral.cvs)
    })

    it('falls back to thumbsUpCount when reactionGroups absent', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth({ overallViability: 70 })

      const issueWithThumbsUp = makeExtendedIssue({
        id: 'thumbs-fallback',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 5
        // no reactionGroups field
      })

      const issueNoReactions = makeExtendedIssue({
        id: 'no-thumbs',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: []
      })

      const scored = scoreIssues([issueWithThumbsUp, issueNoReactions], {}, health, [])
      const withThumbsUp = scored.find(i => i.id === 'thumbs-fallback')!
      const without = scored.find(i => i.id === 'no-thumbs')!

      expect(withThumbsUp.cvs).toBeGreaterThan(without.cvs)
    })
  })

  describe('comment sentiment scoring', () => {
    it('boosts CVS for positive community sentiment', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth({ overallViability: 70 })

      const issue = makeExtendedIssue({
        id: 'popular-issue',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: []
      })

      const comments: IssueComments = {
        'popular-issue': makeCommentThread([
          makeComment({ body: '+1 need this', authorAssociation: 'NONE' }),
          makeComment({ body: 'Same here, would love this', authorAssociation: 'NONE' }),
          makeComment({ body: 'me too, please fix', authorAssociation: 'NONE' })
        ])
      }

      const issueNeutral = makeExtendedIssue({
        id: 'neutral-issue',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: []
      })

      const scored = scoreIssues([issue, issueNeutral], comments, health, [])
      const popular = scored.find(i => i.id === 'popular-issue')!
      const neutral = scored.find(i => i.id === 'neutral-issue')!

      expect(popular.cvs).toBeGreaterThan(neutral.cvs)
    })

    it('penalizes CVS for negative sentiment patterns', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth({ overallViability: 70 })

      const issue = makeExtendedIssue({
        id: 'negative-issue',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: []
      })

      const comments: IssueComments = {
        'negative-issue': makeCommentThread([
          makeComment({ body: 'duplicate of #42', authorAssociation: 'MEMBER' }),
          makeComment({ body: 'closing as stale', authorAssociation: 'MEMBER' })
        ])
      }

      const issueNeutral = makeExtendedIssue({
        id: 'neutral-issue',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: []
      })

      const scored = scoreIssues([issue, issueNeutral], comments, health, [])
      const negative = scored.find(i => i.id === 'negative-issue')!
      const neutral = scored.find(i => i.id === 'neutral-issue')!

      expect(negative.cvs).toBeLessThan(neutral.cvs)
    })

    it('caps comment sentiment at ±10', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth({ overallViability: 70 })

      // Many positive comments — should cap at +10
      const issue = makeExtendedIssue({
        id: 'mega-sentiment',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: []
      })

      const comments: IssueComments = {
        'mega-sentiment': makeCommentThread([
          makeComment({ body: '+1', authorAssociation: 'NONE' }),
          makeComment({ body: 'me too', authorAssociation: 'NONE' }),
          makeComment({ body: 'same here', authorAssociation: 'NONE' }),
          makeComment({ body: 'bump', authorAssociation: 'NONE' }),
          makeComment({ body: 'need this', authorAssociation: 'NONE' }),
          makeComment({ body: 'yes please', authorAssociation: 'NONE' }),
          makeComment({ body: 'agreed', authorAssociation: 'NONE' })
        ])
      }

      const baseline = makeExtendedIssue({
        id: 'baseline',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 0,
        reactionGroups: []
      })

      const scored = scoreIssues([issue, baseline], comments, health, [])
      const mega = scored.find(i => i.id === 'mega-sentiment')!
      const base = scored.find(i => i.id === 'baseline')!

      // Difference should be at most 10 (the cap)
      expect(mega.cvs - base.cvs).toBeLessThanOrEqual(10)
    })
  })

  describe('CVS tier thresholds', () => {
    it('maps score >= 80 to go tier', () => {
      const recent = new Date(Date.now() - 1 * 86_400_000).toISOString()
      const health = makeHealth({ overallViability: 95 })
      const issue = makeExtendedIssue({
        id: 'go-issue',
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
        linkedPrUrls: [],
        reactionGroups: [
          { content: 'THUMBS_UP', totalCount: 10 },
          { content: 'HEART', totalCount: 5 }
        ]
      })
      const comments: IssueComments = {
        'go-issue': makeCommentThread([
          makeComment({ body: 'PR welcome! Happy to review.', authorAssociation: 'OWNER' }),
          makeComment({ body: '+1 need this', authorAssociation: 'NONE' }),
          makeComment({ body: 'me too, please fix', authorAssociation: 'NONE' })
        ])
      }

      const scored = scoreIssues([issue], comments, health, [])
      expect(scored[0].cvs).toBeGreaterThanOrEqual(80)
      expect(scored[0].cvsTier).toBe('go')
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
      expect(result).toHaveProperty('sentimentSignals')
      expect(Array.isArray(result.sentimentSignals)).toBe(true)
      expect(result).toHaveProperty('commentDigest')
      expect(result).toHaveProperty('contentQualityScore')
      expect(result).toHaveProperty('competitionLevel')
      expect(result).toHaveProperty('repoSlug')
      expect(result).toHaveProperty('dataCompleteness')
      expect(result).toHaveProperty('repoKilled')
      expect(result).toHaveProperty('_scoring')
    })

    it('returns empty array for no issues', () => {
      const health = makeHealth()
      const scored = scoreIssues([], {}, health, [])
      expect(scored).toEqual([])
    })
  })

  describe('_scoring metadata', () => {
    it('includes _scoring on every scored issue', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issues = [
        makeExtendedIssue({ id: 'a', createdAt: recent, updatedAt: recent }),
        makeExtendedIssue({ id: 'b', createdAt: recent, updatedAt: recent })
      ]

      const scored = scoreIssues(issues, {}, health, [])

      for (const issue of scored) {
        expect(issue._scoring).toBeDefined()
        expect(typeof issue._scoring.scored_at).toBe('string')
        expect(new Date(issue._scoring.scored_at).getTime()).not.toBeNaN()
        expect(issue._scoring.data_completeness).toMatch(/^(full|partial)$/)
        expect(Array.isArray(issue._scoring.signals_used)).toBe(true)
        expect(Array.isArray(issue._scoring.signals_available)).toBe(true)
      }
    })

    it('signals_available always contains all 7 signals', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({ createdAt: recent, updatedAt: recent })

      const scored = scoreIssues([issue], {}, health, [])

      expect(scored[0]._scoring.signals_available).toEqual([
        'freshness',
        'activity',
        'contentQuality',
        'competition',
        'complexity',
        'reactions',
        'commentSentiment'
      ])
    })

    it('scored_at is the same across all issues in a batch', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issues = [
        makeExtendedIssue({ id: 'a', createdAt: recent, updatedAt: recent }),
        makeExtendedIssue({ id: 'b', createdAt: recent, updatedAt: recent }),
        makeExtendedIssue({ id: 'c', createdAt: recent, updatedAt: recent })
      ]

      const scored = scoreIssues(issues, {}, health, [])

      const timestamps = scored.map(i => i._scoring.scored_at)
      expect(new Set(timestamps).size).toBe(1)
    })

    it('signals_used reflects non-zero signals', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 10,
        reactionGroups: [{ content: 'THUMBS_UP', totalCount: 10 }]
      })

      const comments: IssueComments = {
        [issue.id]: makeCommentThread([
          makeComment({ body: '+1 need this', authorAssociation: 'NONE' })
        ])
      }

      const scored = scoreIssues([issue], comments, health, [])

      expect(scored[0]._scoring.signals_used).toContain('freshness')
      expect(scored[0]._scoring.signals_used).toContain('reactions')
      expect(scored[0]._scoring.signals_used).toContain('commentSentiment')
    })

    it('data_completeness is partial when health is null', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const issue = makeExtendedIssue({ createdAt: recent, updatedAt: recent })

      const scored = scoreIssues([issue], {}, null, [])

      expect(scored[0]._scoring.data_completeness).toBe('partial')
    })

    it('data_completeness is full when health and comments present', () => {
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

      expect(scored[0]._scoring.data_completeness).toBe('full')
    })
  })

  describe('sentiment signals', () => {
    it('includes sentiment signals in scored output', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        id: 'signals-test',
        createdAt: recent,
        updatedAt: recent
      })
      const comments: IssueComments = {
        'signals-test': makeCommentThread([
          makeComment({ body: 'PR welcome!', authorAssociation: 'MEMBER' })
        ])
      }

      const scored = scoreIssues([issue], comments, health, [])
      expect(scored[0].sentimentSignals.length).toBeGreaterThan(0)
      expect(scored[0].sentimentSignals[0]).toContain('positive')
    })

    it('returns empty signals when no comments', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({ createdAt: recent, updatedAt: recent })

      const scored = scoreIssues([issue], {}, health, [])
      expect(scored[0].sentimentSignals).toEqual([])
    })
  })

  describe('comment digest', () => {
    it('populates commentDigest when comments exist', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({
        id: 'digest-test',
        createdAt: recent,
        updatedAt: recent
      })
      const comments: IssueComments = {
        'digest-test': makeCommentThread([
          makeComment({ author: 'maint', authorAssociation: 'MEMBER', body: 'Good idea' }),
          makeComment({ author: 'user1', authorAssociation: 'NONE', body: 'I agree' })
        ])
      }

      const scored = scoreIssues([issue], comments, health, [])
      expect(scored[0].commentDigest).not.toBeNull()
      expect(scored[0].commentDigest!.participantCount).toBe(2)
      expect(scored[0].commentDigest!.maintainerParticipantCount).toBe(1)
    })

    it('returns null commentDigest when no comments', () => {
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const health = makeHealth()
      const issue = makeExtendedIssue({ createdAt: recent, updatedAt: recent })

      const scored = scoreIssues([issue], {}, health, [])
      expect(scored[0].commentDigest).toBeNull()
    })
  })

  describe('linked PR near-disqualifier', () => {
    it('caps CVS at 35 when issue has linked PRs', () => {
      const recent = new Date(Date.now() - 1 * 86_400_000).toISOString()
      const health = makeHealth({ overallViability: 95 })

      const issue = makeExtendedIssue({
        id: 'linked-pr-issue',
        createdAt: recent,
        updatedAt: recent,
        lastCommentAt: recent,
        thumbsUpCount: 20,
        commentCount: 3,
        labels: ['good first issue'],
        bodyPreview: 'Detailed issue with steps to reproduce. Expected behavior.\n```code```',
        assignees: [],
        linkedPrUrls: ['https://github.com/org/repo/pull/42'],
        reactionGroups: [{ content: 'THUMBS_UP', totalCount: 10 }]
      })
      const comments: IssueComments = {
        'linked-pr-issue': makeCommentThread([
          makeComment({ body: 'PR welcome!', authorAssociation: 'OWNER' })
        ])
      }

      const scored = scoreIssues([issue], comments, health, [])
      expect(scored[0].cvs).toBeLessThanOrEqual(35)
      expect(scored[0].cvsTier).not.toBe('go')
      expect(scored[0].cvsTier).not.toBe('likely')
      expect(scored[0].cvsTier).not.toBe('maybe')
      expect(scored[0].competitionLevel).toBe('high')
    })

    it('does not penalize issues without linked PRs', () => {
      const recent = new Date(Date.now() - 1 * 86_400_000).toISOString()
      const health = makeHealth({ overallViability: 95 })

      const issue = makeExtendedIssue({
        id: 'no-pr-issue',
        createdAt: recent,
        updatedAt: recent,
        thumbsUpCount: 10,
        labels: ['good first issue'],
        assignees: [],
        linkedPrUrls: []
      })

      const scored = scoreIssues([issue], {}, health, [])
      expect(scored[0].cvs).toBeGreaterThan(35)
    })
  })
})
