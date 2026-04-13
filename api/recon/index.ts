/**
 * Recon Pipeline Routes
 *
 * Hono OpenAPI sub-app for the OSS recon pipeline.
 * Mounted at /oss/api/recon/* by handler.ts.
 */

import { OpenAPIHono } from '@hono/zod-openapi'
import type { HonoEnv } from './route-helpers'
import { registerIssueRoutes } from './issue-routes'
import { registerClaimRoutes } from './claim-routes'
import { registerComputeRoutes } from './compute-routes'
import { registerCrimsonKittyRoutes } from './crimson-kitty-routes'

export function createReconRoutes() {
  const app = new OpenAPIHono<HonoEnv>()

  registerIssueRoutes(app)
  registerClaimRoutes(app)
  registerComputeRoutes(app)
  registerCrimsonKittyRoutes(app)

  return app
}
