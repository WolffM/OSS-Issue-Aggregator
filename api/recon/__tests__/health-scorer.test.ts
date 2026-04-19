import { describe, it, expect } from 'vitest'
import { scoreRepoHealth, analyzePRPatterns } from '../health-scorer'
import { makePRSample, makeRepoMeta } from './helpers'

describe('scoreRepoHealth', () => {
  describe('low-activity repos', () => {
    it('gives near-zero scores for archived repos', () => {
      const meta = makeRepoMeta({ isArchived: true })
      const mergedPRs = [makePRSample()]
      const result = scoreRepoHealth(meta, mergedPRs, [])

      expect(result.killed).toBe(false)
      expect(result.killReason).toBeNull()
      expect(result.maintainerHealthScore).toBe(0)
      expect(result.mergeAccessibilityScore).toBe(0)
      expect(result.availabilityScore).toBeLessThanOrEqual(5)
      expect(result.overallViability).toBeLessThanOrEqual(2)
    })

    it('gives low scores for repos with no merged PRs', () => {
      const meta = makeRepoMeta()
      const result = scoreRepoHealth(meta, [], [])

      expect(result.killed).toBe(false)
      expect(result.killReason).toBeNull()
      expect(result.maintainerHealthScore).toBe(10)
      expect(result.mergeAccessibilityScore).toBe(10)
      expect(result.overallViability).toBeGreaterThan(0)
      // Availability can be moderate (recent push, low PR/issue ratio), keeping overall below 35
      expect(result.overallViability).toBeLessThanOrEqual(35)
    })

    it('gives low scores for repos with no recent merged PRs (>90 days)', () => {
      const meta = makeRepoMeta()
      const oldPR = makePRSample({ mergedAt: '2023-01-01T00:00:00Z' })
      const result = scoreRepoHealth(meta, [oldPR], [])

      expect(result.killed).toBe(false)
      expect(result.killReason).toBeNull()
      expect(result.maintainerHealthScore).toBe(15)
      expect(result.mergeAccessibilityScore).toBe(15)
      expect(result.overallViability).toBeGreaterThan(0)
      // Availability can be moderate (recent push, low PR/issue ratio), keeping overall below 40
      expect(result.overallViability).toBeLessThanOrEqual(40)
    })

    it('penalizes repos with no external contributor merges in 90 days', () => {
      const meta = makeRepoMeta()
      const recentDate = new Date(Date.now() - 10 * 86_400_000).toISOString()
      const internalPR = makePRSample({
        authorAssociation: 'MEMBER',
        mergedAt: recentDate
      })
      const result = scoreRepoHealth(meta, [internalPR], [])

      expect(result.killed).toBe(false)
      expect(result.killReason).toBeNull()
      // External rate < 0.1 gives -20 penalty in mergeAccessibility
      expect(result.mergeAccessibilityScore).toBeLessThan(50)
      expect(result.overallViability).toBeGreaterThan(0)
    })
  })

  describe('CONTRIBUTING.md wind-down signals', () => {
    it('sets killed with maintenance_mode when CONTRIBUTING says "winding down"', () => {
      const meta = makeRepoMeta({
        contributingContent: `# Notes on Contributing\n\nDevelopment in this codebase is winding down and PRs will only be merged if they fix critical issues.`
      })
      const result = scoreRepoHealth(meta, [], [])

      expect(result.killed).toBe(true)
      expect(result.killReason).toBe('maintenance_mode')
      expect(result.overallViability).toBe(0)
    })

    it('sets killed with maintenance_mode when CONTRIBUTING says "maintenance mode"', () => {
      const meta = makeRepoMeta({
        contributingContent: `This project is in maintenance mode. We only accept security fixes.`
      })
      const result = scoreRepoHealth(meta, [], [])

      expect(result.killed).toBe(true)
      expect(result.killReason).toBe('maintenance_mode')
    })

    it('sets killed with migrated:owner/repo when CONTRIBUTING redirects to another repo', () => {
      const meta = makeRepoMeta({
        contributingContent: `All code changes should be submitted to the https://github.com/microsoft/typescript-go repo instead.`
      })
      const result = scoreRepoHealth(meta, [], [])

      expect(result.killed).toBe(true)
      expect(result.killReason).toBe('migrated:microsoft/typescript-go')
    })

    it('sets killed with archived when prose says repo is archived', () => {
      const meta = makeRepoMeta({
        contributingContent: `This repository is archived. Please fork if you want to continue development.`
      })
      const result = scoreRepoHealth(meta, [], [])

      expect(result.killed).toBe(true)
      expect(result.killReason).toBe('archived')
    })

    it('does not trigger on unrelated CONTRIBUTING prose', () => {
      const meta = makeRepoMeta({
        contributingContent: `# Contributing\n\nPlease submit PRs against main. Make sure tests pass.`
      })
      const recentDate = new Date(Date.now() - 5 * 86_400_000).toISOString()
      const pr = makePRSample({
        authorAssociation: 'CONTRIBUTOR',
        mergedAt: recentDate
      })
      const result = scoreRepoHealth(meta, [pr], [])

      expect(result.killed).toBe(false)
      expect(result.killReason).toBeNull()
    })
  })

  describe('healthy repos', () => {
    function makeHealthyPRs() {
      const recent = new Date(Date.now() - 5 * 86_400_000).toISOString()
      const created = new Date(Date.now() - 8 * 86_400_000).toISOString()
      return [
        makePRSample({
          author: 'ext1',
          authorAssociation: 'CONTRIBUTOR',
          createdAt: created,
          mergedAt: recent,
          reviewCount: 2
        }),
        makePRSample({
          number: 102,
          author: 'ext2',
          authorAssociation: 'NONE',
          createdAt: created,
          mergedAt: recent,
          reviewCount: 1
        }),
        makePRSample({
          number: 103,
          author: 'maintainer1',
          authorAssociation: 'MEMBER',
          createdAt: created,
          mergedAt: recent,
          reviewCount: 0
        })
      ]
    }

    it('returns non-killed result for active repos', () => {
      const meta = makeRepoMeta()
      const result = scoreRepoHealth(meta, makeHealthyPRs(), [])

      expect(result.killed).toBe(false)
      expect(result.killReason).toBeNull()
      expect(result.overallViability).toBeGreaterThan(0)
    })

    it('computes maintainerHealthScore', () => {
      const meta = makeRepoMeta()
      const result = scoreRepoHealth(meta, makeHealthyPRs(), [])

      expect(result.maintainerHealthScore).toBeGreaterThanOrEqual(0)
      expect(result.maintainerHealthScore).toBeLessThanOrEqual(100)
    })

    it('computes mergeAccessibilityScore', () => {
      const meta = makeRepoMeta()
      const result = scoreRepoHealth(meta, makeHealthyPRs(), [])

      expect(result.mergeAccessibilityScore).toBeGreaterThanOrEqual(0)
      expect(result.mergeAccessibilityScore).toBeLessThanOrEqual(100)
    })

    it('computes availabilityScore', () => {
      const meta = makeRepoMeta()
      const result = scoreRepoHealth(meta, makeHealthyPRs(), [])

      expect(result.availabilityScore).toBeGreaterThanOrEqual(0)
      expect(result.availabilityScore).toBeLessThanOrEqual(100)
    })

    it('overall viability is weighted composite', () => {
      const meta = makeRepoMeta()
      const result = scoreRepoHealth(meta, makeHealthyPRs(), [])

      const expected = Math.round(
        result.maintainerHealthScore * 0.4 +
          result.mergeAccessibilityScore * 0.35 +
          result.availabilityScore * 0.25
      )
      expect(result.overallViability).toBe(expected)
    })

    it('high availability when low PR/issue ratio', () => {
      const meta = makeRepoMeta({ openIssueCount: 200, openPrCount: 10 })
      const result = scoreRepoHealth(meta, makeHealthyPRs(), [])

      // Low PR/issue ratio = high availability
      expect(result.availabilityScore).toBeGreaterThan(50)
    })

    it('lower availability when high PR/issue ratio', () => {
      const meta = makeRepoMeta({ openIssueCount: 10, openPrCount: 20 })
      const result = scoreRepoHealth(meta, makeHealthyPRs(), [])

      // High PR/issue ratio
      expect(result.availabilityScore).toBeLessThanOrEqual(60)
    })

    it('includes slug in result', () => {
      const meta = makeRepoMeta({ slug: 'test-repo' })
      const result = scoreRepoHealth(meta, makeHealthyPRs(), [])

      expect(result.slug).toBe('test-repo')
    })

    it('includes analyzedAt timestamp', () => {
      const meta = makeRepoMeta()
      const result = scoreRepoHealth(meta, makeHealthyPRs(), [])

      expect(result.analyzedAt).toBeDefined()
      expect(new Date(result.analyzedAt).getTime()).not.toBeNaN()
    })

    it('returns empty detectedQuirks for vanilla repo', () => {
      const meta = makeRepoMeta()
      const result = scoreRepoHealth(meta, makeHealthyPRs(), [])

      expect(result.detectedQuirks).toEqual([])
    })

    it('includes detected quirks in health result', () => {
      const meta = makeRepoMeta({
        contributingContent: 'Please include a changeset with your PR.'
      })
      const result = scoreRepoHealth(meta, makeHealthyPRs(), [])

      expect(result.detectedQuirks.length).toBeGreaterThan(0)
      expect(result.detectedQuirks[0].type).toBe('changeset-required')
      expect(result.detectedQuirks[0].impact).toBe('blocker')
    })

    it('includes quirks for archived repos', () => {
      const meta = makeRepoMeta({
        isArchived: true,
        contributingContent: 'Must sign the CLA before contributing.'
      })
      const result = scoreRepoHealth(meta, [], [])

      expect(result.killed).toBe(false)
      expect(result.detectedQuirks.length).toBeGreaterThan(0)
      expect(result.detectedQuirks[0].type).toBe('cla-required')
    })
  })
})

