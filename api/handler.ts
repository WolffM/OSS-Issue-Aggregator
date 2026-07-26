/**
 * OSS Issues API Handler Factory
 *
 * Creates a Hono OpenAPI handler that can be mounted in a Cloudflare Worker.
 * This follows the same pattern as @wolffm/trader-worker's createTraderHandler.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { createEdgeAuth, requireMinTier } from '@wolffm/worker-utils'
import type { OSSEnv } from './types'
import { createReconRoutes } from './recon'
import { HealthResponseSchema } from './schemas'

interface HonoEnv {
  Bindings: OSSEnv
}

/**
 * Creates a Hono OpenAPI app for the OSS Issues API.
 * Mount this at your desired base path (e.g., '/oss/api').
 *
 * @param basePath - The base path for all routes (default: '/oss/api')
 * @returns A Hono app that handles all OSS Issues API routes
 *
 * @example
 * ```typescript
 * import { createOSSHandler } from '@wolffm/hadoku-aggregator/api';
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

  // Adopt the edge-resolved tier, but only when X-Edge-Auth proves the request
  // came through edge-router (which strips client-supplied copies first). A
  // direct *.workers.dev hit carries no secret, so it degrades to `public`.
  app.use('*', createEdgeAuth())

  // Reads are public (this is a public-facing OSS-triage surface). Writes —
  // recompute, scrape-complete webhook, claim/unclaim — are not: gate every
  // mutating method at friend and up. Tiers rank (public < friend < service <
  // admin), so the scraper's own scrape-complete + compute calls (X-User-Key =
  // its service key) pass by outranking friend, without being listed.
  // Origin bypass and forged tiers land as `public` here and get 403'd. GET /
  // HEAD stay public and OPTIONS is left to the CORS middleware above.
  app.on(['POST', 'PUT', 'PATCH', 'DELETE'], '*', requireMinTier('friend'))

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

  // Recon Pipeline Routes
  app.route('/recon', createReconRoutes())

  // OpenAPI Spec
  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'OSS Issues Aggregator API',
      version: '3.0.0',
      description: `
Aggregates and scores open source issues for contribution viability.

All project data is dynamically discovered from Cloudflare KV (scraped by hadoku-scraper).

## Recon Pipeline
- Scraper populates KV → aggregator scores issues
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
      { name: 'Recon - Issues', description: 'Per-repo issue and health data from recon pipeline' },
      { name: 'Recon - Claims', description: 'Issue claim tracking' },
      { name: 'Recon - Triggers', description: 'Scraper trigger endpoints' }
    ]
  })

  return app
}
