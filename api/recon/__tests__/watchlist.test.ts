import { describe, it, expect } from 'vitest'
import {
  normalizeSlug,
  isValidSlug,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist
} from '../watchlist'
import { createMockKV } from './helpers'

describe('normalizeSlug', () => {
  it('converts owner/repo to owner-repo', () => {
    expect(normalizeSlug('fastify/fastify')).toBe('fastify-fastify')
  })

  it('leaves already-hyphenated slugs unchanged', () => {
    expect(normalizeSlug('fastify-fastify')).toBe('fastify-fastify')
  })

  it('handles multiple slashes', () => {
    expect(normalizeSlug('org/sub/repo')).toBe('org-sub-repo')
  })
})

describe('isValidSlug', () => {
  it('accepts valid hyphenated slugs', () => {
    expect(isValidSlug('fastify-fastify')).toBe(true)
    expect(isValidSlug('pytorch-pytorch')).toBe(true)
    expect(isValidSlug('huggingface-transformers')).toBe(true)
  })

  it('accepts slugs with dots, underscores, numbers', () => {
    expect(isValidSlug('org.name-repo_v2')).toBe(true)
    expect(isValidSlug('user123-project456')).toBe(true)
  })

  it('rejects slugs without a hyphen', () => {
    expect(isValidSlug('nohyphen')).toBe(false)
  })

  it('rejects slugs with slashes', () => {
    expect(isValidSlug('owner/repo')).toBe(false)
  })

  it('rejects empty strings', () => {
    expect(isValidSlug('')).toBe(false)
  })
})

describe('getWatchlist', () => {
  it('returns empty array when KV key does not exist', async () => {
    const kv = createMockKV()
    const result = await getWatchlist(kv)
    expect(result).toEqual([])
  })

  it('returns slugs from KV', async () => {
    const kv = createMockKV({
      'recon:watchlist': ['fastify-fastify', 'pytorch-pytorch']
    })
    const result = await getWatchlist(kv)
    expect(result).toEqual(['fastify-fastify', 'pytorch-pytorch'])
  })
})

describe('addToWatchlist', () => {
  it('adds a new slug to empty watchlist', async () => {
    const kv = createMockKV()
    const result = await addToWatchlist(kv, 'fastify-fastify')
    expect(result).toEqual({ slug: 'fastify-fastify', added: true })

    const watchlist = await getWatchlist(kv)
    expect(watchlist).toContain('fastify-fastify')
  })

  it('normalizes owner/repo format on add', async () => {
    const kv = createMockKV()
    const result = await addToWatchlist(kv, 'fastify/fastify')
    expect(result).toEqual({ slug: 'fastify-fastify', added: true })
  })

  it('does not duplicate existing slugs', async () => {
    const kv = createMockKV({
      'recon:watchlist': ['fastify-fastify']
    })
    const result = await addToWatchlist(kv, 'fastify-fastify')
    expect(result).toEqual({ slug: 'fastify-fastify', added: false })

    const watchlist = await getWatchlist(kv)
    expect(watchlist).toEqual(['fastify-fastify'])
  })

  it('throws on invalid slug format', async () => {
    const kv = createMockKV()
    await expect(addToWatchlist(kv, '')).rejects.toThrow('Invalid slug format')
  })

  it('appends to existing watchlist', async () => {
    const kv = createMockKV({
      'recon:watchlist': ['pytorch-pytorch']
    })
    await addToWatchlist(kv, 'fastify-fastify')
    const watchlist = await getWatchlist(kv)
    expect(watchlist).toEqual(['pytorch-pytorch', 'fastify-fastify'])
  })
})

describe('removeFromWatchlist', () => {
  it('removes an existing slug', async () => {
    const kv = createMockKV({
      'recon:watchlist': ['fastify-fastify', 'pytorch-pytorch']
    })
    const result = await removeFromWatchlist(kv, 'fastify-fastify')
    expect(result).toEqual({ slug: 'fastify-fastify', removed: true })

    const watchlist = await getWatchlist(kv)
    expect(watchlist).toEqual(['pytorch-pytorch'])
  })

  it('returns removed: false for non-existent slug', async () => {
    const kv = createMockKV({
      'recon:watchlist': ['fastify-fastify']
    })
    const result = await removeFromWatchlist(kv, 'nonexistent-repo')
    expect(result).toEqual({ slug: 'nonexistent-repo', removed: false })
  })

  it('normalizes slug format on remove', async () => {
    const kv = createMockKV({
      'recon:watchlist': ['fastify-fastify']
    })
    const result = await removeFromWatchlist(kv, 'fastify/fastify')
    expect(result).toEqual({ slug: 'fastify-fastify', removed: true })
  })
})
