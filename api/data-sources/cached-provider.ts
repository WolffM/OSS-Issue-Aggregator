/**
 * Cached KV provider — reads pre-scraped issues from Cloudflare KV.
 *
 * The hadoku-scraper writes normalized, pre-scored issues to KV under
 * `cached:{slug}` keys. This provider simply reads them back.
 */

import type { Issue, ProjectConfig, OSSEnv, CachedIssues } from '../types'
import type { IssueDataProvider } from './types'

export class CachedProvider implements IssueDataProvider {
  async fetchIssues(config: ProjectConfig, env: OSSEnv): Promise<Issue[]> {
    if (!env.CACHE_KV) {
      throw new Error('CACHE_KV not configured')
    }

    const cached = await env.CACHE_KV.get<CachedIssues>(`cached:${config.slug}`, 'json')
    return cached?.issues ?? []
  }
}
