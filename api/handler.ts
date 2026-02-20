/**
 * OSS Issues API Handler Factory
 *
 * Creates a Hono OpenAPI handler that can be mounted in a Cloudflare Worker.
 * This follows the same pattern as @wolffm/trader-worker's createTraderHandler.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import type {
  OSSEnv,
  Issue,
  ProjectResult,
  MarkedIssue,
  MarkedIssuesData,
  MarkStatus
} from './types'
import { PROJECTS, POOLS, getProjectsByPool, getProjectBySlug } from './config'
import { createReconRoutes } from './recon'
import { byCreatedAtDesc } from './utils'
import { createDataProvider } from './data-sources'
import {
  HealthResponseSchema,
  ProjectsResponseSchema,
  ProjectIssuesResponseSchema,
  PoolIssuesResponseSchema,
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
  const dataProvider = createDataProvider()

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

  // List all projects
  const projectsRoute = createRoute({
    method: 'get',
    path: '/projects',
    tags: ['Projects'],
    summary: 'List all projects',
    description: 'Returns all available open source projects and pool categories',
    responses: {
      200: {
        description: 'List of projects and pools',
        content: { 'application/json': { schema: ProjectsResponseSchema } }
      }
    }
  })

  app.openapi(projectsRoute, c => {
    const projects = PROJECTS.map(p => ({
      slug: p.slug,
      name: p.name,
      platform: p.platform,
      pools: p.pool,
      contributingUrl: p.contributingUrl
    }))
    return c.json({ success: true as const, data: { projects, pools: POOLS } }, 200)
  })

  // Get issues for a specific project
  const projectIssuesRoute = createRoute({
    method: 'get',
    path: '/issues/{slug}',
    tags: ['Issues'],
    summary: 'Get issues for a project',
    description: 'Fetches beginner-friendly issues for a specific project',
    request: {
      params: z.object({
        slug: z.string().openapi({ param: { name: 'slug', in: 'path' }, example: 'react' })
      })
    },
    responses: {
      200: {
        description: 'List of issues for the project',
        content: { 'application/json': { schema: ProjectIssuesResponseSchema } }
      },
      404: {
        description: 'Project not found',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(projectIssuesRoute, async c => {
    const { slug } = c.req.valid('param')
    const config = getProjectBySlug(slug)

    if (!config) {
      return c.json({ success: false as const, error: `Project '${slug}' not found` }, 404)
    }

    try {
      const issues = await dataProvider.fetchIssues(config, c.env)
      return c.json({ success: true as const, data: { issues, project: config.name } }, 200)
    } catch (err) {
      return c.json(
        { success: false as const, error: `Failed to fetch issues: ${getErrorMessage(err)}` },
        500
      )
    }
  })

  // Get issues for a pool (or all)
  const poolIssuesRoute = createRoute({
    method: 'get',
    path: '/issues',
    tags: ['Issues'],
    summary: 'Get issues by pool',
    description:
      'Fetches beginner-friendly issues for all projects in a pool (defaults to "all"). Optionally filter by difficulty level.',
    request: {
      query: z.object({
        pool: z.string().optional().default('all').openapi({ example: 'web-dev' }),
        difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional().openapi({
          example: 'beginner',
          description: 'Filter issues by difficulty level'
        })
      })
    },
    responses: {
      200: {
        description: 'Aggregated issues from all projects in the pool',
        content: { 'application/json': { schema: PoolIssuesResponseSchema } }
      },
      404: {
        description: 'Pool not found',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(poolIssuesRoute, async c => {
    const { pool, difficulty } = c.req.valid('query')
    const projects = getProjectsByPool(pool)

    if (projects.length === 0) {
      return c.json({ success: false as const, error: `Pool '${pool}' not found` }, 404)
    }

    // Fetch all projects in parallel
    const results = await Promise.all(
      projects.map(async (config): Promise<ProjectResult> => {
        try {
          const issues = await dataProvider.fetchIssues(config, c.env)
          return { project: config.slug, issues }
        } catch (err) {
          return { project: config.slug, issues: [], error: getErrorMessage(err) }
        }
      })
    )

    // Aggregate issues and errors
    let allIssues: Issue[] = []
    const errors: { project: string; error: string }[] = []

    for (const result of results) {
      if (result.error) {
        errors.push({ project: result.project, error: result.error })
      }
      allIssues.push(...result.issues)
    }

    // Filter by difficulty if specified
    if (difficulty) {
      allIssues = allIssues.filter(issue => issue.difficulty === difficulty)
    }

    // Sort by createdAt descending (newest first)
    allIssues.sort(byCreatedAtDesc)

    return c.json(
      {
        success: true as const,
        data: {
          issues: allIssues,
          pool,
          projectCount: projects.length,
          issueCount: allIssues.length,
          ...(difficulty && { difficulty }),
          ...(errors.length > 0 && { errors })
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
      version: '1.0.0',
      description: `
Aggregates beginner-friendly issues from multiple open source projects.

## Supported Platforms
- **GitHub** - PyTorch, React, Node.js, Hugging Face, Open Library
- **GitLab** - VLC (VideoLAN)
- **Gitea** - Blender
- **Phabricator** - MediaWiki (Wikimedia)
- **Bugzilla** - Linux Kernel
- **Trac** - FFmpeg

## Pools
Issues are grouped into pools:
- \`all\` - All projects
- \`ml-ai\` - Machine Learning / AI projects
- \`web-dev\` - Web Development projects
- \`creative\` - Creative Tools (Blender)
- \`media\` - Media / Video (VLC)
- \`systems\` - Systems / Kernel (Linux)

## Difficulty Classification
Issues are scored using a heuristic system that analyzes:
- Maintainer labels (good first issue, beginner, easy, etc.)
- Keywords in title/description (typo, docs, refactor, security, etc.)
- Complexity indicators (breaking change, RFC, performance, etc.)

Filter by difficulty: \`/issues?difficulty=beginner\`

## Usage
1. GET \`/projects\` - List available projects and pools
2. GET \`/issues?pool=web-dev\` - Get issues for a pool
3. GET \`/issues?pool=all&difficulty=beginner\` - Filter by difficulty
4. GET \`/issues/{slug}\` - Get issues for a specific project
    `.trim()
    },
    servers: [
      { url: 'https://hadoku.me/oss/api', description: 'Production' },
      { url: 'http://localhost:8787/oss/api', description: 'Local development' }
    ],
    tags: [
      { name: 'Health', description: 'Health check endpoint' },
      { name: 'Projects', description: 'Project listing' },
      { name: 'Issues', description: 'Issue fetching endpoints' },
      { name: 'Marking', description: 'Issue marking (ignored/process)' },
      { name: 'Recon - Watchlist', description: 'Watchlist management for recon pipeline' },
      { name: 'Recon - Issues', description: 'Per-repo issue and health data from recon pipeline' },
      { name: 'Recon - Claims', description: 'Issue claim tracking' },
      { name: 'Recon - Triggers', description: 'Scraper trigger endpoints' }
    ]
  })

  return app
}

/**
 * Creates a simple fetcher for programmatic access to issues.
 * Use this when you need to fetch issues without going through HTTP.
 *
 * @example
 * ```typescript
 * import { createOSSFetcher } from '@wolffm/oss-aggregator/api';
 *
 * const fetcher = createOSSFetcher(env);
 * const issues = await fetcher.fetchIssuesByPool('web-dev');
 * ```
 */
export function createOSSFetcher(env: OSSEnv) {
  const provider = createDataProvider()
  return {
    fetchIssuesForProject: (slug: string) => {
      const config = getProjectBySlug(slug)
      if (!config) throw new Error(`Project '${slug}' not found`)
      return provider.fetchIssues(config, env)
    },
    fetchIssuesByPool: async (pool: string) => {
      const projects = getProjectsByPool(pool)
      const results = await Promise.all(
        projects.map(async config => {
          try {
            return await provider.fetchIssues(config, env)
          } catch {
            return []
          }
        })
      )
      return results.flat()
    },
    getProjects: () => PROJECTS,
    getPools: () => POOLS,
    getProjectBySlug,
    getProjectsByPool
  }
}
