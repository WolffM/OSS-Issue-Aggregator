/**
 * Issue & Data Routes
 *
 * Per-repo data endpoints: health, issues, scored-issues, dossier, issue-brief.
 * Plus the aggregate all-scored-issues endpoint.
 */

import { type OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { type ScoredIssue, RepoHealthSchema, ResponseMetaSchema } from './types'
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
  DossierResponseSchema,
  slugParam,
  slugIssueIdParam,
  buildMeta,
  buildScrapedOnlyMeta
} from './route-helpers'
import {
  getConsolidatedRecon,
  getScrapedSlugs,
  getClaims,
  getRepoHealthEnveloped,
  getScoredIssuesEnveloped,
  getDossierEnveloped
} from './kv-reader'
import { scoreRepoHealth } from './health-scorer'
import { formatIssueBrief } from './issue-brief'
import { applyClaimOverlay } from './precompute'

/**
 * Strip heavy fields from ScoredIssue for the aggregate listing endpoint.
 * The full payload (~35 MB for 7k+ issues) exceeds Cloudflare Worker resource
 * limits. The removed fields are not consumed by the UI listing and can still
 * be fetched per-repo via the /:slug/scored-issues endpoint.
 */
function slimIssue(
  issue: ScoredIssue
): Omit<
  ScoredIssue,
  | 'body'
  | 'reactionGroups'
  | 'sentimentSignals'
  | 'commentDigest'
  | 'likelyFiles'
  | 'relatedIssues'
  | '_scoring'
  | 'difficultySignals'
> {
  const {
    body: _body,
    reactionGroups: _rg,
    sentimentSignals: _ss,
    commentDigest: _cd,
    likelyFiles: _lf,
    relatedIssues: _ri,
    _scoring,
    difficultySignals: _ds,
    ...slim
  } = issue
  return slim
}

async function computeHealth(kv: KVNamespace, slug: string) {
  const consolidated = await getConsolidatedRecon(kv, slug)
  if (!consolidated?.repoMeta) return null
  return scoreRepoHealth(
    consolidated.repoMeta,
    consolidated.mergedPrs ?? [],
    consolidated.rejectedPrs ?? []
  )
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
              z.object({
                success: z.literal(true),
                data: RepoHealthSchema,
                _meta: ResponseMetaSchema
              }),
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

      // Try pre-computed first (with envelope)
      const envelope = await getRepoHealthEnveloped(kv, slug)
      if (envelope) {
        return c.json(
          { success: true as const, data: envelope.data, _meta: buildMeta(envelope) },
          200
        )
      }

      // Fallback: compute on-the-fly
      const health = await computeHealth(kv, slug)

      if (!health) {
        return c.json({ success: true as const, data: { status: 'pending' as const } }, 200)
      }

      return c.json(
        { success: true as const, data: health, _meta: buildScrapedOnlyMeta(null) },
        200
      )
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
      const consolidated = await getConsolidatedRecon(kv, slug)

      return c.json(
        {
          success: true as const,
          data: { issues: consolidated?.issues ?? [], slug },
          _meta: buildScrapedOnlyMeta(consolidated?.scrapedAt ?? null)
        },
        200
      )
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

      const envelope = await getScoredIssuesEnveloped(kv, slug)
      if (!envelope) {
        return c.json({ success: true as const, data: { status: 'pending' as const } }, 200)
      }

      const claims = await getClaims(kv, slug)
      const withClaims = applyClaimOverlay(envelope.data, claims ?? [])
      return c.json(
        {
          success: true as const,
          data: { issues: withClaims, slug },
          _meta: buildMeta(envelope)
        },
        200
      )
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
            schema: z.union([DossierResponseSchema, PendingResponseSchema])
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

      const envelope = await getDossierEnveloped(kv, slug)
      if (!envelope) {
        return c.json({ success: true as const, data: { status: 'pending' as const } }, 200)
      }

      return c.json(
        { success: true as const, data: envelope.data, _meta: buildMeta(envelope) },
        200
      )
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

      const [scoredEnvelope, healthEnvelope, consolidated, claims] = await Promise.all([
        getScoredIssuesEnveloped(kv, slug),
        getRepoHealthEnveloped(kv, slug),
        getConsolidatedRecon(kv, slug),
        getClaims(kv, slug)
      ])

      const meta = consolidated?.repoMeta ?? null
      if (!scoredEnvelope || !healthEnvelope || !meta) {
        return c.json({ success: true as const, data: { status: 'pending' as const } }, 200)
      }

      const scored = applyClaimOverlay(scoredEnvelope.data, claims ?? [])

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

      const merged = consolidated?.mergedPrs ?? []
      const rejected = consolidated?.rejectedPrs ?? []
      const brief = formatIssueBrief(issue, healthEnvelope.data, meta, merged, rejected)

      return c.json(
        {
          success: true as const,
          data: { issue, repoHealth: healthEnvelope.data, brief },
          _meta: buildMeta(scoredEnvelope)
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
      const envelopes = await Promise.all(
        slugs.map(async slug => {
          const envelope = await getScoredIssuesEnveloped(kv, slug)
          if (!envelope) return null
          const claims = await getClaims(kv, slug)
          return {
            issues: applyClaimOverlay(envelope.data, claims ?? []),
            scraped_at: envelope.scraped_at,
            computed_at: envelope.computed_at
          }
        })
      )

      const validEnvelopes = envelopes.filter((e): e is NonNullable<typeof e> => e !== null)

      // Strip heavy fields to stay within Worker resource limits (~35 MB → ~15 MB)
      const allIssues = validEnvelopes.flatMap(e => e.issues.map(slimIssue))

      // Sort by CVS descending
      allIssues.sort((a, b) => b.cvs - a.cvs)

      // Use oldest timestamps across repos (worst-case freshness)
      const scrapedAts = validEnvelopes
        .map(e => e.scraped_at)
        .filter((s): s is string => s !== null)
      const computedAts = validEnvelopes.map(e => e.computed_at).filter((s): s is string => !!s)

      const oldestScraped = scrapedAts.length > 0 ? scrapedAts.sort()[0] : null
      const oldestComputed = computedAts.length > 0 ? computedAts.sort()[0] : null

      return c.json(
        {
          success: true as const,
          data: {
            issues: allIssues,
            totalCount: allIssues.length,
            repoCount: slugs.length
          },
          _meta: {
            scraped_at: oldestScraped,
            computed_at: oldestComputed,
            served_at: new Date().toISOString()
          }
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })
}
