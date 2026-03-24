/**
 * Issue Lifecycle Classifier
 *
 * Classifies issue lifecycle stage based on metadata and comments.
 * Lifecycle describes maintainer engagement, not contribution readiness.
 */

import type { ExtendedIssue, CommentThread, LifecycleStage } from './types'
import { isMaintainer, daysSince } from './utils'

const ACCEPTANCE_PATTERNS: RegExp[] = [
  /\bPR\s+welcome/i,
  /\baccepting\s+PRs?\b/i,
  /\bwould\s+accept\s+a\s+PR/i,
  /\bcontributions?\s+welcome/i,
  /\bfeel\s+free\s+to/i,
  /\bhappy\s+to\s+review/i
]

const GOOD_FIRST_ISSUE_PATTERNS = [/good.?first.?issue/i]

export function classifyLifecycle(
  issue: ExtendedIssue,
  comments: CommentThread | undefined
): LifecycleStage {
  // Determine last activity date
  const activityDates = [issue.updatedAt]
  if (issue.lastCommentAt) activityDates.push(issue.lastCommentAt)
  const lastActivity = activityDates.sort().reverse()[0]
  const daysSinceActivity = daysSince(lastActivity)

  // 1. zombie: > 180 days no activity
  if (daysSinceActivity > 180) return 'zombie'

  // 2. stale: > 60 days no activity
  if (daysSinceActivity > 60) return 'stale'

  // 3. accepted: maintainer explicitly confirmed
  // Check for "good first issue" label (strong acceptance signal)
  const hasGoodFirstIssue = issue.labels.some(label =>
    GOOD_FIRST_ISSUE_PATTERNS.some(pattern => pattern.test(label))
  )
  if (hasGoodFirstIssue) return 'accepted'

  // Check for milestone (maintainer planning signal)
  if (issue.milestone) return 'accepted'

  // Check for maintainer acceptance comment
  if (comments) {
    for (const comment of comments.comments) {
      if (!isMaintainer(comment.authorAssociation)) continue
      if (ACCEPTANCE_PATTERNS.some(pattern => pattern.test(comment.body))) {
        return 'accepted'
      }
    }
  }

  // 4. triaged: has maintainer comment or labels indicating triage
  if (comments) {
    const hasMaintainerComment = comments.comments.some(comment =>
      isMaintainer(comment.authorAssociation)
    )
    if (hasMaintainerComment) return 'triaged'
  }

  // 5. fresh: default
  return 'fresh'
}
