/**
 * @wolffm/oss-aggregator API Module
 *
 * This module provides the API logic for the OSS Issues Aggregator.
 * Import from '@wolffm/oss-aggregator/api' to use these exports.
 */

// Handler factory (main export for Cloudflare Workers)
export { createOSSHandler } from './handler'

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
  ErrorResponseSchema,
  HealthResponseSchema,
  MarkStatusSchema,
  MarkedIssueSchema,
  MarkIssueRequestSchema,
  MarkIssueResponseSchema,
  UnmarkIssueResponseSchema,
  MarkedIssuesResponseSchema
} from './schemas'

// Recon pipeline
export { createReconRoutes } from './recon'

export {
  getReconIssues,
  getReconIssuesScrapedAt,
  getMergedPRs,
  getRejectedPRs,
  getRepoMeta,
  getComments,
  getRepoHealth,
  getScoredIssues,
  getClaims,
  getDossier
} from './recon/kv-reader'

export { addClaim, removeClaim } from './recon/claims'

export {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  normalizeSlug,
  isValidSlug
} from './recon/watchlist'

export { triggerScrape } from './recon/triggers'

// Recon analysis engine (M2)
export { scoreRepoHealth, analyzePRPatterns } from './recon/health-scorer'
export { scoreIssues } from './recon/issue-scorer'
export { classifyLifecycle } from './recon/lifecycle'
export { analyzeSentiment } from './recon/sentiment'
export { isMaintainer, isBot, daysBetween, daysSince, median, clamp } from './recon/utils'

// Recon intelligence (M3)
export { detectQuirks } from './recon/quirks'
export { compileDossier, truncate, branchPrefixes } from './recon/dossier-compiler'
export { formatIssueBrief } from './recon/issue-brief'

// Recon types
export type {
  ExtendedIssue,
  ReconIssueData,
  PRSample,
  RepoMeta,
  IssueComments,
  Comment,
  CommentThread,
  ClaimRecord,
  ScoredIssue,
  RepoHealth,
  RepoQuirk,
  PRPatterns,
  Dossier,
  AuthorAssociation,
  CVSTier,
  LifecycleStage,
  ClaimStatus,
  Complexity,
  CompetitionLevel,
  DataCompleteness
} from './recon/types'

// Recon schemas
export {
  AuthorAssociationSchema,
  ExtendedIssueSchema,
  ReconIssueDataSchema,
  PRSampleSchema,
  RepoMetaSchema,
  CommentSchema,
  CommentThreadSchema,
  IssueCommentsSchema,
  ClaimRecordSchema,
  CVSTierSchema,
  LifecycleStageSchema,
  ClaimStatusSchema,
  ComplexitySchema,
  CompetitionLevelSchema,
  DataCompletenessSchema,
  ScoredIssueSchema,
  RepoQuirkSchema,
  PRPatternsSchema,
  RepoHealthSchema,
  DossierSchema,
  DossierSectionsSchema
} from './recon/types'
