/**
 * Shared normalization helper for platform adapters.
 *
 * Every adapter extracts the same fields from platform-specific data
 * and passes them through scoreIssue(). This helper eliminates the
 * duplicated mapping logic.
 */

import type { Issue, Platform, ProjectConfig } from '../types'
import { scoreIssue } from '../scoring'

export interface RawIssueFields {
  number: string | number
  title: string
  body?: string
  url: string
  labels: string[]
  createdAt: string
  updatedAt: string
  author: string
}

export function normalizeToIssue(
  platform: Platform,
  config: ProjectConfig,
  raw: RawIssueFields
): Issue {
  const scoring = scoreIssue({
    title: raw.title,
    body: raw.body,
    labels: raw.labels,
    beginnerLabels: config.beginnerLabels
  })

  return {
    id: `${platform}-${config.slug}-${raw.number}`,
    platform,
    project: config.name,
    title: raw.title,
    url: raw.url,
    difficulty: scoring.difficulty,
    difficultyScore: scoring.score,
    difficultySignals: scoring.signals,
    labels: raw.labels,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    author: raw.author
  }
}
