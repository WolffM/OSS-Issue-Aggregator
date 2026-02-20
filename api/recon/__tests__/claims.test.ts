import { describe, it, expect } from 'vitest'
import { addClaim, removeClaim } from '../claims'
import { createMockKV, makeClaimRecord } from './helpers'
import type { ClaimRecord } from '../types'

describe('addClaim', () => {
  it('adds a claim to empty claims list', async () => {
    const kv = createMockKV()
    const result = await addClaim(kv, 'fastify-fastify', {
      issueId: 'github-fastify-fastify-100',
      claimedBy: 'testuser'
    })

    expect(result.issueId).toBe('github-fastify-fastify-100')
    expect(result.claimedBy).toBe('testuser')
    expect(result.forkIssueUrl).toBeNull()
    expect(result.claimedAt).toBeTruthy()

    // Verify it's in KV
    const stored = await kv.get<ClaimRecord[]>('recon:fastify-fastify:claims', 'json')
    expect(stored).toHaveLength(1)
    expect(stored![0].issueId).toBe('github-fastify-fastify-100')
  })

  it('includes forkIssueUrl when provided', async () => {
    const kv = createMockKV()
    const result = await addClaim(kv, 'fastify-fastify', {
      issueId: 'github-fastify-fastify-100',
      claimedBy: 'testuser',
      forkIssueUrl: 'https://github.com/testuser/fastify/issues/1'
    })

    expect(result.forkIssueUrl).toBe('https://github.com/testuser/fastify/issues/1')
  })

  it('deduplicates by issueId — replaces existing claim', async () => {
    const existingClaim = makeClaimRecord({
      issueId: 'github-fastify-fastify-100',
      claimedBy: 'olduser'
    })
    const kv = createMockKV({
      'recon:fastify-fastify:claims': [existingClaim]
    })

    const result = await addClaim(kv, 'fastify-fastify', {
      issueId: 'github-fastify-fastify-100',
      claimedBy: 'newuser'
    })

    expect(result.claimedBy).toBe('newuser')

    const stored = await kv.get<ClaimRecord[]>('recon:fastify-fastify:claims', 'json')
    expect(stored).toHaveLength(1)
    expect(stored![0].claimedBy).toBe('newuser')
  })

  it('appends new claim without removing others', async () => {
    const existingClaim = makeClaimRecord({
      issueId: 'github-fastify-fastify-100',
      claimedBy: 'user1'
    })
    const kv = createMockKV({
      'recon:fastify-fastify:claims': [existingClaim]
    })

    await addClaim(kv, 'fastify-fastify', {
      issueId: 'github-fastify-fastify-200',
      claimedBy: 'user2'
    })

    const stored = await kv.get<ClaimRecord[]>('recon:fastify-fastify:claims', 'json')
    expect(stored).toHaveLength(2)
    expect(stored!.map(c => c.issueId)).toEqual([
      'github-fastify-fastify-100',
      'github-fastify-fastify-200'
    ])
  })
})

describe('removeClaim', () => {
  it('removes an existing claim', async () => {
    const claim = makeClaimRecord({ issueId: 'github-fastify-fastify-100' })
    const kv = createMockKV({
      'recon:fastify-fastify:claims': [claim]
    })

    const result = await removeClaim(kv, 'fastify-fastify', 'github-fastify-fastify-100')
    expect(result).toBe(true)

    const stored = await kv.get<ClaimRecord[]>('recon:fastify-fastify:claims', 'json')
    expect(stored).toHaveLength(0)
  })

  it('returns false for non-existent claim', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify:claims': []
    })

    const result = await removeClaim(kv, 'fastify-fastify', 'nonexistent-id')
    expect(result).toBe(false)
  })

  it('returns false when no claims key exists', async () => {
    const kv = createMockKV()
    const result = await removeClaim(kv, 'fastify-fastify', 'some-id')
    expect(result).toBe(false)
  })

  it('only removes the targeted claim', async () => {
    const claims = [
      makeClaimRecord({ issueId: 'issue-1', claimedBy: 'user1' }),
      makeClaimRecord({ issueId: 'issue-2', claimedBy: 'user2' }),
      makeClaimRecord({ issueId: 'issue-3', claimedBy: 'user3' })
    ]
    const kv = createMockKV({
      'recon:fastify-fastify:claims': claims
    })

    await removeClaim(kv, 'fastify-fastify', 'issue-2')

    const stored = await kv.get<ClaimRecord[]>('recon:fastify-fastify:claims', 'json')
    expect(stored).toHaveLength(2)
    expect(stored!.map(c => c.issueId)).toEqual(['issue-1', 'issue-3'])
  })
})
