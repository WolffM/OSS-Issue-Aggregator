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

export interface ReactionGroup {
  content: string
  totalCount: number
}

export const ReactionGroupSchema = z
  .object({
    content: z.string().openapi({ example: 'THUMBS_UP' }),
    totalCount: z.number().openapi({ example: 5 })
  })
  .openapi('ReactionGroup')

export interface ExtendedIssue extends Issue {
  authorAssociation: string
  body?: string
  bodyPreview: string
  commentCount: number
  thumbsUpCount: number
  reactionGroups?: ReactionGroup[]
  assignees: string[]
  milestone: string | null
  linkedPrUrls: string[]
  lastCommentAt: string | null
  lastCommentAuthor: string | null
  lastCommentAuthorAssociation: string | null
}

export const ExtendedIssueSchema = IssueSchema.extend({
  authorAssociation: z.string().openapi({ example: 'NONE' }),
  body: z.string().optional().openapi({
    example: 'Full issue body text...',
    description: 'Full issue body (if available from scraper)'
  }),
  bodyPreview: z.string().openapi({ example: 'This issue tracks...' }),
  commentCount: z.number().openapi({ example: 5 }),
  thumbsUpCount: z.number().openapi({ example: 12 }),
  reactionGroups: z.array(ReactionGroupSchema).optional().openapi({ example: [] }),
  assignees: z.array(z.string()).openapi({ example: [] }),
  milestone: z.string().nullable().openapi({ example: null }),
  linkedPrUrls: z.array(z.string()).openapi({ example: [] }),
  lastCommentAt: z.string().nullable().openapi({ example: null }),
  lastCommentAuthor: z.string().nullable().openapi({ example: null }),
  lastCommentAuthorAssociation: z.string().nullable().openapi({ example: null })
}).openapi('ExtendedIssue')

// ============================================================================
// ConsolidatedReconData (scraper → KV) — single key per repo
// ============================================================================

export interface ConsolidatedReconData {
  scrapedAt: string
  source: string
  platform: string
  issues: ExtendedIssue[]
  mergedPrs: PRSample[]
  rejectedPrs: PRSample[]
  repoMeta: RepoMeta | null
  comments: { threads: IssueComments }
  dataTypes: string[]
  errors: Record<string, string> | null
}

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

export interface DevEnvironment {
  packageManager: string | null
  installCommand: string | null
  testRunner: string | null
  testCommand: string | null
  buildCommand: string | null
  lintCommand: string | null
  knownIssues: string[]
}

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
  devEnvironment?: DevEnvironment
}

export const DevEnvironmentSchema = z
  .object({
    packageManager: z.string().nullable().openapi({ example: 'npm' }),
    installCommand: z.string().nullable().openapi({ example: "pip install -e '.[dev]'" }),
    testRunner: z.string().nullable().openapi({ example: 'pytest' }),
    testCommand: z.string().nullable().openapi({ example: 'python -m pytest tests/ -v' }),
    buildCommand: z.string().nullable().openapi({ example: 'npm run build' }),
    lintCommand: z.string().nullable().openapi({ example: 'npm run lint' }),
    knownIssues: z.array(z.string()).openapi({ example: [] })
  })
  .openapi('DevEnvironment')

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
    scrapedAt: z.string().openapi({ example: '2024-01-20T14:45:00Z' }),
    devEnvironment: DevEnvironmentSchema.optional()
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
// CommentDigest — structured context from comment threads
// ============================================================================

export interface CommentDigest {
  participantCount: number
  maintainerParticipantCount: number
  lastMaintainerComment: string | null
  discussedScope: boolean
  discussedImplementation: boolean
  referencedIssues: string[]
  hasConsensus: boolean
}

export const CommentDigestSchema = z
  .object({
    participantCount: z.number().openapi({ example: 5 }),
    maintainerParticipantCount: z.number().openapi({ example: 2 }),
    lastMaintainerComment: z
      .string()
      .nullable()
      .openapi({ example: 'Sounds good, lets go with approach B...' }),
    discussedScope: z.boolean().openapi({ example: false }),
    discussedImplementation: z.boolean().openapi({ example: true }),
    referencedIssues: z.array(z.string()).openapi({ example: ['#42', '#108'] }),
    hasConsensus: z.boolean().openapi({ example: true })
  })
  .openapi('CommentDigest')

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

export interface RelatedIssue {
  id: string
  similarity: number
  reason: string
}

export interface ScoringMeta {
  scored_at: string
  data_completeness: DataCompleteness
  signals_used: string[]
  signals_available: string[]
}

export const ScoringMetaSchema = z
  .object({
    scored_at: z.string().openapi({ example: '2024-01-20T15:00:00Z' }),
    data_completeness: DataCompletenessSchema,
    signals_used: z.array(z.string()).openapi({
      example: ['freshness', 'activity', 'contentQuality', 'reactions', 'commentSentiment']
    }),
    signals_available: z.array(z.string()).openapi({
      example: [
        'freshness',
        'activity',
        'contentQuality',
        'competition',
        'complexity',
        'reactions',
        'commentSentiment'
      ]
    })
  })
  .openapi('ScoringMeta')

