/**
 * Comment Digest Extraction
 *
 * Extracts structured context from comment threads without ML.
 * Produces a CommentDigest with participant counts, scope/implementation
 * discussion signals, issue references, and consensus detection.
 *
 * Pure function — no side effects.
 */

import type { CommentThread, CommentDigest } from './types'
import { isMaintainer, isBot } from './utils'

const SCOPE_PATTERNS: RegExp[] = [
  /\bscope\b/i,
  /\bredesign\b/i,
  /\binstead\b/i,
  /\bout of scope\b/i,
  /\bscope creep\b/i,
  /\bnarrow\s+(?:the\s+)?scope\b/i,
  /\bbroader\s+(?:than|scope)\b/i
]

const IMPLEMENTATION_PATTERNS: RegExp[] = [
  /\bapproach\b/i,
  /\bimplementation\b/i,
  /\bwe should\b/i,
  /\bproposed\b/i,
  /\bwhat if we\b/i,
  /\barchitect(?:ure)?\b/i,
  /\bstrategy\b/i,
  /\brefactor\b/i
]

const ISSUE_REF_PATTERN =
  /(?:#(\d+)|(?:https?:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/(\d+)))/g

export function extractCommentDigest(thread: CommentThread, sentimentScore: number): CommentDigest {
  const participants = new Set<string>()
  const maintainerParticipants = new Set<string>()
  let lastMaintainerComment: string | null = null
  let discussedScope = false
  let discussedImplementation = false
  const referencedIssues = new Set<string>()

  for (const comment of thread.comments) {
    if (isBot(comment.author)) continue

    participants.add(comment.author)

    if (isMaintainer(comment.authorAssociation)) {
      maintainerParticipants.add(comment.author)
      lastMaintainerComment = comment.body
    }

    if (!discussedScope) {
      for (const pattern of SCOPE_PATTERNS) {
        if (pattern.test(comment.body)) {
          discussedScope = true
          break
        }
      }
    }

    if (!discussedImplementation) {
      for (const pattern of IMPLEMENTATION_PATTERNS) {
        if (pattern.test(comment.body)) {
          discussedImplementation = true
          break
        }
      }
    }

    for (const match of comment.body.matchAll(ISSUE_REF_PATTERN)) {
      const num = match[1] ?? match[2]
      if (num) {
        referencedIssues.add(`#${num}`)
      }
    }
  }

  const truncatedMaintainerComment = lastMaintainerComment
    ? lastMaintainerComment.slice(0, 200)
    : null

  const hasConsensus = sentimentScore > 0 && maintainerParticipants.size > 0

  return {
    participantCount: participants.size,
    maintainerParticipantCount: maintainerParticipants.size,
    lastMaintainerComment: truncatedMaintainerComment,
    discussedScope,
    discussedImplementation,
    referencedIssues: [...referencedIssues].sort(),
    hasConsensus
  }
}
