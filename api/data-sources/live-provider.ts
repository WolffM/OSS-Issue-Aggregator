/**
 * Live API provider — fetches issues directly from upstream platform APIs.
 *
 * This is the current implementation that makes real-time API calls to
 * GitHub, GitLab, Gitea, Phabricator, Bugzilla, and Trac.
 *
 * Will be replaced by a scraper-backed provider once hadoku-scraper is ready.
 */

import type { Issue, ProjectConfig, OSSEnv, CachedIssues } from '../types'
import type { IssueDataProvider } from './types'
import { fetchGitHubIssues } from '../adapters/github'
import { fetchGitLabIssues } from '../adapters/gitlab'
import { fetchGiteaIssues } from '../adapters/gitea'
import { fetchPhabricatorIssues } from '../adapters/phabricator'
import { fetchBugzillaIssues } from '../adapters/bugzilla'
import { fetchTracIssues } from '../adapters/trac'

/**
 * Try to get cached issues from KV for blocked platforms (bugzilla, trac).
 * These sites block Cloudflare Worker IPs, so we cache data via GitHub Actions.
 */
async function getCachedIssues(slug: string, env: OSSEnv): Promise<Issue[] | null> {
  if (!env.CACHE_KV) return null

  try {
    const cached = await env.CACHE_KV.get<CachedIssues>(`cached:${slug}`, 'json')
    if (cached?.issues) {
      console.log(`Using cached data for ${slug} (cached at ${cached.cachedAt})`)
      return cached.issues
    }
  } catch (err) {
    console.error(`Failed to read cache for ${slug}:`, err)
  }

  return null
}

export class LiveApiProvider implements IssueDataProvider {
  async fetchIssues(config: ProjectConfig, env: OSSEnv): Promise<Issue[]> {
    switch (config.platform) {
      case 'github':
        return fetchGitHubIssues(config, env.GITHUB_TOKEN)

      case 'gitlab':
        return fetchGitLabIssues(config)

      case 'gitea':
        return fetchGiteaIssues(config)

      case 'phabricator':
        if (!env.PHABRICATOR_TOKEN) {
          throw new Error('PHABRICATOR_TOKEN is required for Phabricator API')
        }
        return fetchPhabricatorIssues(config, env.PHABRICATOR_TOKEN)

      case 'bugzilla': {
        const cached = await getCachedIssues(config.slug, env)
        if (cached) return cached
        return fetchBugzillaIssues(config)
      }

      case 'trac': {
        const cached = await getCachedIssues(config.slug, env)
        if (cached) return cached
        return fetchTracIssues(config)
      }

      default: {
        const _exhaustiveCheck: never = config.platform
        throw new Error(`Unknown platform: ${String(_exhaustiveCheck)}`)
      }
    }
  }
}
