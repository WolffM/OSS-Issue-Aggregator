import { describe, it, expect } from 'vitest'
import { analyzeSentiment } from '../sentiment'
import { makeComment, makeCommentThread } from './helpers'

describe('analyzeSentiment', () => {
  it('returns 0 score for empty comments', () => {
    const thread = makeCommentThread([])
    const result = analyzeSentiment(thread)
    expect(result.score).toBe(0)
    expect(result.signals).toEqual([])
  })

  it('detects positive "PR welcome" from maintainer', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'PR welcome! Feel free to submit a fix.', authorAssociation: 'MEMBER' })
    ])
    const result = analyzeSentiment(thread)
    expect(result.score).toBeGreaterThan(0)
    expect(result.signals.length).toBeGreaterThan(0)
  })

  it('detects positive "contributions welcome"', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'Contributions welcome on this.', authorAssociation: 'OWNER' })
    ])
    const result = analyzeSentiment(thread)
    expect(result.score).toBeGreaterThan(0)
  })

  it('detects negative "won\'t fix" from maintainer', () => {
    const thread = makeCommentThread([
      makeComment({ body: "This is by design, won't fix.", authorAssociation: 'MEMBER' })
    ])
    const result = analyzeSentiment(thread)
    expect(result.score).toBeLessThan(0)
  })

  it('detects negative "not planned"', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'Not planned for the roadmap.', authorAssociation: 'OWNER' })
    ])
    const result = analyzeSentiment(thread)
    expect(result.score).toBeLessThan(0)
  })

  it('detects negative "duplicate of"', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'Duplicate of #42.', authorAssociation: 'MEMBER' })
    ])
    const result = analyzeSentiment(thread)
    expect(result.score).toBeLessThan(0)
  })

  it('detects external claim "working on this" as negative', () => {
    const thread = makeCommentThread([
      makeComment({
        body: "I'm working on this!",
        author: 'external-dev',
        authorAssociation: 'NONE'
      })
    ])
    const result = analyzeSentiment(thread)
    expect(result.score).toBeLessThan(0)
    expect(result.signals.some(s => s.startsWith('claim:'))).toBe(true)
  })

  it('does not treat maintainer "working on this" as claim', () => {
    const thread = makeCommentThread([
      makeComment({
        body: "I'm working on this",
        author: 'maintainer1',
        authorAssociation: 'MEMBER'
      })
    ])
    const result = analyzeSentiment(thread)
    // Should not have claim signal
    expect(result.signals.some(s => s.startsWith('claim:'))).toBe(false)
  })

  it('filters out bot comments', () => {
    const thread = makeCommentThread([
      makeComment({
        body: 'PR welcome',
        author: 'dependabot[bot]',
        authorAssociation: 'NONE'
      })
    ])
    const result = analyzeSentiment(thread)
    expect(result.score).toBe(0)
    expect(result.signals).toEqual([])
  })

  it('weights maintainer comments 2x', () => {
    // One positive maintainer comment vs one negative external comment
    const thread = makeCommentThread([
      makeComment({
        body: 'PR welcome!',
        authorAssociation: 'MEMBER'
      }),
      makeComment({
        body: 'Duplicate of another issue.',
        author: 'random-user',
        authorAssociation: 'NONE'
      })
    ])
    const result = analyzeSentiment(thread)
    // Maintainer weight=2 positive, external weight=1 negative → net positive
    expect(result.score).toBeGreaterThan(0)
  })

  it('handles mixed signals', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'Good idea, makes sense.', authorAssociation: 'MEMBER' }),
      makeComment({
        body: 'But we need RFC first.',
        authorAssociation: 'MEMBER'
      })
    ])
    const result = analyzeSentiment(thread)
    // Both signals present
    expect(result.signals.length).toBe(2)
  })

  it('clamps score to [-1, 1]', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'PR welcome', authorAssociation: 'OWNER' }),
      makeComment({ body: 'Agreed!', authorAssociation: 'MEMBER' }),
      makeComment({ body: 'LGTM', authorAssociation: 'MEMBER' })
    ])
    const result = analyzeSentiment(thread)
    expect(result.score).toBeGreaterThanOrEqual(-1)
    expect(result.score).toBeLessThanOrEqual(1)
  })
})
