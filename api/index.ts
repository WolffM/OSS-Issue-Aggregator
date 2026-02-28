/**
 * @wolffm/oss-aggregator API Module
 *
 * This module provides the API logic for the OSS Issues Aggregator.
 * Import from '@wolffm/oss-aggregator/api' to use these exports.
 */

// Handler factory (main export for Cloudflare Workers)
export { createOSSHandler } from './handler'

// Types
export type { Platform, Difficulty, Issue, OSSEnv } from './types'

// Schemas (for OpenAPI integration)
export {
  PlatformSchema,
  DifficultySchema,
  IssueSchema,
  ErrorResponseSchema,
  HealthResponseSchema
} from './schemas'

// Recon pipeline
export { createReconRoutes } from './recon'

export {
  getConsolidatedRecon,
  getScrapedSlugs,
  getRepoHealth,
  getScoredIssues,
  getClaims,
  getDossier
} from './recon/kv-reader'

export { addClaim, removeClaim } from './recon/claims'

export { triggerScrape } from './recon/triggers'

// Pre-computation pipeline
export { computeAndStore, computeAndStoreAll, applyClaimOverlay } from './recon/precompute'
export { putRepoHealth, putScoredIssues, putDossier } from './recon/kv-writer'

// Recon analysis engine
export { scoreRepoHealth, analyzePRPatterns } from './recon/health-scorer'
export { scoreIssues } from './recon/issue-scorer'
export { classifyLifecycle } from './recon/lifecycle'
export { analyzeSentiment } from './recon/sentiment'
export { isMaintainer, isBot, daysBetween, daysSince, median, clamp } from './recon/utils'

// Recon intelligence
export { detectQuirks } from './recon/quirks'
export { compileDossier } from './recon/dossier-compiler'
export { formatIssueBrief } from './recon/issue-brief'

// Recon types
export type {
  ExtendedIssue,
  ConsolidatedReconData,
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