describe('analyzePRPatterns', () => {
  it('computes median files changed', () => {
    const prs = [
      makePRSample({ changedFiles: 2 }),
      makePRSample({ number: 102, changedFiles: 4 }),
      makePRSample({ number: 103, changedFiles: 6 })
    ]
    const result = analyzePRPatterns(prs, [])

    expect(result.medianFilesChanged).toBe(4)
  })

  it('computes median additions', () => {
    const prs = [
      makePRSample({ additions: 10 }),
      makePRSample({ number: 102, additions: 30 }),
      makePRSample({ number: 103, additions: 50 })
    ]
    const result = analyzePRPatterns(prs, [])

    expect(result.medianAdditions).toBe(30)
  })

  it('computes external contributor merge rate', () => {
    const prs = [
      makePRSample({ authorAssociation: 'CONTRIBUTOR' }),
      makePRSample({ number: 102, authorAssociation: 'NONE' }),
      makePRSample({ number: 103, authorAssociation: 'MEMBER' })
    ]
    const result = analyzePRPatterns(prs, [])

    // 2 external out of 3
    expect(result.externalContributorMergeRate).toBeCloseTo(0.67, 1)
  })

  it('detects conventional commit convention', () => {
    const prs = [
      makePRSample({ title: 'feat: add new feature' }),
      makePRSample({ number: 102, title: 'fix: resolve bug' }),
      makePRSample({ number: 103, title: 'chore: update deps' })
    ]
    const result = analyzePRPatterns(prs, [])

    expect(result.commitConvention).toBe('conventional')
  })

  it('returns null convention when not conventional', () => {
    const prs = [
      makePRSample({ title: 'Add new feature' }),
      makePRSample({ number: 102, title: 'Fix typo in README' })
    ]
    const result = analyzePRPatterns(prs, [])

    expect(result.commitConvention).toBeNull()
  })

  it('infers rejection reasons from large PRs', () => {
    const rejected = [
      makePRSample({ changedFiles: 50, additions: 1000 }),
      makePRSample({ number: 102, changedFiles: 30, additions: 800 }),
      makePRSample({ number: 103, changedFiles: 1, additions: 5 })
    ]
    const result = analyzePRPatterns([], rejected)

    expect(result.topRejectionReasons).toContain('too large')
  })

  it('returns empty patterns for no PRs', () => {
    const result = analyzePRPatterns([], [])

    expect(result.medianFilesChanged).toBe(0)
    expect(result.medianAdditions).toBe(0)
    expect(result.externalContributorMergeRate).toBe(0)
    expect(result.topRejectionReasons).toEqual([])
  })
})
