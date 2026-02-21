/**
 * Repo Health Scoring Engine
 *
 * Computes maintainer health, merge accessibility, and availability scores.
 * Detects kill signals (archived, no merges, no external merges).
 * Pure function — takes data, returns RepoHealth.
 */

import type { RepoMeta, PRSample, RepoHealth, PRPatterns } from './types'
import { isMaintainer, daysBetween, daysSince, median, clamp } from './utils'

function isExternalPR(pr: PRSample): boolean {
  return !isMaintainer(pr.authorAssociation)
}

function hasMergedInLast90Days(prs: PRSample[]): boolean {
  return prs.some(pr => pr.mergedAt && daysSince(pr.mergedAt) <= 90)
}

function hasExternalMergedInLast90Days(prs: PRSample[]): boolean {
  return prs.some(pr => pr.mergedAt && isExternalPR(pr) && daysSince(pr.mergedAt) <= 90)
}

function detectKillSignal(meta: RepoMeta, mergedPRs: PRSample[]): string | null {
  if (meta.isArchived) return 'Repository is archived'
  if (mergedPRs.length === 0 || !hasMergedInLast90Days(mergedPRs)) {
    return 'No merged PRs in last 90 days'
  }
  if (!hasExternalMergedInLast90Days(mergedPRs)) {
    return 'No external contributor PRs merged in last 90 days'
  }
  return null
}

function killedHealth(slug: string, killReason: string): RepoHealth {
  return {
    slug,
    maintainerHealthScore: 0,
    mergeAccessibilityScore: 0,
    availabilityScore: 0,
    overallViability: 0,
    killed: true,
    killReason,
    detectedQuirks: [],
    prPatterns: emptyPRPatterns(),
    analyzedAt: new Date().toISOString()
  }
}

function emptyPRPatterns(): PRPatterns {
  return {
    medianFilesChanged: 0,
    medianAdditions: 0,
    medianTimeToMergeDays: 0,
    mergeStyle: 'mixed',
    commitConvention: null,
    externalContributorMergeRate: 0,
    topRejectionReasons: []
  }
}

// ============================================================================
// Sub-Scores
// ============================================================================

function scoreMaintainerHealth(mergedPRs: PRSample[]): number {
  let score = 50

  // Time-to-merge analysis
  const mergeTimes = mergedPRs
    .filter(pr => pr.mergedAt)
    .map(pr => daysBetween(pr.createdAt, pr.mergedAt!))

  if (mergeTimes.length > 0) {
    const medianMergeTime = median(mergeTimes)
    if (medianMergeTime < 7) score += 25
    else if (medianMergeTime < 14) score += 15
    else if (medianMergeTime > 30) score -= 20
  }

  // External merge rate
  const externalMerged = mergedPRs.filter(isExternalPR).length
  const externalRate = mergedPRs.length > 0 ? externalMerged / mergedPRs.length : 0
  if (externalRate > 0.5) score += 15

  // Review engagement
  const reviewCounts = mergedPRs.map(pr => pr.reviewCount)
  if (reviewCounts.length > 0 && median(reviewCounts) > 0) score += 10

  return clamp(score, 0, 100)
}

function scoreMergeAccessibility(mergedPRs: PRSample[], rejectedPRs: PRSample[]): number {
  let score = 50

  // External merge rate
  const externalMerged = mergedPRs.filter(isExternalPR).length
  const externalRate = mergedPRs.length > 0 ? externalMerged / mergedPRs.length : 0

  if (externalRate > 0.6) score += 30
  else if (externalRate > 0.3) score += 15
  else if (externalRate < 0.1) score -= 20

  // Rejection rate
  const totalPRs = mergedPRs.length + rejectedPRs.length
  if (totalPRs > 0) {
    const rejectionRate = rejectedPRs.length / totalPRs
    if (rejectionRate < 0.3) score += 10
    else if (rejectionRate > 0.6) score -= 15
  }

  return clamp(score, 0, 100)
}

function scoreAvailability(meta: RepoMeta, mergedPRs: PRSample[]): number {
  let score = 50

  // PR-to-issue ratio
  if (meta.openIssueCount > 0) {
    const ratio = meta.openPrCount / meta.openIssueCount
    if (ratio < 0.3) score += 20
    else if (ratio > 0.8) score -= 15
  }

  // Unique PR authors
  const uniqueAuthors = new Set(mergedPRs.map(pr => pr.author))
  if (uniqueAuthors.size > 5) score += 15

  // Recent push activity
  if (daysSince(meta.lastPushedAt) < 7) score += 10

  return clamp(score, 0, 100)
}

