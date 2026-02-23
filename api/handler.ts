/**
 * OSS Issues API Handler Factory
 *
 * Creates a Hono OpenAPI handler that can be mounted in a Cloudflare Worker.
 * This follows the same pattern as @wolffm/trader-worker's createTraderHandler.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import type { OSSEnv, MarkedIssue, MarkedIssuesData, MarkStatus } from './types'
import { createReconRoutes } from './recon'
import {
  HealthResponseSchema,
  ErrorResponseSchema,
  MarkIssueRequestSchema,
  MarkIssueResponseSchema,
  UnmarkIssueResponseSchema,
  MarkedIssuesResponseSchema
} from './schemas'

interface HonoEnv {
  Bindings: OSSEnv
}

// ============================================================================
// KV Helpers for Issue Marking
// ============================================================================

async function getMarkedIssues(
  kv: KVNamespace | undefined,
  status: MarkStatus
): Promise<MarkedIssue[]> {
  if (!kv) return []
  try {
    const data = await kv.get<MarkedIssuesData>(`marked:${status}`, 'json')
    return data?.issues || []
  } catch {
    return []
  }
}

async function saveMarkedIssues(
  kv: KVNamespace | undefined,
  status: MarkStatus,
  issues: MarkedIssue[]
): Promise<void> {
  if (!kv) throw new Error('KV storage not available')
  const data: MarkedIssuesData = {
    issues,
    updatedAt: new Date().toISOString()
  }
  await kv.put(`marked:${status}`, JSON.stringify(data))
}

// ============================================================================
// Shared Helpers
// ============================================================================

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error'
}

function requireKV(env: OSSEnv) {
  return env.CACHE_KV ?? null
}

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Creates a Hono OpenAPI app for the OSS Issues API.
 * Mount this at your desired base path (e.g., '/oss/api').
 *
 * @param basePath - The base path for all routes (default: '/oss/api')
 * @returns A Hono app that handles all OSS Issues API routes
 *
 * @example
 * ```typescript
 * import { createOSSHandler } from '@wolffm/oss-aggregator/api';
 *
 * export default {
 *   fetch(request: Request, env: Env) {
 *     const handler = createOSSHandler('/oss/api');
 *     return handler.fetch(request, env);
 *   }
 * };
 * ```
 */
