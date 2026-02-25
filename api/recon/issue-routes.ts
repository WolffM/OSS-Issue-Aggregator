/**
 * Issue & Data Routes
 *
 * Per-repo data endpoints: health, issues, scored-issues, dossier, issue-brief.
 * Plus the aggregate all-scored-issues endpoint.
 */

import { type OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { RepoHealthSchema, DossierSchema } from './types'
import {
  type HonoEnv,
  getErrorMessage,
  requireKV,
  ErrorResponseSchema,
  PendingResponseSchema,
  IssuesResponseSchema,
  ScoredIssuesResponseSchema,
  AllScoredIssuesResponseSchema,
  IssueBriefResponseSchema,
  slugParam,
  slugIssueIdParam
} from './route-helpers'
import {
  getScrapedSlugs,
  getReconIssues,
  getRepoMeta,
  getMergedPRs,
  getRejectedPRs,
  getClaims,
  getRepoHealth,
  getScoredIssues,
  getDossier
} from './kv-reader'
import { scoreRepoHealth } from './health-scorer'
import { formatIssueBrief } from './issue-brief'
import { applyClaimOverlay } from './precompute'

async function computeHealth(kv: KVNamespace, slug: string) {
  const [meta, merged, rejected] = await Promise.all([
    getRepoMeta(kv, slug),
    getMergedPRs(kv, slug),
    getRejectedPRs(kv, slug)
  ])
  if (!meta) return null
  return scoreRepoHealth(meta, merged ?? [], rejected ?? [])
}

export function registerIssueRoutes(app: OpenAPIHono<HonoEnv>) {
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

      // Try pre-computed first
      const cached = await getRepoHealth(kv, slug)
      if (cached) {
        return c.json({ success: true as const, data: cached }, 200)
      }

      // Fallback: compute on-the-fly
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
    description: 'Returns issues with CVS scores, or pending status if not yet computed.',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'Scored issues or pending status',
        content: {
          'application/json': {
            schema: z.union([ScoredIssuesResponseSchema, PendingResponseSchema])
          }
        }
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

      const cached = await getScoredIssues(kv, slug)
      if (!cached) {
        return c.json({ success: true as const, data: { status: 'pending' as const } }, 200)
      }

      const claims = await getClaims(kv, slug)
      const withClaims = applyClaimOverlay(cached, claims ?? [])
      return c.json({ success: true as const, data: { issues: withClaims, slug } }, 200)
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

      const cached = await getDossier(kv, slug)
      if (!cached) {
        return c.json({ success: true as const, data: { status: 'pending' as const } }, 200)
      }

      return c.json({ success: true as const, data: cached }, 200)
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

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

      const [cachedScored, cachedHealth, meta, merged, rejected, claims] = await Promise.all([
        getScoredIssues(kv, slug),
        getRepoHealth(kv, slug),
        getRepoMeta(kv, slug),
        getMergedPRs(kv, slug),
        getRejectedPRs(kv, slug),
        getClaims(kv, slug)
      ])

      if (!cachedScored || !cachedHealth || !meta) {
        return c.json({ success: true as const, data: { status: 'pending' as const } }, 200)
      }

      const scored = applyClaimOverlay(cachedScored, claims ?? [])

      // Find the specific issue
      const issue = scored.find(i => i.id === issueId)
      if (!issue) {
        return c.json(
          { success: false as const, error: `Issue '${issueId}' not found in ${slug}` },
          404
        )
      }

      // Ensure body is populated for issue-brief consumers (fallback to bodyPreview)
      if (!issue.body) {
        issue.body = issue.bodyPreview
      }

      const brief = formatIssueBrief(issue, cachedHealth, meta, merged ?? [], rejected ?? [])

      return c.json(
        {
          success: true as const,
          data: { issue, repoHealth: cachedHealth, brief }
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // GET /all-scored-issues
  const allScoredIssuesRoute = createRoute({
    method: 'get',
    path: '/all-scored-issues',
    tags: ['Recon - Issues'],
    summary: 'Get all scored issues',
    description: 'Returns scored issues across all watchlist repos, sorted by CVS descending.',
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
      const slugs = await getScrapedSlugs(kv)

      // Read pre-computed scored issues from KV only — skip slugs without pre-computed data
      const results = await Promise.all(
        slugs.map(async slug => {
          const cached = await getScoredIssues(kv, slug)
          if (!cached) return []
          const claims = await getClaims(kv, slug)
          return applyClaimOverlay(cached, claims ?? [])
        })
      )

      const allIssues = results.flat()

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
}
