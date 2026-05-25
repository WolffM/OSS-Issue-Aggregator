import { describe, it, expect } from 'vitest'
import { computeDispatchReadiness, READINESS_FLAGS } from '../dispatch-readiness'
import { makeExtendedIssue } from './helpers'

// Anchor "now" so timeline-event windows are deterministic regardless of when
// the test runs. All event timestamps below are relative to this instant.
const NOW = new Date('2026-05-24T12:00:00Z')

function daysAgoIso(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

describe('computeDispatchReadiness — stub mode (Tier-3 fields absent)', () => {
  it('returns score 1.0 with no flags when all readiness signals are absent', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: [],
      commentCount: 0,
      // Use a recent updatedAt so the stale-discussion penalty cannot fire.
      updatedAt: daysAgoIso(1)
    })
    const { score, flags } = computeDispatchReadiness(issue, NOW)
    expect(score).toBe(1.0)
    expect(flags).toEqual([])
  })

  it('treats missing Tier-3 fields as the absent-default (no penalty)', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: [],
      commentCount: 0,
      updatedAt: daysAgoIso(1)
    })
    expect(issue.subIssues).toBeUndefined()
    expect(issue.recentTimelineEvents).toBeUndefined()
    expect(issue.commenterMix).toBeUndefined()
    const { score, flags } = computeDispatchReadiness(issue, NOW)
    expect(score).toBe(1.0)
    expect(flags).toHaveLength(0)
  })
})

describe('computeDispatchReadiness — individual penalties', () => {
  it('fires epic_shape when subIssues.count >= 5', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: [],
      commentCount: 0,
      updatedAt: daysAgoIso(1),
      subIssues: { count: 5, open: 3, closed: 2 }
    })
    const { score, flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).toContain(READINESS_FLAGS.EPIC_SHAPE)
    expect(score).toBeCloseTo(0.7, 5)
  })

  it('does not fire epic_shape when subIssues.count < 5 and no epic labels', () => {
    const issue = makeExtendedIssue({
      labels: ['bug'],
      linkedPrUrls: [],
      commentCount: 0,
      updatedAt: daysAgoIso(1),
      subIssues: { count: 4, open: 2, closed: 2 }
    })
    const { flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).not.toContain(READINESS_FLAGS.EPIC_SHAPE)
  })

  it.each(['epic', 'tracking', 'umbrella', 'Tracking', 'EPIC'])(
    'fires epic_shape when labels contain %s (case-insensitive)',
    label => {
      const issue = makeExtendedIssue({
        labels: [label],
        linkedPrUrls: [],
        commentCount: 0,
        updatedAt: daysAgoIso(1)
      })
      const { flags } = computeDispatchReadiness(issue, NOW)
      expect(flags).toContain(READINESS_FLAGS.EPIC_SHAPE)
    }
  )

  it('fires active_linked_pr when linkedPrUrls is non-empty', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: ['https://github.com/example/repo/pull/42'],
      commentCount: 0,
      updatedAt: daysAgoIso(1)
    })
    const { score, flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).toContain(READINESS_FLAGS.ACTIVE_LINKED_PR)
    expect(score).toBeCloseTo(0.7, 5)
  })

  it('fires team_reassignment_recent when a team_reassigned event is <30d old', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: [],
      commentCount: 0,
      updatedAt: daysAgoIso(1),
      recentTimelineEvents: [
        {
          event: 'team_reassigned',
          actor: 'maintainer1',
          at: daysAgoIso(10),
          detail: 'Reassigned to team-platform'
        }
      ]
    })
    const { score, flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).toContain(READINESS_FLAGS.TEAM_REASSIGNMENT_RECENT)
    expect(score).toBeCloseTo(0.8, 5)
  })

  it('does not fire team_reassignment_recent when the event is outside the 30d window', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: [],
      commentCount: 0,
      updatedAt: daysAgoIso(1),
      recentTimelineEvents: [
        {
          event: 'team_reassigned',
          actor: 'maintainer1',
          at: daysAgoIso(31),
          detail: 'Reassigned a month+ ago'
        }
      ]
    })
    const { flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).not.toContain(READINESS_FLAGS.TEAM_REASSIGNMENT_RECENT)
  })

  it('fires maintainer_debate when commenterMix.maintainers >= 3', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: [],
      commentCount: 0,
      updatedAt: daysAgoIso(1),
      commenterMix: { count: 12, distinct: 6, maintainers: 3 }
    })
    const { score, flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).toContain(READINESS_FLAGS.MAINTAINER_DEBATE)
    expect(score).toBeCloseTo(0.85, 5)
  })

  it('does not fire maintainer_debate when maintainer count is below threshold', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: [],
      commentCount: 0,
      updatedAt: daysAgoIso(1),
      commenterMix: { count: 8, distinct: 4, maintainers: 2 }
    })
    const { flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).not.toContain(READINESS_FLAGS.MAINTAINER_DEBATE)
  })

  it('fires stale_discussion when updatedAt > 12 months ago AND comments > 0', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: [],
      commentCount: 3,
      updatedAt: daysAgoIso(400)
    })
    const { score, flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).toContain(READINESS_FLAGS.STALE_DISCUSSION)
    expect(score).toBeCloseTo(0.9, 5)
  })

  it('does not fire stale_discussion when comments == 0', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: [],
      commentCount: 0,
      updatedAt: daysAgoIso(400)
    })
    const { flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).not.toContain(READINESS_FLAGS.STALE_DISCUSSION)
  })

  it('does not fire stale_discussion when updatedAt is within 12 months', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: [],
      commentCount: 5,
      updatedAt: daysAgoIso(300)
    })
    const { flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).not.toContain(READINESS_FLAGS.STALE_DISCUSSION)
  })

  it('fires title_changed_recent when a renamed event is <90d old', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: [],
      commentCount: 0,
      updatedAt: daysAgoIso(1),
      recentTimelineEvents: [
        {
          event: 'renamed',
          actor: 'maintainer1',
          at: daysAgoIso(45),
          detail: 'Title changed from "Add foo" to "Add foo and bar"'
        }
      ]
    })
    const { score, flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).toContain(READINESS_FLAGS.TITLE_CHANGED_RECENT)
    expect(score).toBeCloseTo(0.9, 5)
  })

  it('does not fire title_changed_recent when rename is outside the 90d window', () => {
    const issue = makeExtendedIssue({
      labels: [],
      linkedPrUrls: [],
      commentCount: 0,
      updatedAt: daysAgoIso(1),
      recentTimelineEvents: [
        {
          event: 'renamed',
          actor: 'maintainer1',
          at: daysAgoIso(120),
          detail: 'Old rename'
        }
      ]
    })
    const { flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).not.toContain(READINESS_FLAGS.TITLE_CHANGED_RECENT)
  })
})

