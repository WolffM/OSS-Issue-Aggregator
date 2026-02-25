/**
 * Shared helpers and schemas for recon route files.
 */

import { z } from '@hono/zod-openapi'
import type { OSSEnv } from '../types'
import {
  ExtendedIssueSchema,
  ScoredIssueSchema,
  RepoHealthSchema,
  DossierSchema,
  ClaimRecordSchema
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

// ============================================================================
// Shared Request Schemas
// ============================================================================

export const slugParam = z.object({
  slug: z.string().openapi({
    param: { name: 'slug', in: 'path' },
    example: 'fastify-fastify'
  })
})

export const slugIssueIdParam = z.object({
  slug: z.string().openapi({
    param: { name: 'slug', in: 'path' },
    example: 'fastify-fastify'
  }),
  issueId: z.string().openapi({
    param: { name: 'issueId', in: 'path' },
    example: 'github-fastify-fastify-5432'
  })
})

export const SlugBodySchema = z
  .object({
    slug: z.string().openapi({ example: 'fastify-fastify' })
  })
  .openapi('SlugBody')

// ============================================================================
// Domain-Specific Response Schemas
// ============================================================================

export const WatchlistResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      slugs: z.array(z.string())
    })
  })
  .openapi('WatchlistResponse')

export const WatchlistAddResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      slug: z.string(),
      added: z.boolean()
    })
  })
  .openapi('WatchlistAddResponse')

export const WatchlistRemoveResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      slug: z.string(),
      removed: z.boolean()
    })
  })
  .openapi('WatchlistRemoveResponse')

export const IssuesResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issues: z.array(ExtendedIssueSchema),
      slug: z.string()
    })
  })
  .openapi('ReconIssuesResponse')

export const ScoredIssuesResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issues: z.array(ScoredIssueSchema),
      slug: z.string()
    })
  })
  .openapi('ReconScoredIssuesResponse')

export const AllScoredIssuesResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issues: z.array(ScoredIssueSchema),
      totalCount: z.number(),
      repoCount: z.number()
    })
  })
  .openapi('AllScoredIssuesResponse')

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
    })
  })
  .openapi('IssueBriefResponse')

export const DossierResponseSchema = z
  .object({
    success: z.literal(true),
    data: DossierSchema
  })
  .openapi('ReconDossierSuccessResponse')
