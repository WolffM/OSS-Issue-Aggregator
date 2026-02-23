/**
 * Recon Pipeline Routes
 *
 * Hono OpenAPI sub-app for the OSS recon pipeline.
 * Mounted at /oss/api/recon/* by handler.ts.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { OSSEnv } from '../types'
import {
  ExtendedIssueSchema,
  ScoredIssueSchema,
  RepoHealthSchema,
  DossierSchema,
  ClaimRecordSchema
} from './types'
import {
  getReconIssues,
  getRepoMeta,
  getMergedPRs,
  getRejectedPRs,
  getComments,
  getClaims
} from './kv-reader'
import { getWatchlist, addToWatchlist, removeFromWatchlist } from './watchlist'
import { addClaim, removeClaim } from './claims'
import { triggerScrape } from './triggers'
import { scoreRepoHealth } from './health-scorer'
import { scoreIssues } from './issue-scorer'
import { compileDossier } from './dossier-compiler'
import { formatIssueBrief } from './issue-brief'

// ============================================================================
// Types & Helpers
// ============================================================================

interface HonoEnv {
  Bindings: OSSEnv
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error'
}

function requireKV(env: OSSEnv) {
  return env.CACHE_KV ?? null
}

async function computeHealth(kv: KVNamespace, slug: string) {
  const [meta, merged, rejected] = await Promise.all([
    getRepoMeta(kv, slug),
    getMergedPRs(kv, slug),
    getRejectedPRs(kv, slug)
  ])
  if (!meta) return null
  return scoreRepoHealth(meta, merged ?? [], rejected ?? [])
}

async function computeScoredIssues(kv: KVNamespace, slug: string) {
  const [issues, comments, claims, meta, merged, rejected] = await Promise.all([
    getReconIssues(kv, slug),
    getComments(kv, slug),
    getClaims(kv, slug),
    getRepoMeta(kv, slug),
    getMergedPRs(kv, slug),
    getRejectedPRs(kv, slug)
  ])

  if (!issues || issues.length === 0) return []

  const health = meta ? scoreRepoHealth(meta, merged ?? [], rejected ?? []) : null
  return scoreIssues(issues, comments ?? {}, health, claims ?? [])
}

async function computeDossier(kv: KVNamespace, slug: string) {
  const [meta, merged, rejected, issues, comments, claims] = await Promise.all([
    getRepoMeta(kv, slug),
    getMergedPRs(kv, slug),
    getRejectedPRs(kv, slug),
    getReconIssues(kv, slug),
    getComments(kv, slug),
    getClaims(kv, slug)
  ])

  if (!meta) return null

  const health = scoreRepoHealth(meta, merged ?? [], rejected ?? [])
  const scored =
    issues && issues.length > 0 ? scoreIssues(issues, comments ?? {}, health, claims ?? []) : []

  return compileDossier(slug, meta, health, scored, merged ?? [], rejected ?? [])
}

// ============================================================================
// Response Schemas
// ============================================================================

const ErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.string()
  })
  .openapi('ReconErrorResponse')

const WatchlistResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      slugs: z.array(z.string())
    })
  })
  .openapi('WatchlistResponse')

const WatchlistAddResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      slug: z.string(),
      added: z.boolean()
    })
  })
  .openapi('WatchlistAddResponse')

const WatchlistRemoveResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      slug: z.string(),
      removed: z.boolean()
    })
  })
  .openapi('WatchlistRemoveResponse')

const PendingResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      status: z.literal('pending')
    })
  })
  .openapi('ReconPendingResponse')

const IssuesResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issues: z.array(ExtendedIssueSchema),
      slug: z.string()
    })
  })
  .openapi('ReconIssuesResponse')

const ScoredIssuesResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issues: z.array(ScoredIssueSchema),
      slug: z.string()
    })
  })
  .openapi('ReconScoredIssuesResponse')

const AllScoredIssuesResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issues: z.array(ScoredIssueSchema),
      totalCount: z.number(),
      repoCount: z.number()
    })
  })
  .openapi('AllScoredIssuesResponse')

const RefreshResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      status: z.literal('triggered')
    })
  })
  .openapi('RefreshResponse')

const ClaimResponseSchema = z
  .object({
    success: z.literal(true),
    data: ClaimRecordSchema
  })
  .openapi('ClaimResponse')

const UnclaimResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issueId: z.string(),
      removed: z.boolean()
    })
  })
  .openapi('UnclaimResponse')

const IssueBriefResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      issue: ScoredIssueSchema,
      repoHealth: RepoHealthSchema,
      brief: z.string().openapi({ description: 'Markdown-formatted SWE agent execution context' })
    })
  })
  .openapi('IssueBriefResponse')

// ============================================================================
// Request Schemas
// ============================================================================

const SlugBodySchema = z
  .object({
    slug: z.string().openapi({ example: 'fastify-fastify' })
  })
  .openapi('SlugBody')

const ClaimRequestSchema = z
  .object({
    issueId: z.string().openapi({ example: 'github-fastify-fastify-5432' }),
    claimedBy: z.string().openapi({ example: 'myuser' }),
    forkIssueUrl: z
      .string()
      .optional()
      .openapi({ example: 'https://github.com/myuser/fastify/issues/1' })
  })
  .openapi('ClaimRequest')

const UnclaimRequestSchema = z
  .object({
    issueId: z.string().openapi({ example: 'github-fastify-fastify-5432' })
  })
  .openapi('UnclaimRequest')

const slugParam = z.object({
  slug: z.string().openapi({
    param: { name: 'slug', in: 'path' },
    example: 'fastify-fastify'
  })
})

const slugIssueIdParam = z.object({
  slug: z.string().openapi({
    param: { name: 'slug', in: 'path' },
    example: 'fastify-fastify'
  }),
  issueId: z.string().openapi({
    param: { name: 'issueId', in: 'path' },
    example: 'github-fastify-fastify-5432'
  })
})

// ============================================================================
// Route Factory
// ============================================================================

export function createReconRoutes() {
  const app = new OpenAPIHono<HonoEnv>()

  // --------------------------------------------------------------------------
  // Watchlist Routes
  // --------------------------------------------------------------------------

  // GET /watchlist
  const getWatchlistRoute = createRoute({
    method: 'get',
    path: '/watchlist',
    tags: ['Recon - Watchlist'],
    summary: 'Get watchlist',
    description: 'Returns all repo slugs on the recon watchlist',
    responses: {
      200: {
        description: 'Watchlist slugs',
        content: { 'application/json': { schema: WatchlistResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(getWatchlistRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    const slugs = await getWatchlist(kv)
    return c.json({ success: true as const, data: { slugs } }, 200)
  })

  // POST /watchlist/add
  const addWatchlistRoute = createRoute({
    method: 'post',
    path: '/watchlist/add',
    tags: ['Recon - Watchlist'],
    summary: 'Add to watchlist',
    description:
      'Adds a repo slug to the watchlist. Accepts owner/repo or owner-repo format. Optionally triggers a scraper run.',
    request: {
      body: {
        content: { 'application/json': { schema: SlugBodySchema } }
      }
    },
    responses: {
      200: {
        description: 'Slug added (or already present)',
        content: { 'application/json': { schema: WatchlistAddResponseSchema } }
      },
      400: {
        description: 'Invalid slug format',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(addWatchlistRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    const { slug: rawSlug } = c.req.valid('json')

    try {
      const result = await addToWatchlist(kv, rawSlug)

      // Fire-and-forget scraper trigger if configured
      if (result.added && c.env.SCRAPER_API_URL) {
        void triggerScrape(c.env.SCRAPER_API_URL, result.slug, undefined, c.env.SCRAPER_API_KEY)
      }

      return c.json({ success: true as const, data: result }, 200)
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 400)
    }
  })

  // POST /watchlist/remove
  const removeWatchlistRoute = createRoute({
    method: 'post',
    path: '/watchlist/remove',
    tags: ['Recon - Watchlist'],
    summary: 'Remove from watchlist',
    description: 'Removes a repo slug from the watchlist',
    request: {
      body: {
        content: { 'application/json': { schema: SlugBodySchema } }
      }
    },
    responses: {
      200: {
        description: 'Slug removed (or was not present)',
        content: { 'application/json': { schema: WatchlistRemoveResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(removeWatchlistRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    const { slug: rawSlug } = c.req.valid('json')
    const result = await removeFromWatchlist(kv, rawSlug)
    return c.json({ success: true as const, data: result }, 200)
  })

  // --------------------------------------------------------------------------
  // Per-Repo Data Routes
  // --------------------------------------------------------------------------

  // GET /:slug/health
  const healthRoute = createRoute({
    method: 'get',
    path: '/{slug}/health',
    tags: ['Recon - Issues'],
    summary: 'Get repo health',
    description: 'Returns computed repo health scores, or pending status if not yet analyzed',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'Repo health data or pending status',
        content: {
          'application/json': {
            schema: z.union([
              z.object({ success: z.literal(true), data: RepoHealthSchema }),
              PendingResponseSchema
            ])
          }
        }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(healthRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const health = await computeHealth(kv, slug)

      if (!health) {
        return c.json({ success: true as const, data: { status: 'pending' as const } }, 200)
      }

      return c.json({ success: true as const, data: health }, 200)
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // GET /:slug/issues
  const issuesRoute = createRoute({
    method: 'get',
    path: '/{slug}/issues',
    tags: ['Recon - Issues'],
    summary: 'Get raw issues',
    description: 'Returns raw extended issues from the scraper (unscored)',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'Extended issues for the repo',
        content: { 'application/json': { schema: IssuesResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(issuesRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const issues = await getReconIssues(kv, slug)

      return c.json({ success: true as const, data: { issues: issues ?? [], slug } }, 200)
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // GET /:slug/scored-issues
  const scoredIssuesRoute = createRoute({
    method: 'get',
    path: '/{slug}/scored-issues',
    tags: ['Recon - Issues'],
    summary: 'Get scored issues',
    description:
      'Returns issues with CVS scores computed from repo health, lifecycle, sentiment, and content quality.',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'Scored issues for the repo',
        content: { 'application/json': { schema: ScoredIssuesResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(scoredIssuesRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const scored = await computeScoredIssues(kv, slug)

      return c.json({ success: true as const, data: { issues: scored, slug } }, 200)
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // GET /:slug/dossier
  const dossierRoute = createRoute({
    method: 'get',
    path: '/{slug}/dossier',
    tags: ['Recon - Issues'],
    summary: 'Get repo dossier',
    description:
      'Returns the compiled dossier for a repo, or pending status if repo meta is not yet available',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'Dossier data or pending status',
        content: {
          'application/json': {
            schema: z.union([
              z.object({ success: z.literal(true), data: DossierSchema }),
              PendingResponseSchema
            ])
          }
        }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(dossierRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const dossier = await computeDossier(kv, slug)

      if (!dossier) {
        return c.json({ success: true as const, data: { status: 'pending' as const } }, 200)
      }

      return c.json({ success: true as const, data: dossier }, 200)
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // --------------------------------------------------------------------------
  // Issue Brief Route
  // --------------------------------------------------------------------------

  // GET /:slug/issue-brief/:issueId
  const issueBriefRoute = createRoute({
    method: 'get',
    path: '/{slug}/issue-brief/{issueId}',
    tags: ['Recon - Issues'],
    summary: 'Get issue brief for SWE agent',
    description:
      'Returns a self-contained execution context for a SWE agent to work on a specific issue. Includes contribution rules, PR patterns, quirks, and environment setup — but not selection metrics like CVS scores.',
    request: { params: slugIssueIdParam },
    responses: {
      200: {
        description: 'Issue brief with execution context',
        content: {
          'application/json': {
            schema: z.union([IssueBriefResponseSchema, PendingResponseSchema])
          }
        }
      },
      404: {
        description: 'Issue not found',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(issueBriefRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug, issueId } = c.req.valid('param')

      // Fetch all raw data in one parallel batch
      const [issues, comments, claims, meta, merged, rejected] = await Promise.all([
        getReconIssues(kv, slug),
        getComments(kv, slug),
        getClaims(kv, slug),
        getRepoMeta(kv, slug),
        getMergedPRs(kv, slug),
        getRejectedPRs(kv, slug)
      ])

      if (!meta) {
        return c.json({ success: true as const, data: { status: 'pending' as const } }, 200)
      }

      if (!issues || issues.length === 0) {
        return c.json({ success: false as const, error: 'No issues found for this repo' }, 404)
      }

      // Compute health and scored issues from raw data
      const health = scoreRepoHealth(meta, merged ?? [], rejected ?? [])
      const scored = scoreIssues(issues, comments ?? {}, health, claims ?? [])

      // Find the specific issue
      const issue = scored.find(i => i.id === issueId)
      if (!issue) {
        return c.json(
          { success: false as const, error: `Issue '${issueId}' not found in ${slug}` },
          404
        )
      }

      const brief = formatIssueBrief(issue, health, meta, merged ?? [], rejected ?? [])

      return c.json(
        {
          success: true as const,
          data: { issue, repoHealth: health, brief }
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // --------------------------------------------------------------------------
  // Aggregate Route
  // --------------------------------------------------------------------------

  // GET /all-scored-issues
  const allScoredIssuesRoute = createRoute({
    method: 'get',
    path: '/all-scored-issues',
    tags: ['Recon - Issues'],
    summary: 'Get all scored issues',
    description:
      'Returns scored issues across all watchlist repos, sorted by CVS descending. Excludes killed repos by default.',
    request: {
      query: z.object({
        includeKilled: z.string().optional().openapi({
          example: 'false',
          description: 'Include issues from killed repos (default: false)'
        })
      })
    },
    responses: {
      200: {
        description: 'Aggregated scored issues',
        content: { 'application/json': { schema: AllScoredIssuesResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(allScoredIssuesRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { includeKilled } = c.req.valid('query')
      const showKilled = includeKilled === 'true'

      const slugs = await getWatchlist(kv)

      // Score issues for all repos in parallel
      const results = await Promise.all(slugs.map(slug => computeScoredIssues(kv, slug)))

      let allIssues = results.flat()

      // Filter killed repos unless explicitly requested
      if (!showKilled) {
        allIssues = allIssues.filter(issue => !issue.repoKilled)
      }

      // Sort by CVS descending
      allIssues.sort((a, b) => b.cvs - a.cvs)

      return c.json(
        {
          success: true as const,
          data: {
            issues: allIssues,
            totalCount: allIssues.length,
            repoCount: slugs.length
          }
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // --------------------------------------------------------------------------
  // Trigger Route
  // --------------------------------------------------------------------------

  // POST /:slug/refresh
  const refreshRoute = createRoute({
    method: 'post',
    path: '/{slug}/refresh',
    tags: ['Recon - Triggers'],
    summary: 'Trigger scraper refresh',
    description: 'Tells the scraper to re-scrape data for this repo (fire-and-forget)',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'Scrape triggered',
        content: { 'application/json': { schema: RefreshResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(refreshRoute, async c => {
    if (!c.env.SCRAPER_API_URL) {
      return c.json({ success: false as const, error: 'SCRAPER_API_URL not configured' }, 500)
    }

    const { slug } = c.req.valid('param')
    const result = await triggerScrape(
      c.env.SCRAPER_API_URL,
      slug,
      undefined,
      c.env.SCRAPER_API_KEY
    )

    if (!result.triggered) {
      return c.json(
        { success: false as const, error: result.error ?? 'Failed to trigger scraper' },
        500
      )
    }

    return c.json({ success: true as const, data: { status: 'triggered' as const } }, 200)
  })

  // --------------------------------------------------------------------------
  // Claim Routes
  // --------------------------------------------------------------------------

  // POST /:slug/claim
  const claimRoute = createRoute({
    method: 'post',
    path: '/{slug}/claim',
    tags: ['Recon - Claims'],
    summary: 'Claim an issue',
    description:
      'Reports that an issue has been claimed by a user (vibedispatch calls this after forking)',
    request: {
      params: slugParam,
      body: {
        content: { 'application/json': { schema: ClaimRequestSchema } }
      }
    },
    responses: {
      200: {
        description: 'Claim recorded',
        content: { 'application/json': { schema: ClaimResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(claimRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    const { slug } = c.req.valid('param')
    const body = c.req.valid('json')

    try {
      const record = await addClaim(kv, slug, body)
      return c.json({ success: true as const, data: record }, 200)
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // POST /:slug/unclaim
  const unclaimRoute = createRoute({
    method: 'post',
    path: '/{slug}/unclaim',
    tags: ['Recon - Claims'],
    summary: 'Unclaim an issue',
    description: 'Removes a claim from an issue (e.g., after a submitted PR is rejected)',
    request: {
      params: slugParam,
      body: {
        content: { 'application/json': { schema: UnclaimRequestSchema } }
      }
    },
    responses: {
      200: {
        description: 'Claim removed',
        content: { 'application/json': { schema: UnclaimResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(unclaimRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    const { slug } = c.req.valid('param')
    const { issueId } = c.req.valid('json')

    try {
      const removed = await removeClaim(kv, slug, issueId)
      return c.json({ success: true as const, data: { issueId, removed } }, 200)
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  return app
}
