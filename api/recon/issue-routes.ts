/**
 * Issue & Data Routes
 *
 * Per-repo data endpoints: health, issues, scored-issues, dossier, issue-brief.
 * Plus the aggregate all-scored-issues endpoint.
 */

import { type OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  type ExtendedIssue,
  type RepoHealth,
  type ScoredIssue,
  RepoHealthSchema,
  ResponseMetaSchema
} from './types'
import {
  type HonoEnv,
  getErrorMessage,
  requireKV,
  ErrorResponseSchema,
  PendingResponseSchema,
  IssuesResponseSchema,
  ScoredIssuesResponseSchema,
  AllScoredIssuesResponseSchema,
  AggregateVersionResponseSchema,
  IssueBriefResponseSchema,
  ComposeBriefRequestSchema,
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
  getDossierEnveloped,
  getAggregate,
  getAggregateVersion
} from './kv-reader'
import { scoreRepoHealth } from './health-scorer'
import { formatIssueBrief } from './issue-brief'
import {
  applyClaimOverlay,
  sortComparator,
  buildAndWriteAggregates,
  type AggregateSortField
} from './precompute'
import { computeDispatchReadiness } from './dispatch-readiness'

/**
 * Strip heavy fields from ScoredIssue for the aggregate listing endpoint.
 * The full payload (~35 MB for 7k+ issues) exceeds Cloudflare Worker resource
 * limits. The removed fields are not consumed by the UI listing and can still
 * be fetched per-repo via the /:slug/scored-issues endpoint.
 */
/**
 * Build a ScoredIssue-shaped record for an issue that exists in raw scraper
 * data but is absent from :scored-issues. Scoring fields are set to neutral
 * placeholders; `dataCompleteness: 'raw'` signals to consumers that the
 * numeric signals (cvs, sentiment, complexity, …) should be disregarded.
 */
function buildRawScoredIssue(
  raw: ExtendedIssue,
  health: RepoHealth,
  scored_at: string
): ScoredIssue {
  return {
    ...raw,
    body: raw.body ?? raw.bodyPreview,
    cvs: 0,
    cvsTier: 'skip',
    lifecycleStage: 'fresh',
    claimStatus: 'unclaimed',
    claimAuthor: null,
    complexity: 'medium',
    sentimentScore: 0,
    sentimentSignals: [],
    commentDigest: null,
    contentQualityScore: 0,
    competitionLevel: 'none',
    repoSlug: health.slug,
    dataCompleteness: 'raw',
    repoKilled: health.killed === true,
    likelyFiles: [],
    relatedIssues: [],
    _scoring: {
      scored_at,
      data_completeness: 'raw',
      signals_used: [],
      signals_available: []
    }
  }
}

function slimIssue(issue: ScoredIssue) {
  const {
    body: _body,
    reactionGroups: _rg,
    sentimentSignals: _ss,
    commentDigest: _cd,
    likelyFiles: _lf,
    relatedIssues: _ri,
    _scoring,
    difficultySignals: _ds,
    bodyPreview: _bp,
    linkedPrUrls: _lp,
    assignees: _as,
    ...slim
  } = issue
  return slim
}

