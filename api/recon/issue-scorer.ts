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
  DataCompleteness,
  CommentThread,
  ScoringMeta
} from './types'
import { scoreIssue } from '../scoring'
import { analyzeSentiment } from './sentiment'
import { classifyLifecycle } from './lifecycle'
import { extractCommentDigest } from './comment-digest'
import { isMaintainer, daysSince, clamp } from './utils'
import { detectRelatedIssues } from './related-issues'

// Default beginner labels for scoreIssue() — covers common OSS conventions
const DEFAULT_BEGINNER_LABELS = ['good first issue', 'help wanted', 'beginner', 'easy', 'starter']

const ALL_SIGNALS = [
  'freshness',
  'activity',
  'contentQuality',
  'competition',
  'complexity',
  'reactions',
  'commentSentiment'
] as const

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

// ============================================================================
// Reaction & Comment Sentiment Scorers (Tier 1 & 2)
// ============================================================================

const REACTION_WEIGHTS: Record<string, number> = {
  THUMBS_UP: 2,
  HEART: 1,
  ROCKET: 1,
  HOORAY: 1,
  THUMBS_DOWN: -2,
  CONFUSED: -1,
  LAUGH: 0,
  EYES: 0
}

function scoreReactions(issue: ExtendedIssue): number {
  if (!issue.reactionGroups || issue.reactionGroups.length === 0) {
    // Fallback: use thumbsUpCount if reactionGroups unavailable
    return clamp(issue.thumbsUpCount * 2, 0, 15)
  }

  let total = 0
  for (const group of issue.reactionGroups) {
    const weight = REACTION_WEIGHTS[group.content] ?? 0
    total += group.totalCount * weight
  }
  return clamp(total, -15, 15)
}

const POSITIVE_SENTIMENT_PATTERNS: RegExp[] = [
  /\+1\b/,
  /\bme\s+too\b/i,
  /\bsame\s+here\b/i,
  /\bsame\s+issue\b/i,
  /\bbump\b/i,
  /\bseconded\b/i,
  /\bagreed\b/i,
  /\bi\s+also\s+need\s+this\b/i,
  /\bneed\s+this\b/i,
  /\bwould\s+love\s+this\b/i,
  /\bplease\s+add\b/i,
  /\bplease\s+fix\b/i,
  /\byes\s+please\b/i
]

const NEGATIVE_SENTIMENT_PATTERNS: RegExp[] = [
  /-1\b/,
  /\bduplicate\s+of\b/i,
  /\bwon'?t\s*fix\b/i,
  /\bwontfix\b/i,
  /\bstale\b/i,
  /\bas\s+designed\b/i,
  /\bnot\s+a\s+bug\b/i,
  /\bclosing\b/i,
  /\bwill\s+not\s+implement\b/i
]

function scoreCommentSentiment(thread: CommentThread | undefined): number {
  if (!thread || thread.comments.length === 0) return 0

  let total = 0
  for (const comment of thread.comments) {
    const body = comment.body

    for (const pattern of POSITIVE_SENTIMENT_PATTERNS) {
      if (pattern.test(body)) {
        total += 3
        break
      }
    }

    for (const pattern of NEGATIVE_SENTIMENT_PATTERNS) {
      if (pattern.test(body)) {
        total -= 3
        break
      }
    }
  }

  return clamp(total, -10, 10)
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
  if (cvs >= 80) return 'go'
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
  const repoScore = health ? health.overallViability : 50
  const repoSlug = health?.slug ?? ''
  const dataBase: DataCompleteness = health ? 'full' : 'partial'
  const scored_at = new Date().toISOString()

  // Detect related issues and likely files across all issues
  const relatedMap = detectRelatedIssues(issues)

  const scored = issues.map(issue => {
    const thread = comments[issue.id]

    // Lifecycle
    const lifecycleStage = classifyLifecycle(issue, thread)

    // Sentiment
    const sentiment = thread ? analyzeSentiment(thread) : { score: 0, signals: [] }

    // Comment digest
    const commentDigest = thread ? extractCommentDigest(thread, sentiment.score) : null

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

    // Tier 1: Reaction-based scoring (±15)
    const reactions = scoreReactions(issue)

    // Tier 2: Comment sentiment scoring (±10)
    const commentSentiment = scoreCommentSentiment(thread)

    const issueScore = clamp(
      freshness + activity + contentQuality.raw + competition + complexityBonus,
      0,
      100
    )
    const timing = timingScore(lifecycleStage)

    // CVS composite: base weighted score + additive reaction & sentiment bonuses
    let rawCvs = repoScore * 0.3 + issueScore * 0.5 + timing * 0.2 + reactions + commentSentiment

    // Post-hoc penalty: linked PRs are a near-disqualifier.
    // If someone already has a PR open, contributing is very unlikely to succeed.
    if (issue.linkedPrUrls.length > 0) {
      rawCvs = Math.min(rawCvs, 35)
    }

    const cvs = clamp(Math.round(rawCvs), 0, 100)

    // Claim & competition
    const claimResult = resolveClaimStatus(issue, claims)
    const competitionLevel = resolveCompetitionLevel(issue)
    const complexity = mapDifficultyToComplexity(diffResult.difficulty)

    // Data completeness
    const dataCompleteness: DataCompleteness =
      dataBase === 'partial' || !thread ? 'partial' : 'full'

    const related = relatedMap.get(issue.id)

    // Track which signals contributed non-zero values
    const signals_used: string[] = []
    if (freshness > 0) signals_used.push('freshness')
    if (activity > 0) signals_used.push('activity')
    if (contentQuality.raw > 0) signals_used.push('contentQuality')
    if (competition > 0) signals_used.push('competition')
    if (complexityBonus > 0) signals_used.push('complexity')
    if (reactions !== 0) signals_used.push('reactions')
    if (commentSentiment !== 0) signals_used.push('commentSentiment')

    const _scoring: ScoringMeta = {
      scored_at,
      data_completeness: dataCompleteness,
      signals_used,
      signals_available: [...ALL_SIGNALS]
    }

    return {
      ...issue,
      cvs,
      cvsTier: cvsTier(cvs),
      lifecycleStage,
      claimStatus: claimResult.status,
      claimAuthor: claimResult.author,
      complexity,
      sentimentScore: Math.round(sentiment.score * 100) / 100,
      sentimentSignals: sentiment.signals,
      commentDigest,
      contentQualityScore: contentQuality.scaled,
      competitionLevel,
      repoSlug,
      dataCompleteness,
      repoKilled: false,
      likelyFiles: related?.likelyFiles ?? [],
      relatedIssues: related?.relatedIssues ?? [],
      _scoring
    } satisfies ScoredIssue
  })

  // Sort by CVS descending
  scored.sort((a, b) => b.cvs - a.cvs)
  return scored
}