export interface ScoredIssue extends ExtendedIssue {
  cvs: number
  cvsTier: CVSTier
  lifecycleStage: LifecycleStage
  claimStatus: ClaimStatus
  claimAuthor: string | null
  complexity: Complexity
  sentimentScore: number
  sentimentSignals: string[]
  commentDigest: CommentDigest | null
  contentQualityScore: number
  competitionLevel: CompetitionLevel
  repoSlug: string
  dataCompleteness: DataCompleteness
  repoKilled: boolean
  likelyFiles: string[]
  relatedIssues: RelatedIssue[]
  _scoring: ScoringMeta
}

export const RelatedIssueSchema = z
  .object({
    id: z.string().openapi({ example: 'github-fastify-fastify-101' }),
    similarity: z.number().openapi({ example: 0.85, description: '0-1 similarity score' }),
    reason: z.string().openapi({ example: 'Both modify request lifecycle hooks' })
  })
  .openapi('RelatedIssue')

export const ScoredIssueSchema = ExtendedIssueSchema.extend({
  cvs: z.number().openapi({ example: 75, description: 'Contribution Viability Score 0-100' }),
  cvsTier: CVSTierSchema,
  lifecycleStage: LifecycleStageSchema,
  claimStatus: ClaimStatusSchema,
  claimAuthor: z.string().nullable().openapi({ example: null }),
  complexity: ComplexitySchema,
  sentimentScore: z.number().openapi({ example: 0.5, description: '-1 to 1' }),
  sentimentSignals: z.array(z.string()).openapi({
    example: ['positive: \\bPR\\s+welcome'],
    description: 'Matched sentiment signal patterns'
  }),
  commentDigest: CommentDigestSchema.nullable().openapi({
    description: 'Structured digest of comment thread context'
  }),
  contentQualityScore: z.number().openapi({ example: 70, description: '0-100' }),
  competitionLevel: CompetitionLevelSchema,
  repoSlug: z.string().openapi({ example: 'fastify-fastify' }),
  dataCompleteness: DataCompletenessSchema,
  repoKilled: z.boolean().openapi({ example: false }),
  likelyFiles: z
    .array(z.string())
    .openapi({ example: ['src/hooks.ts'], description: 'Files likely affected by this issue' }),
  relatedIssues: z
    .array(RelatedIssueSchema)
    .openapi({ description: 'Issues that likely overlap in affected code' }),
  _scoring: ScoringMetaSchema
}).openapi('ScoredIssue')

// ============================================================================
// RepoQuirk & PRPatterns — §4.6
// ============================================================================

export interface RepoQuirk {
  type: string
  description: string
  impact: 'blocker' | 'important' | 'minor'
  evidence: string
  detectedBranch?: string
}

export const RepoQuirkSchema = z
  .object({
    type: z.string().openapi({ example: 'changeset' }),
    description: z.string().openapi({ example: 'Changeset file required for PRs' }),
    impact: QuirkImpactSchema,
    evidence: z.string().openapi({ example: "Bot comment: 'missing changeset'" }),
    detectedBranch: z.string().optional().openapi({
      example: 'develop',
      description: 'For branch-target quirks: the actual branch PRs should target'
    })
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
  defaultBranch: string
  language: string | null
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
    defaultBranch: z.string().openapi({ example: 'main' }),
    language: z.string().nullable().openapi({ example: 'TypeScript' }),
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

export interface DossierCompleteness {
  overview: boolean
  contributionRules: boolean
  successPatterns: boolean
  antiPatterns: boolean
  issueBoard: boolean
  environmentSetup: boolean
  score: number
  total: number
}

export const DossierCompletenessSchema = z
  .object({
    overview: z.boolean(),
    contributionRules: z.boolean(),
    successPatterns: z.boolean(),
    antiPatterns: z.boolean(),
    issueBoard: z.boolean(),
    environmentSetup: z.boolean(),
    score: z.number().openapi({ example: 5, description: 'Number of non-empty sections' }),
    total: z.number().openapi({ example: 6, description: 'Total sections' })
  })
  .openapi('DossierCompleteness')

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
  completeness: DossierCompleteness
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
    sections: DossierSectionsSchema,
    completeness: DossierCompletenessSchema
  })
  .openapi('Dossier')

// ============================================================================
// KV Envelope — wraps computed data with freshness timestamps
// ============================================================================

export interface KVEnvelope<T> {
  data: T
  scraped_at: string | null
  computed_at: string
}

// ============================================================================
// API Response Metadata
// ============================================================================

export interface ResponseMeta {
  scraped_at: string | null
  computed_at: string | null
  served_at: string
}

export const ResponseMetaSchema = z
  .object({
    scraped_at: z.string().nullable().openapi({ example: '2024-01-20T14:45:00Z' }),
    computed_at: z.string().nullable().openapi({ example: '2024-01-20T15:00:00Z' }),
    served_at: z.string().openapi({ example: '2024-01-20T15:30:00Z' })
  })
  .openapi('ResponseMeta')
