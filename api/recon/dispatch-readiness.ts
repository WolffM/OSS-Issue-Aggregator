/**
 * Dispatch Readiness Score
 *
 * Penalty-only deterministic score (cost-control circuit-breaker) for
 * vibedispatch's pre-dispatch gate. See docs/dispatch-readiness-overhaul.md
 * Phase 2 — this is M2.2.
 *
 * Pure function, computed on read (not baked into KV). Boundary:
 * aggregator computes evidence; vibedispatch's LLM judge decides.
 * Score is a hint, not a verdict — no gating logic in this repo.
 *
 * Penalty weights are intentional first guesses pending Phase 0 telemetry.
 */

import type { ExtendedIssue, TimelineEvent } from './types'

export const READINESS_FLAGS = {
  EPIC_SHAPE: 'epic_shape',
  ACTIVE_LINKED_PR: 'active_linked_pr',
  TEAM_REASSIGNMENT_RECENT: 'team_reassignment_recent',
  MAINTAINER_DEBATE: 'maintainer_debate',
  STALE_DISCUSSION: 'stale_discussion',
  TITLE_CHANGED_RECENT: 'title_changed_recent'
} as const

export type ReadinessFlag = (typeof READINESS_FLAGS)[keyof typeof READINESS_FLAGS]

const PENALTY: Record<ReadinessFlag, number> = {
  epic_shape: 0.3,
  active_linked_pr: 0.3,
  team_reassignment_recent: 0.2,
  maintainer_debate: 0.15,
  stale_discussion: 0.1,
  title_changed_recent: 0.1
}

const EPIC_LABELS = new Set(['epic', 'tracking', 'umbrella'])

const SUB_ISSUE_EPIC_THRESHOLD = 5
const MAINTAINER_DEBATE_THRESHOLD = 3
const TEAM_REASSIGN_WINDOW_DAYS = 30
const TITLE_CHANGE_WINDOW_DAYS = 90
const STALE_WINDOW_DAYS = 365

const TEAM_REASSIGN_EVENTS = new Set(['team_reassigned', 'assigned', 'unassigned'])
const TITLE_CHANGE_EVENTS = new Set(['renamed', 'title_changed'])

export interface DispatchReadiness {
  score: number
  flags: ReadinessFlag[]
}

function daysAgo(iso: string, now: Date): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY
  return (now.getTime() - t) / 86_400_000
}

function hasRecentEvent(
  events: TimelineEvent[] | undefined,
  matchEvent: (event: string) => boolean,
  windowDays: number,
  now: Date
): boolean {
  if (!events || events.length === 0) return false
  return events.some(e => matchEvent(e.event) && daysAgo(e.at, now) <= windowDays)
}

function hasEpicShape(issue: ExtendedIssue): boolean {
  const subIssueCount = issue.subIssues?.count ?? 0
  if (subIssueCount >= SUB_ISSUE_EPIC_THRESHOLD) return true
  const labels = issue.labels ?? []
  return labels.some(l => EPIC_LABELS.has(l.toLowerCase()))
}

function hasActiveLinkedPr(issue: ExtendedIssue): boolean {
  // Stub-mode approximation: any linked PR URL counts. Phase 1 scraper work
  // (Tier 1 reject) is expected to filter issues with open linked PRs upstream,
  // so this penalty is belt-and-suspenders once the scraper ships.
  return (issue.linkedPrUrls?.length ?? 0) > 0
}

function isStaleWithDiscussion(issue: ExtendedIssue, now: Date): boolean {
  if (!issue.updatedAt) return false
  if ((issue.commentCount ?? 0) <= 0) return false
  return daysAgo(issue.updatedAt, now) > STALE_WINDOW_DAYS
}

/**
 * Compute the dispatch readiness score + triggered flags for an issue.
 *
 * Stub mode: any of the Tier-3 fields (subIssues, recentTimelineEvents,
 * commenterMix) absent → that field's penalty defers to absent semantics
 * (defaults to "not triggered"). Score returns 1.0 when no penalties fire.
 *
 * @param issue   Extended issue (Tier-3 fields optional; missing → safe defaults)
 * @param now     Clock injection seam for deterministic tests (default: Date.now)
 */
export function computeDispatchReadiness(
  issue: ExtendedIssue,
  now: Date = new Date()
): DispatchReadiness {
  const flags: ReadinessFlag[] = []

  if (hasEpicShape(issue)) flags.push(READINESS_FLAGS.EPIC_SHAPE)
  if (hasActiveLinkedPr(issue)) flags.push(READINESS_FLAGS.ACTIVE_LINKED_PR)
  if (
    hasRecentEvent(
      issue.recentTimelineEvents,
      e => TEAM_REASSIGN_EVENTS.has(e),
      TEAM_REASSIGN_WINDOW_DAYS,
      now
    )
  ) {
    flags.push(READINESS_FLAGS.TEAM_REASSIGNMENT_RECENT)
  }
  if ((issue.commenterMix?.maintainers ?? 0) >= MAINTAINER_DEBATE_THRESHOLD) {
    flags.push(READINESS_FLAGS.MAINTAINER_DEBATE)
  }
  if (isStaleWithDiscussion(issue, now)) flags.push(READINESS_FLAGS.STALE_DISCUSSION)
  if (
    hasRecentEvent(
      issue.recentTimelineEvents,
      e => TITLE_CHANGE_EVENTS.has(e),
      TITLE_CHANGE_WINDOW_DAYS,
      now
    )
  ) {
    flags.push(READINESS_FLAGS.TITLE_CHANGED_RECENT)
  }

  const penalty = flags.reduce((sum, f) => sum + PENALTY[f], 0)
  const score = Math.max(0, Math.min(1, 1 - penalty))

  return { score, flags }
}
