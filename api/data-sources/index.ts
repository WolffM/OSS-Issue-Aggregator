/**
 * Data Sources Module
 *
 * Clean abstraction layer for fetching issue data.
 * Swap providers here to change the data source for the entire API.
 */

export type { IssueDataProvider } from './types'
export { LiveApiProvider } from './live-provider'

import type { IssueDataProvider } from './types'
import { LiveApiProvider } from './live-provider'

/**
 * Create the active data provider.
 *
 * Currently returns the live API provider.
 * When hadoku-scraper is ready, swap this to return a ScraperProvider instead.
 */
export function createDataProvider(): IssueDataProvider {
  return new LiveApiProvider()
}
