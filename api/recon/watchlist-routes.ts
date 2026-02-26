/**
 * Watchlist Routes
 */

import { type OpenAPIHono, createRoute } from '@hono/zod-openapi'
import {
  type HonoEnv,
  getErrorMessage,
  requireKV,
  ErrorResponseSchema,
  SlugBodySchema,
  WatchlistResponseSchema,
  WatchlistAddResponseSchema,
  WatchlistRemoveResponseSchema,
  buildServedOnlyMeta
} from './route-helpers'
import { getWatchlist, addToWatchlist, removeFromWatchlist } from './watchlist'
import { triggerScrape } from './triggers'

export function registerWatchlistRoutes(app: OpenAPIHono<HonoEnv>) {
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
    return c.json({ success: true as const, data: { slugs }, _meta: buildServedOnlyMeta() }, 200)
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

      return c.json({ success: true as const, data: result, _meta: buildServedOnlyMeta() }, 200)
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
    return c.json({ success: true as const, data: result, _meta: buildServedOnlyMeta() }, 200)
  })
}