describe('computeDispatchReadiness — multi-penalty & clamping', () => {
  it('sums multiple penalties and clamps to [0, 1]', () => {
    // Fire everything: 0.30 + 0.30 + 0.20 + 0.15 + 0.10 + 0.10 = 1.15 → clamp to 0
    const issue = makeExtendedIssue({
      labels: ['epic'],
      linkedPrUrls: ['https://github.com/example/repo/pull/42'],
      commentCount: 5,
      updatedAt: daysAgoIso(400),
      subIssues: { count: 7, open: 4, closed: 3 },
      commenterMix: { count: 15, distinct: 8, maintainers: 4 },
      recentTimelineEvents: [
        {
          event: 'team_reassigned',
          actor: 'maintainer1',
          at: daysAgoIso(5),
          detail: 'Reassigned'
        },
        {
          event: 'renamed',
          actor: 'maintainer2',
          at: daysAgoIso(20),
          detail: 'Renamed'
        }
      ]
    })
    const { score, flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).toHaveLength(6)
    expect(flags).toEqual(
      expect.arrayContaining([
        READINESS_FLAGS.EPIC_SHAPE,
        READINESS_FLAGS.ACTIVE_LINKED_PR,
        READINESS_FLAGS.TEAM_REASSIGNMENT_RECENT,
        READINESS_FLAGS.MAINTAINER_DEBATE,
        READINESS_FLAGS.STALE_DISCUSSION,
        READINESS_FLAGS.TITLE_CHANGED_RECENT
      ])
    )
    expect(score).toBe(0)
  })

  it('sums two penalties to the expected partial score', () => {
    // epic_shape (0.30) + active_linked_pr (0.30) = 0.60 penalty → score 0.40
    const issue = makeExtendedIssue({
      labels: ['epic'],
      linkedPrUrls: ['https://github.com/example/repo/pull/42'],
      commentCount: 0,
      updatedAt: daysAgoIso(1)
    })
    const { score, flags } = computeDispatchReadiness(issue, NOW)
    expect(flags).toEqual(
      expect.arrayContaining([READINESS_FLAGS.EPIC_SHAPE, READINESS_FLAGS.ACTIVE_LINKED_PR])
    )
    expect(flags).toHaveLength(2)
    expect(score).toBeCloseTo(0.4, 5)
  })
})
