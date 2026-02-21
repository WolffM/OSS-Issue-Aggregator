/**
 * Comment Sentiment Analysis
 *
 * Pattern-matching sentiment analysis on comment threads.
 * No ML — just regex matching against known positive/negative signals.
 * Maintainer comments are weighted 2x.
 */

import type { CommentThread } from './types'
import { isMaintainer, isBot } from './utils'

const POSITIVE_PATTERNS: RegExp[] = [
  /\bPR\s+welcome/i,
  /\bwould\s+accept\s+a\s+PR/i,
  /\bcontributions?\s+welcome/i,
  /\bgood\s+idea/i,
  /\bmakes\s+sense/i,
  /\bagreed\b/i,
  /\bfeel\s+free\s+to/i,
  /\bhappy\s+to\s+review/i,
  /\baccepting\s+PRs?\b/i,
  /\blgtm\b/i
]

const NEGATIVE_PATTERNS: RegExp[] = [
  /\bwon'?t\s*fix/i,
  /\bwontfix\b/i,
  /\bby\s+design/i,
  /\bnot\s+planned/i,
  /\bneed\s+RFC/i,
  /\bplease\s+open\s+an\s+issue\s+first/i,
  /\bclosing\s+as\s+stale/i,
  /\bduplicate\s+of/i,
  /\bout\s+of\s+scope/i
]

// These are negative only when said by non-maintainers (external claim signals)
const CLAIM_PATTERNS: RegExp[] = [
  /\bworking\s+on\s+this/i,
  /\bI'?ll\s+take\s+this/i,
  /\bI'?ll\s+work\s+on/i,
  /\bI'?m\s+on\s+it/i
]

export function analyzeSentiment(thread: CommentThread): { score: number; signals: string[] } {
  const signals: string[] = []
  let weightedSum = 0
  let totalWeight = 0

  for (const comment of thread.comments) {
    if (isBot(comment.author)) continue

    const weight = isMaintainer(comment.authorAssociation) ? 2 : 1
    const body = comment.body

    for (const pattern of POSITIVE_PATTERNS) {
      if (pattern.test(body)) {
        weightedSum += weight
        totalWeight += weight
        signals.push(`positive: ${pattern.source}`)
        break
      }
    }

    for (const pattern of NEGATIVE_PATTERNS) {
      if (pattern.test(body)) {
        weightedSum -= weight
        totalWeight += weight
        signals.push(`negative: ${pattern.source}`)
        break
      }
    }

    // Claim patterns are negative only from non-maintainers
    if (!isMaintainer(comment.authorAssociation)) {
      for (const pattern of CLAIM_PATTERNS) {
        if (pattern.test(body)) {
          weightedSum -= 1
          totalWeight += 1
          signals.push(`claim: ${pattern.source}`)
          break
        }
      }
    }
  }

  if (totalWeight === 0) {
    return { score: 0, signals: [] }
  }

  const score = Math.max(-1, Math.min(1, weightedSum / totalWeight))
  return { score, signals }
}
