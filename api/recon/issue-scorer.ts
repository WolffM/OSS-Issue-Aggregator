/**
 * CVS (Contribution Viability Score) Engine
 *
 * Composes repo health, lifecycle, sentiment, claims, and content quality
 * into a single 0-100 score per issue.
 *
 * Pure function — takes data as params, returns ScoredIssue[].
 */

import type {
  ExtendedIssue,
  IssueComments,
  RepoHealth,
  ClaimRecord,
  ScoredIssue,
  CVSTier,
  ClaimStatus,
  CompetitionLevel,
  Complexity,
  DataCompleteness
} from './types'
import { scoreIssue } from '../scoring'
import { analyzeSentiment } from './sentiment'
import { classifyLifecycle } from './lifecycle'
import { isMaintainer, daysSince, clamp } from './utils'

// Default beginner labels for scoreIssue() — covers common OSS conventions
const DEFAULT_BEGINNER_LABELS = ['good first issue', 'help wanted', 'beginner', 'easy', 'starter']

// ============================================================================
// Sub-Dimension Scorers
// ============================================================================

function scoreFreshness(issue: ExtendedIssue): number {
  const age = daysSince(issue.createdAt)
  if (age < 7) return 25
  if (age < 14) return 20
  if (age < 30) return 15
  if (age < 60) return 10
  if (age < 90) return 5
  return 0
}

function scoreActivity(issue: ExtendedIssue, hasMaintainerComment: boolean): number {
  let score = 0

  if (issue.thumbsUpCount > 5) score += 10
  else if (issue.thumbsUpCount > 0) score += 5

  if (issue.commentCount > 0 && issue.commentCount < 20) score += 5
  else if (issue.commentCount >= 20) score -= 5

  if (hasMaintainerComment) score += 5

  return clamp(score, 0, 20)
}

function scoreContentQuality(issue: ExtendedIssue): { raw: number; scaled: number } {
  let raw = 0

  if (issue.bodyPreview.length > 100) raw += 10
  if (issue.bodyPreview.includes('`')) raw += 5
  if (/steps\s+to\s+reproduce|expected|actual/i.test(issue.bodyPreview)) raw += 5
  if (issue.labels.length > 0) raw += 5

  raw = clamp(raw, 0, 25)
  const scaled = Math.round((raw / 25) * 100)
  return { raw, scaled }
}

function scoreCompetition(issue: ExtendedIssue, hasExternalClaimComment: boolean): number {
  if (issue.linkedPrUrls.length > 0) return 0
  if (issue.assignees.length > 0) return 10 // Might be stale assignment
  let score = 15
  if (hasExternalClaimComment) score -= 5
  return clamp(score, 0, 15)
}

function scoreComplexityBonus(difficulty: string): number {
  switch (difficulty) {
    case 'beginner':
      return 15
    case 'intermediate':
      return 10
    case 'advanced':
      return 0
    default:
      return 5
  }
}

function mapDifficultyToComplexity(difficulty: string): Complexity {
  switch (difficulty) {
    case 'beginner':
      return 'low'
    case 'intermediate':
      return 'medium'
    default:
      return 'high'
  }
}

function timingScore(lifecycle: string): number {
  switch (lifecycle) {
    case 'accepted':
      return 100
    case 'triaged':
      return 75
    case 'fresh':
      return 60
    case 'stale':
      return 20
    case 'zombie':
      return 0
    default:
      return 50
  }
}

function cvsTier(cvs: number): CVSTier {
  if (cvs >= 85) return 'go'
  if (cvs >= 70) return 'likely'
  if (cvs >= 50) return 'maybe'
  if (cvs >= 30) return 'risky'
  return 'skip'
}

// ============================================================================
// Claim & Competition Detection
// ============================================================================

const CLAIM_PATTERNS = [
  /\bworking\s+on\s+this/i,
  /\bI'?ll\s+take\s+this/i,
  /\bI'?ll\s+work\s+on/i,
  /\bI'?m\s+on\s+it/i
]

