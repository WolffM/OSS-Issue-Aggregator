/**
 * @wolffm/oss-aggregator API Module
 *
 * This module provides the API logic for the OSS Issues Aggregator.
 * Import from '@wolffm/oss-aggregator/api' to use these exports.
 */

// Handler factory (main export for Cloudflare Workers)
export { createOSSHandler, createOSSFetcher } from './handler'

// Data source abstraction (swap providers here)
export { createDataProvider, LiveApiProvider } from './data-sources'
export type { IssueDataProvider } from './data-sources'

// Low-level adapters (used by LiveApiProvider, will be removed when scraper replaces them)
export { fetchGitHubIssues } from './adapters/github'
export { fetchGitLabIssues } from './adapters/gitlab'
export { fetchGiteaIssues } from './adapters/gitea'
export { fetchPhabricatorIssues } from './adapters/phabricator'
export { fetchBugzillaIssues } from './adapters/bugzilla'
export { fetchTracIssues } from './adapters/trac'

// Scoring system
export { scoreIssue } from './scoring'
export type { ScoringInput, ScoringResult } from './scoring'

// Configuration
export { PROJECTS, POOLS, getProjectsByPool, getProjectBySlug } from './config'

// Types
export type {
  Platform,
  Difficulty,
  Issue,
  ProjectConfig,
  OSSEnv,
  MarkStatus,
  MarkedIssue,
  MarkedIssuesData,
  CachedIssues,
  ProjectResult
} from './types'

// Utilities (for advanced use cases)
export {
  buildHeaders,
  checkApiResponse,
  validateJsonResponse,
  validateNotHtml,
  parseDate,
  deduplicateBy,
  parseCSV,
  parseCSVLine
} from './utils'

// Schemas (for OpenAPI integration)
export {
  PlatformSchema,
  DifficultySchema,
  IssueSchema,
  ProjectSummarySchema,
  PoolSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  ProjectsResponseSchema,
  ProjectIssuesResponseSchema,
  PoolIssuesResponseSchema,
  MarkStatusSchema,
  MarkedIssueSchema,
  MarkIssueRequestSchema,
  MarkIssueResponseSchema,
  UnmarkIssueResponseSchema,
  MarkedIssuesResponseSchema
} from './schemas'
