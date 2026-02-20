/**
 * Data source abstraction layer.
 *
 * This module defines the interface that any issue data provider must implement.
 * Currently uses live API adapters; will be swapped for hadoku-scraper calls.
 */

import type { Issue, ProjectConfig, OSSEnv } from '../types'

/**
 * A data provider fetches issues for a given project configuration.
 * Implementations can fetch live from APIs, read from a scraper service, or use cached data.
 */
export interface IssueDataProvider {
  /**
   * Fetch issues for a single project.
   * @returns Normalized Issue[] ready for the API response.
   */
  fetchIssues(config: ProjectConfig, env: OSSEnv): Promise<Issue[]>
}
