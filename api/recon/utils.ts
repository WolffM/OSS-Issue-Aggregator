/**
 * Shared utility functions for the recon scoring engine.
 * All functions are pure — no side effects, no KV access.
 */

const MAINTAINER_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR']

const BOT_PATTERNS = [
  /\[bot\]$/i,
  /^dependabot/i,
  /^renovate/i,
  /^coderabbit/i,
  /^github-actions/i,
  /^codecov/i,
  /^netlify/i,
  /^vercel/i
]

export function isMaintainer(authorAssociation: string): boolean {
  return MAINTAINER_ASSOCIATIONS.includes(authorAssociation)
}

export function isBot(author: string): boolean {
  return BOT_PATTERNS.some(pattern => pattern.test(author))
}

export function daysBetween(isoA: string, isoB: string): number {
  const msPerDay = 86_400_000
  const a = new Date(isoA).getTime()
  const b = new Date(isoB).getTime()
  return Math.abs(a - b) / msPerDay
}

export function daysSince(iso: string): number {
  const msPerDay = 86_400_000
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / msPerDay)
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
