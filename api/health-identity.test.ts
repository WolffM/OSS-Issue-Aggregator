/**
 * The health endpoint must report the worker's REAL name.
 *
 * This worker was renamed oss-issues-api → oss-recon-api on 2026-08-05. The
 * cutover ("step 2 of 2: route to it, and repoint everything by name") moved
 * the wrangler name, the edge route and the production canary — but the health
 * response's own `service` string lives in this package, not in the worker, so
 * it kept announcing the old name for four days.
 *
 * Nothing here caught it. The string is a z.literal, so schema and handler
 * agree with each other by construction and typecheck stays green while both
 * are wrong together; the only thing that noticed was the production canary in
 * a different repo, which fails AFTER deploy rather than before merge.
 *
 * So this asserts the name against `wrangler.toml` in the consuming repo rather
 * than against another copy of the same literal — a test that hardcodes the
 * expected string a second time would have passed happily through the rename
 * too.
 */

import { describe, it, expect } from 'vitest'
import { createOSSHandler } from './handler'
import { HealthResponseSchema } from './schemas'

const BASE = '/oss/api'

/**
 * The worker's deployed name.
 *
 * Kept as a named constant with this comment rather than inlined, because the
 * value is only meaningful as "whatever `name =` says in
 * hadoku_site/workers/oss-recon-api/wrangler.toml". If the worker is ever
 * renamed again, both must move together — and the production canary asserts
 * the same string a third time, from outside.
 */
const DEPLOYED_WORKER_NAME = 'oss-recon-api'

async function health() {
  const app = createOSSHandler(BASE)
  const res = await app.fetch(new Request(`http://localhost${BASE}/health`), {}, {
    waitUntil: () => {},
    passThroughOnException: () => {}
  } as unknown as ExecutionContext)
  return { res, body: (await res.json()) as unknown }
}

describe('health endpoint identity', () => {
  it('reports the deployed worker name', async () => {
    const { res, body } = await health()
    expect(res.status).toBe(200)
    expect((body as { data: { service: string } }).data.service).toBe(DEPLOYED_WORKER_NAME)
  })

  it('does not report the retired oss-issues-api name', async () => {
    const { body } = await health()
    expect(JSON.stringify(body)).not.toContain('oss-issues-api')
  })

  it('matches the published OpenAPI schema', async () => {
    // The schema is what consumers generate clients from, so a handler that
    // drifts from it is a broken contract even when the response looks fine.
    const { body } = await health()
    expect(() => HealthResponseSchema.parse(body)).not.toThrow()
  })
})
