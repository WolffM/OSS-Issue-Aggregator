/**
 * Shared helpers and schemas for recon route files.
 */

import { z } from '@hono/zod-openapi'
import type { OSSEnv } from '../types'
import {
  type KVEnvelope,
  type ResponseMeta,
  ExtendedIssueSchema,
  ScoredIssueSchema,
  RepoHealthSchema,
  DossierSchema,
  ClaimRecordSchema,
  ResponseMetaSchema
} from './types'

// ============================================================================
// Types
// ============================================================================

export interface HonoEnv {
  Bindings: OSSEnv
}

// ============================================================================
// Helpers
// ============================================================================

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error'
}

export function requireKV(env: OSSEnv) {
  return env.CACHE_KV ?? null
}

/** Build _meta from a KVEnvelope (computed data with freshness timestamps). */
export function buildMeta(envelope: KVEnvelope<unknown> | null): ResponseMeta {
  return {
    scraped_at: envelope?.scraped_at ?? null,
    computed_at: envelope?.computed_at ?? null,
    served_at: new Date().toISOString()
  }
}

/** Build _meta for raw scraper data (no computed_at). */
export function buildScrapedOnlyMeta(scrapedAt: string | null): ResponseMeta {
  return {
    scraped_at: scrapedAt ?? null,
    computed_at: null,
    served_at: new Date().toISOString()
  }
}

// ============================================================================
// Shared Response Schemas
// ============================================================================

export const ErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.string()
  })
  .openapi('ReconErrorResponse')

export const PendingResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      status: z.literal('pending')
    })
  })
  .openapi('ReconPendingResponse')

export const AcceptedResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string()
  })
  .openapi('ReconAcceptedResponse')

// ============================================================================
// Shared Request Schemas
// ============================================================================

export const slugParam = z.object({
  slug: z.string().openapi({
    param: { name: 'slug', in: 'path' },
    example: 'fastify-fastify'
  })
})

// Issue IDs are emitted by the scraper as `{platform}-{owner}-{repo}-{number}`.
// Enforcing the pattern at the param boundary turns malformed calls into 400s
// instead of misleading 202/pending responses.
const ISSUE_ID_PATTERN = /^(github|gitlab|gitea|phabricator|bugzilla|trac)-.+-\d+$/

export const slugIssueIdParam = z.object({
  slug: z.string().openapi({
    param: { name: 'slug', in: 'path' },
    example: 'fastify-fastify'
  }),
  issueId: z
    .string()
    .regex(ISSUE_ID_PATTERN, {
      message:
        'issueId must match {platform}-{owner}-{repo}-{number} (e.g. github-fastify-fastify-5432)'
    })
    .openapi({
      param: { name: 'issueId', in: 'path' },
      example: 'github-fastify-fastify-5432'
    })
})

// ============================================================================
// Domain-Specific Response Schemas
// ============================================================================

export const IssuesResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issues: z.array(ExtendedIssueSchema),
      slug: z.string()
    }),
    _meta: ResponseMetaSchema
  })
  .openapi('ReconIssuesResponse')

export const ScoredIssuesResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issues: z.array(ScoredIssueSchema),
      slug: z.string()
    }),
    _meta: ResponseMetaSchema
  })
  .openapi('ReconScoredIssuesResponse')

// Slim variant of ScoredIssueSchema for the aggregate listing.
// Strips heavy fields to keep the response within Worker resource limits.
const SlimScoredIssueSchema = ScoredIssueSchema.omit({
  body: true,
  reactionGroups: true,
  sentimentSignals: true,
  commentDigest: true,
  likelyFiles: true,
  relatedIssues: true,
  _scoring: true,
  difficultySignals: true,
  bodyPreview: true,
  linkedPrUrls: true,
  assignees: true
}).openapi('SlimScoredIssue')

export const AllScoredIssuesResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issues: z.array(SlimScoredIssueSchema),
      totalCount: z.number(),
      repoCount: z.number(),
      hasMore: z.boolean().optional(),
      offset: z.number().optional()
    }),
    _meta: ResponseMetaSchema
  })
  .openapi('AllScoredIssuesResponse')

export const AggregateVersionResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      version: z.number(),
      repoCount: z.number(),
      totalCount: z.number(),
      projects: z.array(
        z.object({
          slug: z.string(),
          name: z.string()
        })
      )
    })
  })
  .openapi('AggregateVersionResponse')

export const RefreshResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      status: z.literal('triggered')
    })
  })
  .openapi('RefreshResponse')

export const ClaimResponseSchema = z
  .object({
    success: z.literal(true),
    data: ClaimRecordSchema
  })
  .openapi('ClaimResponse')

export const UnclaimResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issueId: z.string(),
      removed: z.boolean()
    })
  })
  .openapi('UnclaimResponse')

export const ClaimRequestSchema = z
  .object({
    issueId: z.string().openapi({ example: 'github-fastify-fastify-5432' }),
    claimedBy: z.string().openapi({ example: 'myuser' }),
    forkIssueUrl: z
      .string()
      .optional()
      .openapi({ example: 'https://github.com/myuser/fastify/issues/1' })
  })
  .openapi('ClaimRequest')

export const UnclaimRequestSchema = z
  .object({
    issueId: z.string().openapi({ example: 'github-fastify-fastify-5432' })
  })
  .openapi('UnclaimRequest')

export const IssueBriefResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issue: ScoredIssueSchema,
      repoHealth: RepoHealthSchema,
      brief: z.string().openapi({ description: 'Markdown-formatted SWE agent execution context' })
    }),
    _meta: ResponseMetaSchema
  })
  .openapi('IssueBriefResponse')

export const ComposeBriefRequestSchema = z
  .object({
    issue: ExtendedIssueSchema.openapi({
      description:
        'Caller-supplied raw issue snapshot. Use this to compose a brief for issues absent from the current scored window (e.g., aged-out snapshots held by a consumer). Scoring fields are not required; any that are supplied are ignored.'
    })
  })
  .openapi('ComposeBriefRequest')

export const DossierResponseSchema = z
  .object({
    success: z.literal(true),
    data: DossierSchema,
    _meta: ResponseMetaSchema
  })
  .openapi('ReconDossierSuccessResponse')
