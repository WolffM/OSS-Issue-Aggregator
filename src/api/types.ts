export type Platform = 'github' | 'gitlab' | 'gitea' | 'phabricator' | 'bugzilla' | 'trac'
export type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'unknown'

export interface Issue {
  id: string
  platform: Platform
  project: string
  title: string
  url: string
  difficulty: Difficulty
  difficultyScore?: number
  difficultySignals?: string[]
  labels: string[]
  createdAt: string
  updatedAt: string
  author: string
}

// ============================================================================
// Recon Enums
// ============================================================================

export type CVSTier = 'go' | 'likely' | 'maybe' | 'risky' | 'skip'
export type LifecycleStage = 'fresh' | 'triaged' | 'accepted' | 'stale' | 'zombie'
export type ClaimStatus = 'unclaimed' | 'claimed' | 'stale-claim'
export type Complexity = 'low' | 'medium' | 'high'
export type CompetitionLevel = 'none' | 'low' | 'medium' | 'high'
export type DataCompleteness = 'full' | 'partial'

// ============================================================================
// Recon Data Types
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

export interface ScoringMeta {
  scored_at: string
  data_completeness: DataCompleteness
  signals_used: string[]
  signals_available: string[]
}

export interface ScoredIssue extends Issue {
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
  _scoring: ScoringMeta
}

export interface RepoQuirk {
  type: string
  description: string
  impact: 'blocker' | 'important' | 'minor'
  evidence: string
}

export interface PRPatterns {
  medianFilesChanged: number
  medianAdditions: number
  medianTimeToMergeDays: number
  mergeStyle: 'squash' | 'merge' | 'rebase' | 'mixed'
  commitConvention: string | null
  externalContributorMergeRate: number
  topRejectionReasons: string[]
}

export interface RepoHealth {
  slug: string
  defaultBranch: string
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

export interface DossierSections {
  overview: string
  contributionRules: string
  successPatterns: string
  antiPatterns: string
  issueBoard: string
  environmentSetup: string
}

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

export interface Dossier {
  slug: string
  generatedAt: string
  sections: DossierSections
  completeness: DossierCompleteness
}

export interface ClaimRecord {
  issueId: string
  claimedBy: string
  claimedAt: string
  forkIssueUrl: string | null
}

// ============================================================================
// Recon API Response Types
// ============================================================================

export interface ResponseMeta {
  scraped_at: string | null
  computed_at: string | null
  served_at: string
}

export interface ReconSuccessResponse<T> {
  success: true
  data: T
  _meta?: ResponseMeta
}

export interface ReconPendingResponse {
  success: true
  data: { status: 'pending' }
}

export type RepoHealthResponse = ReconSuccessResponse<RepoHealth> | ReconPendingResponse
export type ScoredIssuesResponse = ReconSuccessResponse<{ issues: ScoredIssue[]; slug: string }>
export type DossierResponse = ReconSuccessResponse<Dossier> | ReconPendingResponse
export type AllScoredIssuesResponse = ReconSuccessResponse<{
  issues: ScoredIssue[]
  totalCount: number
  repoCount: number
  hasMore?: boolean
  offset?: number
}>

export interface AggregateVersionResponse {
  success: true
  data: {
    version: number
    repoCount: number
    totalCount: number
    projects: { slug: string; name: string }[]
  }
}
export type ClaimResponse = ReconSuccessResponse<ClaimRecord>
export type UnclaimResponse = ReconSuccessResponse<{ issueId: string; removed: boolean }>
export type RefreshResponse = ReconSuccessResponse<{ status: 'triggered' }>

export function isPendingResponse(
  response: ReconSuccessResponse<unknown> | ReconPendingResponse
): response is ReconPendingResponse {
  const data = response.data as Record<string, unknown>
  return 'status' in data && data.status === 'pending'
}
