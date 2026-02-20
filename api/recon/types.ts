/**
 * Recon Pipeline Types & Zod Schemas
 *
 * All types match the contracts defined in PROJECT-DESIGN.md §4.
 * Zod schemas are used for OpenAPI spec generation via @hono/zod-openapi.
 */

import { z } from '@hono/zod-openapi'
import type { Issue } from '../types'
import { IssueSchema } from '../schemas'

// ============================================================================
// Enums
// ============================================================================

export const AuthorAssociationSchema = z
  .enum(['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR', 'NONE'])
  .openapi('AuthorAssociation')

export type AuthorAssociation = z.infer<typeof AuthorAssociationSchema>

export const CVSTierSchema = z.enum(['go', 'likely', 'maybe', 'risky', 'skip']).openapi('CVSTier')

export type CVSTier = z.infer<typeof CVSTierSchema>

export const LifecycleStageSchema = z
  .enum(['fresh', 'triaged', 'accepted', 'stale', 'zombie'])
  .openapi('LifecycleStage')

export type LifecycleStage = z.infer<typeof LifecycleStageSchema>

export const ClaimStatusSchema = z
  .enum(['unclaimed', 'claimed', 'stale-claim'])
  .openapi('ClaimStatus')

export type ClaimStatus = z.infer<typeof ClaimStatusSchema>

export const ComplexitySchema = z.enum(['low', 'medium', 'high']).openapi('Complexity')

export type Complexity = z.infer<typeof ComplexitySchema>

export const CompetitionLevelSchema = z
  .enum(['none', 'low', 'medium', 'high'])
  .openapi('CompetitionLevel')

export type CompetitionLevel = z.infer<typeof CompetitionLevelSchema>

export const DataCompletenessSchema = z.enum(['full', 'partial']).openapi('DataCompleteness')

export type DataCompleteness = z.infer<typeof DataCompletenessSchema>

export const MergeStyleSchema = z.enum(['squash', 'merge', 'rebase', 'mixed']).openapi('MergeStyle')

export const QuirkImpactSchema = z.enum(['blocker', 'important', 'minor']).openapi('QuirkImpact')

// ============================================================================
// ExtendedIssue (scraper → KV) — §4.1
// ============================================================================

export interface ExtendedIssue extends Issue {
  authorAssociation: string
  bodyPreview: string
  commentCount: number
  thumbsUpCount: number
  assignees: string[]
  milestone: string | null
  linkedPrUrls: string[]
  lastCommentAt: string | null
  lastCommentAuthor: string | null
  lastCommentAuthorAssociation: string | null
}

export const ExtendedIssueSchema = IssueSchema.extend({
  authorAssociation: z.string().openapi({ example: 'NONE' }),
  bodyPreview: z.string().openapi({ example: 'This issue tracks...' }),
  commentCount: z.number().openapi({ example: 5 }),
  thumbsUpCount: z.number().openapi({ example: 12 }),
  assignees: z.array(z.string()).openapi({ example: [] }),
  milestone: z.string().nullable().openapi({ example: null }),
  linkedPrUrls: z.array(z.string()).openapi({ example: [] }),
  lastCommentAt: z.string().nullable().openapi({ example: null }),
  lastCommentAuthor: z.string().nullable().openapi({ example: null }),
  lastCommentAuthorAssociation: z.string().nullable().openapi({ example: null })
}).openapi('ExtendedIssue')

// ============================================================================
// ReconIssueData (KV envelope) — §4.1
// ============================================================================

export interface ReconIssueData {
  issues: ExtendedIssue[]
  scrapedAt: string
  source: string
  dataTypes: string[]
}

export const ReconIssueDataSchema = z
  .object({
    issues: z.array(ExtendedIssueSchema),
    scrapedAt: z.string(),
    source: z.string(),
    dataTypes: z.array(z.string())
  })
  .openapi('ReconIssueData')

// ============================================================================
// PRSample (scraper → KV) — §4.2
// ============================================================================

export interface PRSample {
  number: number
  title: string
  url: string
  author: string
  authorAssociation: string
  createdAt: string
  mergedAt: string | null
  closedAt: string | null
  additions: number
  deletions: number
  changedFiles: number
  reviewCount: number
  labels: string[]
  headRefName: string
  baseRefName: string
  mergeCommitSha: string | null
}

