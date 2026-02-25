/**
 * Claim Routes
 */

import { type OpenAPIHono, createRoute } from '@hono/zod-openapi'
import {
  type HonoEnv,
  getErrorMessage,
  requireKV,
  ErrorResponseSchema,
  ClaimRequestSchema,
  UnclaimRequestSchema,
  ClaimResponseSchema,
  UnclaimResponseSchema,
  slugParam
} from './route-helpers'
import { addClaim, removeClaim } from './claims'

export function registerClaimRoutes(app: OpenAPIHono<HonoEnv>) {
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
}
