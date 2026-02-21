import { describe, it, expect } from 'vitest'
import { classifyLifecycle } from '../lifecycle'
import { makeExtendedIssue, makeComment, makeCommentThread } from './helpers'

describe('classifyLifecycle', () => {
  it('classifies zombie issues (>180 days inactive)', () => {
    const issue = makeExtendedIssue({
      updatedAt: '2023-01-01T00:00:00Z',
      lastCommentAt: '2023-01-01T00:00:00Z'
    })
    const result = classifyLifecycle(issue, undefined)
    expect(result).toBe('zombie')
  })

  it('classifies stale issues (>60 days inactive)', () => {
    const staleDate = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const issue = makeExtendedIssue({
      updatedAt: staleDate,
      lastCommentAt: staleDate
    })
    const result = classifyLifecycle(issue, undefined)
    expect(result).toBe('stale')
  })

  it('classifies accepted when has good first issue label', () => {
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const issue = makeExtendedIssue({
      labels: ['good first issue', 'enhancement'],
      updatedAt: recent,
      lastCommentAt: recent
    })
    const result = classifyLifecycle(issue, undefined)
    expect(result).toBe('accepted')
  })

  it('classifies accepted when milestone is set', () => {
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const issue = makeExtendedIssue({
      labels: ['bug'],
      milestone: 'v3.0',
      updatedAt: recent,
      lastCommentAt: recent
    })
    const result = classifyLifecycle(issue, undefined)
    expect(result).toBe('accepted')
  })

  it('classifies accepted when maintainer says "PR welcome"', () => {
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const issue = makeExtendedIssue({
      labels: ['bug'],
      updatedAt: recent,
      lastCommentAt: recent
    })
    const thread = makeCommentThread([
      makeComment({
        body: 'PR welcome for this fix!',
        authorAssociation: 'MEMBER'
      })
    ])
    const result = classifyLifecycle(issue, thread)
    expect(result).toBe('accepted')
  })

  it('does not classify accepted if non-maintainer says "PR welcome"', () => {
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const issue = makeExtendedIssue({
      labels: ['bug'],
      updatedAt: recent,
      lastCommentAt: recent
    })
    const thread = makeCommentThread([
      makeComment({
        body: 'PR welcome!',
        author: 'random-user',
        authorAssociation: 'NONE'
      })
    ])
    const result = classifyLifecycle(issue, thread)
    // Should be triaged (has a comment) but not accepted
    expect(result).not.toBe('accepted')
  })

  it('classifies triaged when has maintainer comment', () => {
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const issue = makeExtendedIssue({
      labels: ['bug'],
      updatedAt: recent,
      lastCommentAt: recent
    })
    const thread = makeCommentThread([
      makeComment({
        body: 'Thanks for reporting. We will look into this.',
        authorAssociation: 'MEMBER'
      })
    ])
    const result = classifyLifecycle(issue, thread)
    expect(result).toBe('triaged')
  })

  it('classifies fresh when no maintainer engagement', () => {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const issue = makeExtendedIssue({
      labels: ['bug'],
      updatedAt: recent,
      lastCommentAt: null
    })
    const result = classifyLifecycle(issue, undefined)
    expect(result).toBe('fresh')
  })

  it('classifies fresh with only external comments', () => {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const issue = makeExtendedIssue({
      labels: ['bug'],
      updatedAt: recent,
      lastCommentAt: recent
    })
    const thread = makeCommentThread([
      makeComment({
        body: 'I have this issue too.',
        author: 'random-user',
        authorAssociation: 'NONE'
      })
    ])
    const result = classifyLifecycle(issue, thread)
    expect(result).toBe('fresh')
  })

  it('stale/zombie takes precedence over accepted labels', () => {
    const issue = makeExtendedIssue({
      labels: ['good first issue'],
      updatedAt: '2022-01-01T00:00:00Z',
      lastCommentAt: '2022-01-01T00:00:00Z'
    })
    const result = classifyLifecycle(issue, undefined)
    expect(result).toBe('zombie')
  })
})