const VALID_SORT_FIELDS = new Set([
  'cvs',
  'title',
  'repo',
  'lifecycle',
  'complexity',
  'sentiment',
  'competition',
  'createdAt'
])

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
        description: 'Issue not found in the scored set for this repo',
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
      const merged = consolidated?.mergedPrs ?? []
      const rejected = consolidated?.rejectedPrs ?? []

      // Find the specific issue in the scored set first.
      let issue = scored.find(i => i.id === issueId)

      // Fallback: brief composition is not logically tied to the scored window.
      // If the scraper has raw data for this issue, serve a brief composed from
      // raw + repo-level health/meta, marked dataCompleteness: 'raw' so
      // consumers can distinguish it from a fully-scored issue.
      if (!issue) {
        const raw = consolidated?.issues?.find(i => i.id === issueId)
        if (!raw) {
          return c.json({ success: false as const, error: `issue not found: ${issueId}` }, 404)
        }
        const rawScoredAt = consolidated?.scrapedAt ?? new Date().toISOString()
        const rawBase = buildRawScoredIssue(raw, healthEnvelope.data, rawScoredAt)
        issue = applyClaimOverlay([rawBase], claims ?? [])[0]
        const brief = formatIssueBrief(issue, healthEnvelope.data, meta, merged, rejected)
        const readiness = computeDispatchReadiness(issue)
        return c.json(
          {
            success: true as const,
            data: {
              issue,
              repoHealth: healthEnvelope.data,
              brief,
              dispatchReadinessScore: readiness.score,
              dispatchReadinessFlags: readiness.flags
            },
            _meta: buildScrapedOnlyMeta(consolidated?.scrapedAt ?? null)
          },
          200
        )
      }

      // Ensure body is populated for issue-brief consumers (fallback to bodyPreview)
      if (!issue.body) {
        issue.body = issue.bodyPreview
      }

      const brief = formatIssueBrief(issue, healthEnvelope.data, meta, merged, rejected)
      const readiness = computeDispatchReadiness(issue)

      return c.json(
        {
          success: true as const,
          data: {
            issue,
            repoHealth: healthEnvelope.data,
            brief,
            dispatchReadinessScore: readiness.score,
            dispatchReadinessFlags: readiness.flags
          },
          _meta: buildMeta(scoredEnvelope)
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // POST /:slug/compose-brief
  const composeBriefRoute = createRoute({
    method: 'post',
    path: '/{slug}/compose-brief',
    tags: ['Recon - Issues'],
    summary: 'Compose an issue brief from a caller-supplied issue snapshot',
    description:
      'Composes a brief from an externally-supplied raw issue plus live repo health/meta. Intended for consumers that snapshot an issue at selection time and need to generate the brief later, after the issue has aged out of the current scored window and the consolidated scraper blob.',
    request: {
      params: slugParam,
      body: {
        content: { 'application/json': { schema: ComposeBriefRequestSchema } }
      }
    },
    responses: {
      200: {
        description: 'Composed brief with live repo health/meta',
        content: {
          'application/json': {
            schema: z.union([IssueBriefResponseSchema, PendingResponseSchema])
          }
        }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(composeBriefRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const { issue: rawIssue } = c.req.valid('json')

      const [healthEnvelope, consolidated, claims] = await Promise.all([
        getRepoHealthEnveloped(kv, slug),
        getConsolidatedRecon(kv, slug),
        getClaims(kv, slug)
      ])

      const meta = consolidated?.repoMeta ?? null
      if (!healthEnvelope || !meta) {
        return c.json({ success: true as const, data: { status: 'pending' as const } }, 200)
      }

      const merged = consolidated?.mergedPrs ?? []
      const rejected = consolidated?.rejectedPrs ?? []
      const scoredAt = new Date().toISOString()
      const rawBase = buildRawScoredIssue(rawIssue, healthEnvelope.data, scoredAt)
      const [issue] = applyClaimOverlay([rawBase], claims ?? [])
      const brief = formatIssueBrief(issue, healthEnvelope.data, meta, merged, rejected)
      const readiness = computeDispatchReadiness(issue)

      return c.json(
        {
          success: true as const,
          data: {
            issue,
            repoHealth: healthEnvelope.data,
            brief,
            dispatchReadinessScore: readiness.score,
            dispatchReadinessFlags: readiness.flags
          },
          _meta: buildScrapedOnlyMeta(consolidated?.scrapedAt ?? null)
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
    description:
      'Returns scored issues across all scraped repos. Supports pagination via sort/dir/offset/limit query params. When limit is omitted, returns all issues (backward compat).',
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
      const url = new URL(c.req.url)
      const sortParam = url.searchParams.get('sort') ?? 'cvs'
      const dirParam = url.searchParams.get('dir') ?? 'desc'
      const offsetParam = url.searchParams.get('offset')
      const limitParam = url.searchParams.get('limit')
      const includeKilled = url.searchParams.get('includeKilled') === 'true'

      const sort = VALID_SORT_FIELDS.has(sortParam) ? sortParam : 'cvs'
      const dir = dirParam === 'asc' ? 'asc' : 'desc'
      const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0
      const limit = limitParam ? Math.min(500, Math.max(1, parseInt(limitParam, 10) || 100)) : null
      const isPaginated = limitParam !== null

      // Try pre-aggregated KV key first (fast path: 1 KV read)
      const aggregateIssues = await getAggregate(kv, sort)

      if (aggregateIssues) {
        const versionMeta = await getAggregateVersion(kv)

        // Apply direction, then killed filter. Count/repoCount reflect the
        // filtered set so UI paginators don't show phantom pages.
        const ordered = dir === 'desc' ? [...aggregateIssues].reverse() : aggregateIssues
        const filtered = includeKilled ? ordered : ordered.filter(i => !i.repoKilled)
        const totalCount = filtered.length
        const repoCount = includeKilled
          ? (versionMeta?.repoCount ?? 0)
          : new Set(filtered.map(i => i.repoSlug)).size

        if (isPaginated && limit !== null) {
          const page = filtered.slice(offset, offset + limit)
          const hasMore = offset + limit < totalCount

          c.header('Cache-Control', 'public, max-age=120, stale-while-revalidate=300')
          return c.json(
            {
              success: true as const,
              data: { issues: page, totalCount, repoCount, hasMore, offset },
              _meta: {
                scraped_at: null,
                computed_at: versionMeta ? new Date(versionMeta.version).toISOString() : null,
                served_at: new Date().toISOString()
              }
            },
            200
          )
        }

        // No limit — return all (backward compat)
        c.header('Cache-Control', 'public, max-age=120, stale-while-revalidate=300')
        return c.json(
          {
            success: true as const,
            data: { issues: filtered, totalCount, repoCount },
            _meta: {
              scraped_at: null,
              computed_at: versionMeta ? new Date(versionMeta.version).toISOString() : null,
              served_at: new Date().toISOString()
            }
          },
          200
        )
      }

      // Fallback: N+1 KV reads (pre-aggregate keys not yet built)
      // Build aggregates in background so the next request gets the fast path
      const slugs = await getScrapedSlugs(kv)
      c.executionCtx.waitUntil(buildAndWriteAggregates(kv, slugs))

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
      const allIssuesRaw = validEnvelopes.flatMap(e => e.issues.map(slimIssue))
      const allIssues = includeKilled ? allIssuesRaw : allIssuesRaw.filter(i => !i.repoKilled)

      // Sort by requested field and direction
      const cmp = sortComparator(sort as AggregateSortField)
      allIssues.sort(cmp)
      if (dir === 'desc') allIssues.reverse()

      const scrapedAts = validEnvelopes
        .map(e => e.scraped_at)
        .filter((s): s is string => s !== null)
      const computedAts = validEnvelopes.map(e => e.computed_at).filter((s): s is string => !!s)

      const oldestScraped = scrapedAts.length > 0 ? scrapedAts.sort()[0] : null
      const oldestComputed = computedAts.length > 0 ? computedAts.sort()[0] : null

      const fallbackMeta = {
        scraped_at: oldestScraped,
        computed_at: oldestComputed,
        served_at: new Date().toISOString()
      }

      const repoCount = includeKilled ? slugs.length : new Set(allIssues.map(i => i.repoSlug)).size

      if (isPaginated && limit !== null) {
        const page = allIssues.slice(offset, offset + limit)
        const hasMore = offset + limit < allIssues.length

        return c.json(
          {
            success: true as const,
            data: {
              issues: page,
              totalCount: allIssues.length,
              repoCount,
              hasMore,
              offset
            },
            _meta: fallbackMeta
          },
          200
        )
      }

      return c.json(
        {
          success: true as const,
          data: {
            issues: allIssues,
            totalCount: allIssues.length,
            repoCount
          },
          _meta: fallbackMeta
        },
        200
      )
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // GET /all-scored-issues/version
  const aggregateVersionRoute = createRoute({
    method: 'get',
    path: '/all-scored-issues/version',
    tags: ['Recon - Issues'],
    summary: 'Get aggregate version metadata',
    description: 'Returns version timestamp and counts for the pre-aggregated issue data.',
    responses: {
      200: {
        description: 'Aggregate version metadata',
        content: { 'application/json': { schema: AggregateVersionResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(aggregateVersionRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const versionMeta = await getAggregateVersion(kv)
      if (!versionMeta) {
        return c.json(
          {
            success: true as const,
            data: { version: 0, repoCount: 0, totalCount: 0, projects: [] }
          },
          200
        )
      }

      return c.json({ success: true as const, data: versionMeta }, 200)
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })
}
