/**
 * App-specific preferences for the OSS aggregator: filter/sort/view state and
 * the selected-projects list. Persisted through @wolffm/prefs-client (→ the
 * D1-backed prefs-api) under this app's own appId 'aggregator', device scope
 * (filters differ naturally per device). Theme is separate — it's
 * platform-global and lives in themePrefs.ts under appId 'portfolio'.
 *
 * Replaces the prior raw-localStorage keys 'oss-aggregator-filters' and
 * 'oss-aggregator-selected-projects', which are one-shot migrated into the
 * prefs store on first load (see migrateLegacyOnce) then deleted.
 */
import { z } from 'zod'
import { createPrefsClient } from '@wolffm/prefs-client'

const LEGACY_FILTERS_KEY = 'oss-aggregator-filters'
const LEGACY_PROJECTS_KEY = 'oss-aggregator-selected-projects'

// Filter fields are app-controlled enums; kept as string arrays here so the
// schema doesn't have to track every union member. No passthrough — that would
// add an index signature incompatible with the app's concrete IssueFilters type.
const IssueFiltersSchema = z.object({
  tiers: z.array(z.string()).optional(),
  lifecycleStages: z.array(z.string()).optional(),
  complexities: z.array(z.string()).optional(),
  claimStatuses: z.array(z.string()).optional(),
  competitionLevels: z.array(z.string()).optional(),
  minCvs: z.number().optional(),
  includeKilled: z.boolean().optional()
})

export const AggregatorPrefsSchema = z.object({
  viewMode: z.enum(['table', 'cards']).optional(),
  sortField: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  filters: IssueFiltersSchema.optional(),
  selectedProjects: z.array(z.string()).optional()
})

export type AggregatorPrefs = z.infer<typeof AggregatorPrefsSchema>

export const aggregatorPrefs = createPrefsClient({
  appId: 'aggregator',
  schema: AggregatorPrefsSchema,
  defaults: {}
})

let migrationPromise: Promise<void> | null = null

async function doMigrate(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const patch: Partial<AggregatorPrefs> = {}

    const filtersRaw = window.localStorage.getItem(LEGACY_FILTERS_KEY)
    if (filtersRaw) {
      const parsed = JSON.parse(filtersRaw) as Partial<AggregatorPrefs>
      if (parsed.viewMode) patch.viewMode = parsed.viewMode
      if (parsed.sortField) patch.sortField = parsed.sortField
      if (parsed.sortDirection) patch.sortDirection = parsed.sortDirection
      if (parsed.filters) patch.filters = parsed.filters
    }

    const projectsRaw = window.localStorage.getItem(LEGACY_PROJECTS_KEY)
    if (projectsRaw) {
      const arr: unknown = JSON.parse(projectsRaw)
      if (Array.isArray(arr) && arr.every(s => typeof s === 'string')) {
        patch.selectedProjects = arr
      }
    }

    if (Object.keys(patch).length > 0) {
      // Only delete the legacy keys after a successful save, so a failed
      // migration retries on the next page load instead of losing data.
      await aggregatorPrefs.save(patch, { scope: 'device' })
    }
    window.localStorage.removeItem(LEGACY_FILTERS_KEY)
    window.localStorage.removeItem(LEGACY_PROJECTS_KEY)
  } catch {
    // Non-fatal: leave legacy keys in place; next load retries. Reset the
    // memo so a later caller actually re-attempts.
    migrationPromise = null
  }
}

/** Run the one-shot legacy-localStorage migration at most once per page load. */
function migrateLegacyOnce(): Promise<void> {
  if (!migrationPromise) migrationPromise = doMigrate()
  return migrationPromise
}

/** Migrate legacy localStorage (once), then return the merged prefs blob. */
export async function loadAggregatorPrefs(): Promise<AggregatorPrefs> {
  await migrateLegacyOnce()
  return aggregatorPrefs.read()
}

/** Fire-and-forget save of a prefs slice (device scope, SDK-debounced). */
export function saveAggregatorPrefs(patch: Partial<AggregatorPrefs>): void {
  void aggregatorPrefs.save(patch, { scope: 'device' })
}
