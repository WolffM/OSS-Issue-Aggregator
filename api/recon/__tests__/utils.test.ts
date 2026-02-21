import { describe, it, expect } from 'vitest'
import { isMaintainer, isBot, daysBetween, daysSince, median, clamp } from '../utils'

describe('isMaintainer', () => {
  it('returns true for OWNER', () => {
    expect(isMaintainer('OWNER')).toBe(true)
  })

  it('returns true for MEMBER', () => {
    expect(isMaintainer('MEMBER')).toBe(true)
  })

  it('returns true for COLLABORATOR', () => {
    expect(isMaintainer('COLLABORATOR')).toBe(true)
  })

  it('returns false for CONTRIBUTOR', () => {
    expect(isMaintainer('CONTRIBUTOR')).toBe(false)
  })

  it('returns false for NONE', () => {
    expect(isMaintainer('NONE')).toBe(false)
  })
})

describe('isBot', () => {
  it('detects [bot] suffix', () => {
    expect(isBot('dependabot[bot]')).toBe(true)
  })

  it('detects dependabot prefix', () => {
    expect(isBot('dependabot-preview')).toBe(true)
  })

  it('detects renovate', () => {
    expect(isBot('renovate[bot]')).toBe(true)
  })

  it('detects coderabbit', () => {
    expect(isBot('coderabbit[bot]')).toBe(true)
  })

  it('detects github-actions', () => {
    expect(isBot('github-actions[bot]')).toBe(true)
  })

  it('returns false for regular user', () => {
    expect(isBot('johndoe')).toBe(false)
  })
})

describe('daysBetween', () => {
  it('calculates days between two dates', () => {
    const result = daysBetween('2024-01-01T00:00:00Z', '2024-01-11T00:00:00Z')
    expect(result).toBe(10)
  })

  it('returns absolute difference regardless of order', () => {
    const result = daysBetween('2024-01-11T00:00:00Z', '2024-01-01T00:00:00Z')
    expect(result).toBe(10)
  })

  it('returns 0 for same date', () => {
    const result = daysBetween('2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    expect(result).toBe(0)
  })
})

describe('daysSince', () => {
  it('returns positive number for past dates', () => {
    const result = daysSince('2020-01-01T00:00:00Z')
    expect(result).toBeGreaterThan(0)
  })

  it('returns 0 for future dates', () => {
    const future = new Date(Date.now() + 86_400_000 * 10).toISOString()
    const result = daysSince(future)
    expect(result).toBe(0)
  })
})

describe('median', () => {
  it('returns 0 for empty array', () => {
    expect(median([])).toBe(0)
  })

  it('returns the middle value for odd-length arrays', () => {
    expect(median([1, 3, 5])).toBe(3)
  })

  it('returns average of middle two for even-length arrays', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('handles single element', () => {
    expect(median([42])).toBe(42)
  })

  it('sorts before computing', () => {
    expect(median([5, 1, 3])).toBe(3)
  })
})

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(50, 0, 100)).toBe(50)
  })

  it('clamps to min', () => {
    expect(clamp(-10, 0, 100)).toBe(0)
  })

  it('clamps to max', () => {
    expect(clamp(150, 0, 100)).toBe(100)
  })
})