// ============================================================================
// PR Patterns
// ============================================================================

function detectMergeStyle(mergedPRs: PRSample[]): PRPatterns['mergeStyle'] {
  if (mergedPRs.length === 0) return 'mixed'

  const withSha = mergedPRs.filter(pr => pr.mergeCommitSha).length
  const ratio = withSha / mergedPRs.length

  if (ratio > 0.8) return 'squash'
  if (ratio < 0.2) return 'rebase'
  if (ratio > 0.4 && ratio < 0.6) return 'mixed'
  return 'merge'
}

function detectCommitConvention(mergedPRs: PRSample[]): string | null {
  const conventionalPattern = /^(feat|fix|chore|docs|style|refactor|test|ci|build|perf)(\(.+\))?:/
  const conventionalCount = mergedPRs.filter(
    pr => conventionalPattern.test(pr.title) || conventionalPattern.test(pr.headRefName)
  ).length

  if (mergedPRs.length > 0 && conventionalCount / mergedPRs.length > 0.5) {
    return 'conventional'
  }
  return null
}

function inferRejectionReasons(rejectedPRs: PRSample[]): string[] {
  const reasons: string[] = []
  if (rejectedPRs.length === 0) return reasons

  const largePRs = rejectedPRs.filter(pr => pr.changedFiles > 20 || pr.additions > 500)
  if (largePRs.length > rejectedPRs.length * 0.3) reasons.push('too large')

  const wrongBranch = rejectedPRs.filter(
    pr => pr.baseRefName !== 'main' && pr.baseRefName !== 'master'
  )
  if (wrongBranch.length > rejectedPRs.length * 0.3) reasons.push('wrong branch')

  const noReviews = rejectedPRs.filter(pr => pr.reviewCount === 0)
  if (noReviews.length > rejectedPRs.length * 0.5) reasons.push('no review engagement')

  return reasons
}

export function analyzePRPatterns(mergedPRs: PRSample[], rejectedPRs: PRSample[]): PRPatterns {
  const externalMerged = mergedPRs.filter(isExternalPR).length
  const externalRate = mergedPRs.length > 0 ? externalMerged / mergedPRs.length : 0

  const mergeTimes = mergedPRs
    .filter(pr => pr.mergedAt)
    .map(pr => daysBetween(pr.createdAt, pr.mergedAt!))

  return {
    medianFilesChanged: median(mergedPRs.map(pr => pr.changedFiles)),
    medianAdditions: median(mergedPRs.map(pr => pr.additions)),
    medianTimeToMergeDays: Math.round(median(mergeTimes) * 10) / 10,
    mergeStyle: detectMergeStyle(mergedPRs),
    commitConvention: detectCommitConvention(mergedPRs),
    externalContributorMergeRate: Math.round(externalRate * 100) / 100,
    topRejectionReasons: inferRejectionReasons(rejectedPRs)
  }
}

// ============================================================================
// Main Scorer
// ============================================================================

export function scoreRepoHealth(
  meta: RepoMeta,
  mergedPRs: PRSample[],
  rejectedPRs: PRSample[]
): RepoHealth {
  const killReason = detectKillSignal(meta, mergedPRs)
  if (killReason) return killedHealth(meta.slug, killReason)

  const maintainerHealthScore = scoreMaintainerHealth(mergedPRs)
  const mergeAccessibilityScore = scoreMergeAccessibility(mergedPRs, rejectedPRs)
  const availabilityScore = scoreAvailability(meta, mergedPRs)

  const overallViability = Math.round(
    maintainerHealthScore * 0.4 + mergeAccessibilityScore * 0.35 + availabilityScore * 0.25
  )

  return {
    slug: meta.slug,
    maintainerHealthScore,
    mergeAccessibilityScore,
    availabilityScore,
    overallViability,
    killed: false,
    killReason: null,
    detectedQuirks: [], // M3
    prPatterns: analyzePRPatterns(mergedPRs, rejectedPRs),
    analyzedAt: new Date().toISOString()
  }
}