export const PRSampleSchema = z
  .object({
    number: z.number().openapi({ example: 1234 }),
    title: z.string().openapi({ example: 'Fix typo in README' }),
    url: z.string().openapi({ example: 'https://github.com/org/repo/pull/1234' }),
    author: z.string().openapi({ example: 'contributor1' }),
    authorAssociation: z.string().openapi({ example: 'CONTRIBUTOR' }),
    createdAt: z.string().openapi({ example: '2024-01-15T10:30:00Z' }),
    mergedAt: z.string().nullable().openapi({ example: '2024-01-20T14:45:00Z' }),
    closedAt: z.string().nullable().openapi({ example: null }),
    additions: z.number().openapi({ example: 15 }),
    deletions: z.number().openapi({ example: 3 }),
    changedFiles: z.number().openapi({ example: 2 }),
    reviewCount: z.number().openapi({ example: 1 }),
    labels: z.array(z.string()).openapi({ example: ['bug'] }),
    headRefName: z.string().openapi({ example: 'fix/readme-typo' }),
    baseRefName: z.string().openapi({ example: 'main' }),
    mergeCommitSha: z.string().nullable().openapi({ example: null })
  })
  .openapi('PRSample')

// ============================================================================
// RepoMeta (scraper → KV) — §4.3
// ============================================================================

export interface RepoMeta {
  owner: string
  repo: string
  slug: string
  stars: number
  forks: number
  language: string | null
  license: string | null
  hasContributing: boolean
  contributingContent: string | null
  hasPrTemplate: boolean
  prTemplateContent: string | null
  hasCodeOfConduct: boolean
  hasCodeowners: boolean
  defaultBranch: string
  isArchived: boolean
  openIssueCount: number
  openPrCount: number
  lastPushedAt: string
  topics: string[]
  externalTools: string[]
  scrapedAt: string
}

export const RepoMetaSchema = z
  .object({
    owner: z.string().openapi({ example: 'fastify' }),
    repo: z.string().openapi({ example: 'fastify' }),
    slug: z.string().openapi({ example: 'fastify-fastify' }),
    stars: z.number().openapi({ example: 30000 }),
    forks: z.number().openapi({ example: 2200 }),
    language: z.string().nullable().openapi({ example: 'TypeScript' }),
    license: z.string().nullable().openapi({ example: 'MIT' }),
    hasContributing: z.boolean().openapi({ example: true }),
    contributingContent: z.string().nullable().openapi({ example: null }),
    hasPrTemplate: z.boolean().openapi({ example: false }),
    prTemplateContent: z.string().nullable().openapi({ example: null }),
    hasCodeOfConduct: z.boolean().openapi({ example: true }),
    hasCodeowners: z.boolean().openapi({ example: false }),
    defaultBranch: z.string().openapi({ example: 'main' }),
    isArchived: z.boolean().openapi({ example: false }),
    openIssueCount: z.number().openapi({ example: 150 }),
    openPrCount: z.number().openapi({ example: 25 }),
    lastPushedAt: z.string().openapi({ example: '2024-01-20T14:45:00Z' }),
    topics: z.array(z.string()).openapi({ example: ['nodejs', 'http'] }),
    externalTools: z.array(z.string()).openapi({ example: ['CodeRabbit', 'Codecov'] }),
    scrapedAt: z.string().openapi({ example: '2024-01-20T14:45:00Z' })
  })
  .openapi('RepoMeta')

// ============================================================================
// Comments (scraper → KV) — §4.4
// ============================================================================

export interface Comment {
  author: string
  authorAssociation: string
  body: string
  createdAt: string
  reactions: {
    thumbsUp: number
    thumbsDown: number
    heart: number
  }
}

export const CommentSchema = z
  .object({
    author: z.string(),
    authorAssociation: z.string(),
    body: z.string(),
    createdAt: z.string(),
    reactions: z.object({
      thumbsUp: z.number(),
      thumbsDown: z.number(),
      heart: z.number()
    })
  })
  .openapi('Comment')

export interface CommentThread {
  issueNumber: number
  comments: Comment[]
  scrapedAt: string
}

export const CommentThreadSchema = z
  .object({
    issueNumber: z.number(),
    comments: z.array(CommentSchema),
    scrapedAt: z.string()
  })
  .openapi('CommentThread')

export type IssueComments = Record<string, CommentThread>

export const IssueCommentsSchema = z
  .record(z.string(), CommentThreadSchema)
  .openapi('IssueComments')

// ============================================================================
// ClaimRecord — §4.8
// ============================================================================

export interface ClaimRecord {
  issueId: string
  claimedBy: string
  claimedAt: string
  forkIssueUrl: string | null
}

export const ClaimRecordSchema = z
  .object({
    issueId: z.string().openapi({ example: 'github-fastify-fastify-5432' }),
    claimedBy: z.string().openapi({ example: 'myuser' }),
    claimedAt: z.string().openapi({ example: '2024-01-20T14:45:00Z' }),
    forkIssueUrl: z.string().nullable().openapi({ example: null })
  })
  .openapi('ClaimRecord')

// ============================================================================
// ScoredIssue (aggregator → KV / API) — §4.5
// ============================================================================