export function createOSSHandler(basePath = '/oss/api') {
  const app = new OpenAPIHono<HonoEnv>().basePath(basePath)

  // CORS middleware
  app.use('*', cors())

  // ============================================================================
  // Routes
  // ============================================================================

  // Health check
  const healthRoute = createRoute({
    method: 'get',
    path: '/health',
    tags: ['Health'],
    summary: 'Health check',
    description: 'Returns the health status of the API',
    responses: {
      200: {
        description: 'API is healthy',
        content: { 'application/json': { schema: HealthResponseSchema } }
      }
    }
  })

  app.openapi(healthRoute, c => {
    return c.json(
      {
        success: true as const,
        data: {
          status: 'healthy' as const,
          service: 'oss-issues-api' as const,
          timestamp: new Date().toISOString()
        }
      },
      200
    )
  })

  // ============================================================================
  // Issue Marking Routes
  // ============================================================================

  // Mark an issue
  const markIssueRoute = createRoute({
    method: 'post',
    path: '/issues/{issueId}/mark',
    tags: ['Marking'],
    summary: 'Mark an issue',
    description: 'Mark an issue as ignored or for processing',
    request: {
      params: z.object({
        issueId: z
          .string()
          .openapi({ param: { name: 'issueId', in: 'path' }, example: 'github-react-12345' })
      }),
      body: {
        content: {
          'application/json': { schema: MarkIssueRequestSchema }
        }
      }
    },
    responses: {
      200: {
        description: 'Issue marked successfully',
        content: { 'application/json': { schema: MarkIssueResponseSchema } }
      },
      400: {
        description: 'Invalid request',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(markIssueRoute, async c => {
    const { issueId } = c.req.valid('param')
    const { status, reason } = c.req.valid('json')

    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      // Remove from the other status list if present
      const otherStatus: MarkStatus = status === 'ignored' ? 'process' : 'ignored'
      const otherIssues = await getMarkedIssues(kv, otherStatus)
      const filteredOther = otherIssues.filter(i => i.issueId !== issueId)
      if (filteredOther.length !== otherIssues.length) {
        await saveMarkedIssues(kv, otherStatus, filteredOther)
      }

      // Add to the target status list
      const issues = await getMarkedIssues(kv, status)
      const existing = issues.find(i => i.issueId === issueId)
      const markedAt = new Date().toISOString()

      if (existing) {
        // Update existing
        existing.markedAt = markedAt
        existing.reason = reason
      } else {
        // Add new
        issues.push({ issueId, status, markedAt, reason })
      }

      await saveMarkedIssues(kv, status, issues)

      return c.json(
        {
          success: true as const,
          data: { issueId, status, markedAt }
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // Unmark an issue
  const unmarkIssueRoute = createRoute({
    method: 'delete',
    path: '/issues/{issueId}/mark',
    tags: ['Marking'],
    summary: 'Unmark an issue',
    description: 'Remove marking from an issue',
    request: {
      params: z.object({
        issueId: z
          .string()
          .openapi({ param: { name: 'issueId', in: 'path' }, example: 'github-react-12345' })
      })
    },
    responses: {
      200: {
        description: 'Issue unmarked successfully',
        content: { 'application/json': { schema: UnmarkIssueResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(unmarkIssueRoute, async c => {
    const { issueId } = c.req.valid('param')

    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      let removed = false

      // Remove from both lists
      for (const status of ['ignored', 'process'] as MarkStatus[]) {
        const issues = await getMarkedIssues(kv, status)
        const filtered = issues.filter(i => i.issueId !== issueId)
        if (filtered.length !== issues.length) {
          removed = true
          await saveMarkedIssues(kv, status, filtered)
        }
      }

      return c.json(
        {
          success: true as const,
          data: { issueId, removed }
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // Get marked issues
  const getMarkedIssuesRoute = createRoute({
    method: 'get',
    path: '/issues/marked',
    tags: ['Marking'],
    summary: 'Get marked issues',
    description: 'Get all issues marked with a specific status',
    request: {
      query: z.object({
        status: z.enum(['ignored', 'process']).openapi({ example: 'ignored' })
      })
    },
    responses: {
      200: {
        description: 'List of marked issues',
        content: { 'application/json': { schema: MarkedIssuesResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(getMarkedIssuesRoute, async c => {
    const { status } = c.req.valid('query')

    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const issues = await getMarkedIssues(kv, status)

      return c.json(
        {
          success: true as const,
          data: {
            issues,
            status,
            count: issues.length
          }
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // ============================================================================
  // Recon Pipeline Routes
  // ============================================================================

  app.route('/recon', createReconRoutes())

  // ============================================================================
  // OpenAPI Spec
  // ============================================================================

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'OSS Issues Aggregator API',
      version: '2.0.0',
      description: `
Aggregates and scores open source issues for contribution viability.

All project data is dynamically sourced from the recon pipeline via Cloudflare KV.
Projects are managed through the watchlist — no hardcoded project lists.

## Recon Pipeline
- Add repos to watchlist → scraper populates KV → aggregator scores issues
- GET \`/recon/all-scored-issues\` — all scored issues across all repos
- GET \`/recon/{slug}/health\` — repo health analysis
- GET \`/recon/{slug}/dossier\` — contribution intelligence dossier

## Scoring
Issues are scored using CVS (Contribution Viability Score, 0-100):
- **Repo health** (30%) — maintainer activity, merge accessibility
- **Issue quality** (50%) — freshness, activity, content quality, competition
- **Timing** (20%) — lifecycle stage (fresh → triaged → accepted → stale → zombie)

Tiers: go (85+), likely (70+), maybe (50+), risky (30+), skip (<30)
    `.trim()
    },
    servers: [
      { url: 'https://hadoku.me/oss/api', description: 'Production' },
      { url: 'http://localhost:8787/oss/api', description: 'Local development' }
    ],
    tags: [
      { name: 'Health', description: 'Health check endpoint' },
      { name: 'Marking', description: 'Issue marking (ignored/process)' },
      { name: 'Recon - Watchlist', description: 'Watchlist management for recon pipeline' },
      { name: 'Recon - Issues', description: 'Per-repo issue and health data from recon pipeline' },
      { name: 'Recon - Claims', description: 'Issue claim tracking' },
      { name: 'Recon - Triggers', description: 'Scraper trigger endpoints' }
    ]
  })

  return app
}