function resolveClaimStatus(
  issue: ExtendedIssue,
  claims: ClaimRecord[]
): { status: ClaimStatus; author: string | null } {
  const claim = claims.find(c => c.issueId === issue.id)
  if (claim) {
    const staleDays = daysSince(claim.claimedAt)
    if (staleDays > 14) {
      return { status: 'stale-claim', author: claim.claimedBy }
    }
    return { status: 'claimed', author: claim.claimedBy }
  }

  if (issue.assignees.length > 0) {
    return { status: 'claimed', author: issue.assignees[0] }
  }

  return { status: 'unclaimed', author: null }
}

function resolveCompetitionLevel(issue: ExtendedIssue): CompetitionLevel {
  if (issue.linkedPrUrls.length > 0) return 'high'
  if (issue.assignees.length > 0) return 'medium'
  if (issue.commentCount > 10) return 'low'
  return 'none'
}

// ============================================================================
// Main Scorer
// ============================================================================

export function scoreIssues(
  issues: ExtendedIssue[],
  comments: IssueComments,
  health: RepoHealth | null,
  claims: ClaimRecord[]
): ScoredIssue[] {
  // Kill signal short-circuit
  if (health?.killed) {
    return issues.map(issue => ({
      ...issue,
      cvs: 0,
      cvsTier: 'skip' as CVSTier,
      lifecycleStage: classifyLifecycle(issue, comments[issue.id]),
      claimStatus: 'unclaimed' as ClaimStatus,
      claimAuthor: null,
      complexity: 'medium' as Complexity,
      sentimentScore: 0,
      contentQualityScore: 0,
      competitionLevel: 'none' as CompetitionLevel,
      repoSlug: health.slug,
      dataCompleteness: 'full' as DataCompleteness,
      repoKilled: true
    }))
  }

  const repoScore = health ? health.overallViability : 50
  const repoSlug = health?.slug ?? ''
  const dataBase: DataCompleteness = health ? 'full' : 'partial'

  const scored = issues.map(issue => {
    const thread = comments[issue.id]

    // Lifecycle
    const lifecycleStage = classifyLifecycle(issue, thread)

    // Sentiment
    const sentiment = thread ? analyzeSentiment(thread) : { score: 0, signals: [] }

    // Difficulty via existing scoring engine
    const diffResult = scoreIssue({
      title: issue.title,
      body: issue.bodyPreview,
      labels: issue.labels,
      beginnerLabels: DEFAULT_BEGINNER_LABELS
    })

    // Check for maintainer and external claim comments
    let hasMaintainerComment = false
    let hasExternalClaimComment = false
    if (thread) {
      for (const comment of thread.comments) {
        if (isMaintainer(comment.authorAssociation)) hasMaintainerComment = true
        if (!isMaintainer(comment.authorAssociation)) {
          if (CLAIM_PATTERNS.some(p => p.test(comment.body))) hasExternalClaimComment = true
        }
      }
    }

    // Sub-dimensions
    const freshness = scoreFreshness(issue)
    const activity = scoreActivity(issue, hasMaintainerComment)
    const contentQuality = scoreContentQuality(issue)
    const competition = scoreCompetition(issue, hasExternalClaimComment)
    const complexityBonus = scoreComplexityBonus(diffResult.difficulty)

    const issueScore = clamp(
      freshness + activity + contentQuality.raw + competition + complexityBonus,
      0,
      100
    )
    const timing = timingScore(lifecycleStage)

    // CVS composite
    const rawCvs = repoScore * 0.3 + issueScore * 0.5 + timing * 0.2
    const cvs = clamp(Math.round(rawCvs), 0, 100)

    // Claim & competition
    const claimResult = resolveClaimStatus(issue, claims)
    const competitionLevel = resolveCompetitionLevel(issue)
    const complexity = mapDifficultyToComplexity(diffResult.difficulty)

    // Data completeness
    const dataCompleteness: DataCompleteness =
      dataBase === 'partial' || !thread ? 'partial' : 'full'

    return {
      ...issue,
      cvs,
      cvsTier: cvsTier(cvs),
      lifecycleStage,
      claimStatus: claimResult.status,
      claimAuthor: claimResult.author,
      complexity,
      sentimentScore: Math.round(sentiment.score * 100) / 100,
      contentQualityScore: contentQuality.scaled,
      competitionLevel,
      repoSlug,
      dataCompleteness,
      repoKilled: false
    } satisfies ScoredIssue
  })

  // Sort by CVS descending
  scored.sort((a, b) => b.cvs - a.cvs)
  return scored
}
