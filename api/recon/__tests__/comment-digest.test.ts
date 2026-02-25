import { describe, it, expect } from 'vitest'
import { extractCommentDigest } from '../comment-digest'
import { makeComment, makeCommentThread } from './helpers'

describe('extractCommentDigest', () => {
  it('returns zero counts for empty thread', () => {
    const thread = makeCommentThread([])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.participantCount).toBe(0)
    expect(digest.maintainerParticipantCount).toBe(0)
    expect(digest.lastMaintainerComment).toBeNull()
    expect(digest.discussedScope).toBe(false)
    expect(digest.discussedImplementation).toBe(false)
    expect(digest.referencedIssues).toEqual([])
    expect(digest.hasConsensus).toBe(false)
  })

  it('counts unique participants excluding bots', () => {
    const thread = makeCommentThread([
      makeComment({ author: 'user1', authorAssociation: 'NONE' }),
      makeComment({ author: 'user2', authorAssociation: 'NONE' }),
      makeComment({ author: 'user1', authorAssociation: 'NONE' }),
      makeComment({ author: 'dependabot[bot]', authorAssociation: 'NONE' })
    ])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.participantCount).toBe(2)
  })

  it('counts maintainer participants', () => {
    const thread = makeCommentThread([
      makeComment({ author: 'maintainer1', authorAssociation: 'MEMBER' }),
      makeComment({ author: 'maintainer2', authorAssociation: 'OWNER' }),
      makeComment({ author: 'external', authorAssociation: 'NONE' })
    ])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.maintainerParticipantCount).toBe(2)
    expect(digest.participantCount).toBe(3)
  })

  it('captures last maintainer comment truncated to 200 chars', () => {
    const longBody = 'X'.repeat(300)
    const thread = makeCommentThread([
      makeComment({ author: 'maint', authorAssociation: 'MEMBER', body: 'First comment' }),
      makeComment({ author: 'maint', authorAssociation: 'MEMBER', body: longBody })
    ])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.lastMaintainerComment).toHaveLength(200)
  })

  it('returns full maintainer comment when under 200 chars', () => {
    const thread = makeCommentThread([
      makeComment({
        author: 'maint',
        authorAssociation: 'MEMBER',
        body: 'Looks good, feel free to submit a PR.'
      })
    ])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.lastMaintainerComment).toBe('Looks good, feel free to submit a PR.')
  })

  it('detects scope discussion', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'I think we should narrow the scope of this change' })
    ])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.discussedScope).toBe(true)
  })

  it('detects redesign keyword as scope discussion', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'This is really a redesign of the whole system' })
    ])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.discussedScope).toBe(true)
  })

  it('detects implementation discussion', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'What if we take a different approach to this?' })
    ])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.discussedImplementation).toBe(true)
  })

  it('detects "we should" as implementation discussion', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'We should refactor the parser first.' })
    ])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.discussedImplementation).toBe(true)
  })

  it('extracts #NNN issue references', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'Related to #42 and #108. See also #42 again.' })
    ])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.referencedIssues).toEqual(['#108', '#42'])
  })

  it('extracts full GitHub URL issue references', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'See https://github.com/org/repo/issues/55' })
    ])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.referencedIssues).toContain('#55')
  })

  it('extracts GitHub PR URL references', () => {
    const thread = makeCommentThread([
      makeComment({ body: 'Fixed in https://github.com/org/repo/pull/77' })
    ])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.referencedIssues).toContain('#77')
  })

  it('detects consensus when positive sentiment and maintainer engaged', () => {
    const thread = makeCommentThread([
      makeComment({ author: 'maint', authorAssociation: 'MEMBER', body: 'LGTM' })
    ])
    const digest = extractCommentDigest(thread, 0.5)
    expect(digest.hasConsensus).toBe(true)
  })

  it('no consensus when sentiment is negative', () => {
    const thread = makeCommentThread([
      makeComment({ author: 'maint', authorAssociation: 'MEMBER', body: "Won't fix" })
    ])
    const digest = extractCommentDigest(thread, -0.5)
    expect(digest.hasConsensus).toBe(false)
  })

  it('no consensus when no maintainers participated', () => {
    const thread = makeCommentThread([
      makeComment({ author: 'user', authorAssociation: 'NONE', body: 'Great idea' })
    ])
    const digest = extractCommentDigest(thread, 0.5)
    expect(digest.hasConsensus).toBe(false)
  })

  it('no consensus when sentiment is exactly zero', () => {
    const thread = makeCommentThread([
      makeComment({ author: 'maint', authorAssociation: 'MEMBER', body: 'Noted' })
    ])
    const digest = extractCommentDigest(thread, 0)
    expect(digest.hasConsensus).toBe(false)
  })
})
