/**
 * Pre-computation & Trigger Routes
 */

import { type OpenAPIHono, createRoute } from '@hono/zod-openapi'
import {
  type HonoEnv,
  requireKV,
  ErrorResponseSchema,
  RefreshResponseSchema,
  AcceptedResponseSchema,
  slugParam
} from './route-helpers'
import { triggerScrape } from './triggers'
import { computeAndStore, computeAndStoreAll, buildAndWriteAggregates } from './precompute'
import { getScrapedSlugs } from './kv-reader'

export function registerComputeRoutes(app: OpenAPIHono<HonoEnv>) {
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

  // POST /:slug/compute
  const computeRoute = createRoute({
    method: 'post',
    path: '/{slug}/compute',
    tags: ['Recon - Triggers'],
    summary: 'Pre-compute scored issues, health, and dossier',
    description:
      'Accepts the request and runs scoring + dossier compilation in the background via waitUntil(). Returns 202 immediately.',
    request: { params: slugParam },
    responses: {
      202: {
        description: 'Computation accepted and running in background',
        content: { 'application/json': { schema: AcceptedResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(computeRoute, c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    const { slug } = c.req.valid('param')
    c.executionCtx.waitUntil(computeAndStore(kv, slug))

    return c.json({ success: true as const, message: `Compute started for ${slug}` }, 202)
  })

  // POST /compute-all
  const computeAllRoute = createRoute({
    method: 'post',
    path: '/compute-all',
    tags: ['Recon - Triggers'],
    summary: 'Pre-compute all repos (synchronous)',
    description:
      'Runs scoring + dossier compilation for every scraped repo synchronously. Returns 200 with results when complete.',
    responses: {
      200: {
        description: 'Computation complete',
        content: { 'application/json': { schema: AcceptedResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(computeAllRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    const result = await computeAndStoreAll(kv)

    return c.json(
      { success: true as const, message: `Computed ${result.results.length} repos` },
      200
    )
  })

  // POST /scrape-complete — webhook for scraper/cron to call after scraping finishes
  const scrapeCompleteRoute = createRoute({
    method: 'post',
    path: '/scrape-complete',
    tags: ['Recon - Triggers'],
    summary: 'Scrape completion webhook',
    description:
      'Called by the scraper or cron after scrape-all finishes. Rebuilds pre-sorted aggregate KV keys in the background. Per-repo compute is already handled by the scraper calling /:slug/compute individually.',
    responses: {
      202: {
        description: 'Aggregate rebuild triggered in background',
        content: { 'application/json': { schema: AcceptedResponseSchema } }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(scrapeCompleteRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    const slugs = await getScrapedSlugs(kv)
    c.executionCtx.waitUntil(buildAndWriteAggregates(kv, slugs))

    return c.json(
      { success: true as const, message: 'Scrape-complete received, aggregate rebuild started' },
      202
    )
  })
}
