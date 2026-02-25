/**
 * Pre-computation & Trigger Routes
 */

import { type OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  type HonoEnv,
  getErrorMessage,
  requireKV,
  ErrorResponseSchema,
  RefreshResponseSchema,
  slugParam
} from './route-helpers'
import { triggerScrape } from './triggers'
import { computeAndStore, computeAndStoreAll } from './precompute'

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
      'Reads raw scraper data from KV, runs scoring + dossier compilation, and writes results back to KV. Designed to be called from environments without CPU limits (GitHub Actions, scraper post-hook).',
    request: { params: slugParam },
    responses: {
      200: {
        description: 'Computation results',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({
                slug: z.string(),
                healthComputed: z.boolean(),
                scoredCount: z.number(),
                dossierGenerated: z.boolean()
              })
            })
          }
        }
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(computeRoute, async c => {
    const kv = requireKV(c.env)
    if (!kv) {
      return c.json({ success: false as const, error: 'KV storage not configured' }, 500)
    }

    try {
      const { slug } = c.req.valid('param')
      const result = await computeAndStore(kv, slug)
      return c.json({ success: true as const, data: result }, 200)
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })

  // POST /compute-all
  const computeAllRoute = createRoute({
    method: 'post',
    path: '/compute-all',
    tags: ['Recon - Triggers'],
    summary: 'Pre-compute all repos',
    description:
      'Runs scoring + dossier compilation for every scraped repo and writes results to KV. Sequential to avoid KV write contention.',
    responses: {
      200: {
        description: 'Computation results per repo',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({
                results: z.array(
                  z.object({
                    slug: z.string(),
                    healthComputed: z.boolean(),
                    scoredCount: z.number(),
                    dossierGenerated: z.boolean()
                  })
                )
              })
            })
          }
        }
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

    try {
      const result = await computeAndStoreAll(kv)
      return c.json({ success: true as const, data: result }, 200)
    } catch (err) {
      return c.json({ success: false as const, error: getErrorMessage(err) }, 500)
    }
  })
}