export interface ScoredIssue extends ExtendedIssue {
  cvs: number
  cvsTier: CVSTier
  lifecycleStage: LifecycleStage
  claimStatus: ClaimStatus
  claimAuthor: string | null
  complexity: Complexity
  sentimentScore: number
  contentQualityScore: number
  competitionLevel: CompetitionLevel
  repoSlug: string
  dataCompleteness: DataCompleteness
  repoKilled: boolean
}

export const ScoredIssueSchema = ExtendedIssueSchema.extend({
  cvs: z.number().openapi({ example: 75, description: 'Contribution Viability Score 0-100' }),
  cvsTier: CVSTierSchema,
  lifecycleStage: LifecycleStageSchema,
  claimStatus: ClaimStatusSchema,
  claimAuthor: z.string().nullable().openapi({ example: null }),
  complexity: ComplexitySchema,
  sentimentScore: z.number().openapi({ example: 0.5, description: '-1 to 1' }),
  contentQualityScore: z.number().openapi({ example: 70, description: '0-100' }),
  competitionLevel: CompetitionLevelSchema,
  repoSlug: z.string().openapi({ example: 'fastify-fastify' }),
  dataCompleteness: DataCompletenessSchema,
  repoKilled: z.boolean().openapi({ example: false })
}).openapi('ScoredIssue')

// ============================================================================
// RepoQuirk & PRPatterns — §4.6
// ============================================================================

export interface RepoQuirk {
  type: string
  description: string
  impact: 'blocker' | 'important' | 'minor'
  evidence: string
}

export const RepoQuirkSchema = z
  .object({
    type: z.string().openapi({ example: 'changeset' }),
    description: z.string().openapi({ example: 'Changeset file required for PRs' }),
    impact: QuirkImpactSchema,
    evidence: z.string().openapi({ example: "Bot comment: 'missing changeset'" })
  })
  .openapi('RepoQuirk')

export interface PRPatterns {
  medianFilesChanged: number
  medianAdditions: number
  medianTimeToMergeDays: number
  mergeStyle: 'squash' | 'merge' | 'rebase' | 'mixed'
  commitConvention: string | null
  externalContributorMergeRate: number
  topRejectionReasons: string[]
}

export const PRPatternsSchema = z
  .object({
    medianFilesChanged: z.number().openapi({ example: 3 }),
    medianAdditions: z.number().openapi({ example: 45 }),
    medianTimeToMergeDays: z.number().openapi({ example: 4.5 }),
    mergeStyle: MergeStyleSchema,
    commitConvention: z.string().nullable().openapi({ example: 'conventional' }),
    externalContributorMergeRate: z.number().openapi({ example: 0.65 }),
    topRejectionReasons: z.array(z.string()).openapi({ example: ['too large', 'wrong branch'] })
  })
  .openapi('PRPatterns')

// ============================================================================
// RepoHealth (aggregator → KV / API) — §4.6
// ============================================================================

export interface RepoHealth {
  slug: string
  maintainerHealthScore: number
  mergeAccessibilityScore: number
  availabilityScore: number
  overallViability: number
  killed: boolean
  killReason: string | null
  detectedQuirks: RepoQuirk[]
  prPatterns: PRPatterns
  analyzedAt: string
}

export const RepoHealthSchema = z
  .object({
    slug: z.string().openapi({ example: 'fastify-fastify' }),
    maintainerHealthScore: z.number().openapi({ example: 85 }),
    mergeAccessibilityScore: z.number().openapi({ example: 72 }),
    availabilityScore: z.number().openapi({ example: 68 }),
    overallViability: z.number().openapi({ example: 75 }),
    killed: z.boolean().openapi({ example: false }),
    killReason: z.string().nullable().openapi({ example: null }),
    detectedQuirks: z.array(RepoQuirkSchema),
    prPatterns: PRPatternsSchema,
    analyzedAt: z.string().openapi({ example: '2024-01-20T14:45:00Z' })
  })
  .openapi('RepoHealth')

// ============================================================================
// Dossier (aggregator → KV / API) — §4.7
// ============================================================================

export interface Dossier {
  slug: string
  generatedAt: string
  sections: {
    overview: string
    contributionRules: string
    successPatterns: string
    antiPatterns: string
    issueBoard: string
    environmentSetup: string
  }
}

export const DossierSectionsSchema = z
  .object({
    overview: z.string(),
    contributionRules: z.string(),
    successPatterns: z.string(),
    antiPatterns: z.string(),
    issueBoard: z.string(),
    environmentSetup: z.string()
  })
  .openapi('DossierSections')

export const DossierSchema = z
  .object({
    slug: z.string().openapi({ example: 'fastify-fastify' }),
    generatedAt: z.string().openapi({ example: '2024-01-20T14:45:00Z' }),
    sections: DossierSectionsSchema
  })
  .openapi('Dossier')
