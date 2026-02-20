/**
 * Data Sources Module
 *
 * Clean abstraction layer for fetching issue data.
 * Swap providers here to change the data source for the entire API.
 */

export type { IssueDataProvider } from './types'
export { LiveApiProvider } from './live-provider'
export { CachedProvider } from './cached-provider'

import type { IssueDataProvider } from './types'
import { CachedProvider } from './cached-provider'

/**
 * Create the active data provider.
 *
 * Returns the cached KV provider backed by hadoku-scraper.
 * To fall back to live API calls, swap this to return new LiveApiProvider().
 */
export function createDataProvider(): IssueDataProvider {
  return new CachedProvider()
}
