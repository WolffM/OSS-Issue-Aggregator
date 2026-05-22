import { useState, useCallback, useEffect, useRef } from 'react'
import { loadAggregatorPrefs, saveAggregatorPrefs } from '../prefs/aggregatorPrefs'
import type {
  ScoredIssue,
  CVSTier,
  LifecycleStage,
  Complexity,
  ClaimStatus,
  CompetitionLevel
} from '../api/types'

export type SortField =
  | 'cvs'
  | 'title'
  | 'repo'
  | 'lifecycle'
  | 'complexity'
  | 'sentiment'
  | 'competition'
  | 'createdAt'

export interface IssueFilters {
  tiers: CVSTier[]
  lifecycleStages: LifecycleStage[]
  complexities: Complexity[]
  claimStatuses: ClaimStatus[]
  competitionLevels: CompetitionLevel[]
  minCvs: number
  includeKilled: boolean
}

interface UseIssueFiltersResult {
  filters: IssueFilters
  setFilters: (filters: IssueFilters) => void
  sortField: SortField
  sortDirection: 'asc' | 'desc'
  setSort: (field: SortField) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  viewMode: 'table' | 'cards'
  setViewMode: (mode: 'table' | 'cards') => void
  applyFiltersAndSort: (issues: ScoredIssue[]) => ScoredIssue[]
}

const DEFAULT_FILTERS: IssueFilters = {
  tiers: [],
  lifecycleStages: [],
  complexities: [],
  claimStatuses: [],
  competitionLevels: [],
  minCvs: 0,
  includeKilled: false
}

export function useIssueFilters(): UseIssueFiltersResult {
  const [filters, setFilters] = useState<IssueFilters>(DEFAULT_FILTERS)
  const [sortField, setSortField] = useState<SortField>('cvs')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table')

  // Hydrate from the unified prefs store (async). Until this resolves we hold
  // the defaults above and suppress saving so we don't overwrite stored prefs
  // with defaults on first render.
  const hydratedRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    void loadAggregatorPrefs().then(prefs => {
      if (cancelled) return
      if (prefs.filters) setFilters({ ...DEFAULT_FILTERS, ...(prefs.filters as IssueFilters) })
      if (prefs.sortField) setSortField(prefs.sortField as SortField)
      if (prefs.sortDirection) setSortDirection(prefs.sortDirection)
      if (prefs.viewMode) setViewMode(prefs.viewMode)
      hydratedRef.current = true
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Persist state changes (device scope). Skipped until hydration completes.
  useEffect(() => {
    if (!hydratedRef.current) return
    saveAggregatorPrefs({ viewMode, sortField, sortDirection, filters })
  }, [viewMode, sortField, sortDirection, filters])

  const setSort = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortField(field)
        setSortDirection(field === 'cvs' ? 'desc' : 'asc')
      }
    },
    [sortField]
  )

  const applyFiltersAndSort = useCallback(
    (issues: ScoredIssue[]): ScoredIssue[] => {
      let result = issues

      // Filter by tiers
      if (filters.tiers.length > 0) {
        result = result.filter(i => filters.tiers.includes(i.cvsTier))
      }

      // Filter by lifecycle stages
      if (filters.lifecycleStages.length > 0) {
        result = result.filter(i => filters.lifecycleStages.includes(i.lifecycleStage))
      }

      // Filter by complexities
      if (filters.complexities.length > 0) {
        result = result.filter(i => filters.complexities.includes(i.complexity))
      }

      // Filter by claim statuses
      if (filters.claimStatuses.length > 0) {
        result = result.filter(i => filters.claimStatuses.includes(i.claimStatus))
      }

      // Filter by competition levels
      if (filters.competitionLevels.length > 0) {
        result = result.filter(i => filters.competitionLevels.includes(i.competitionLevel))
      }

      // Filter by min CVS
      if (filters.minCvs > 0) {
        result = result.filter(i => i.cvs >= filters.minCvs)
      }

      // Filter killed
      if (!filters.includeKilled) {
        result = result.filter(i => !i.repoKilled)
      }

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        result = result.filter(
          i =>
            i.title.toLowerCase().includes(q) ||
            i.repoSlug.toLowerCase().includes(q) ||
            i.project.toLowerCase().includes(q)
        )
      }

      return result
    },
    [filters, searchQuery]
  )

  return {
    filters,
    setFilters,
    sortField,
    sortDirection,
    setSort,
    searchQuery,
    setSearchQuery,
    viewMode,
    setViewMode,
    applyFiltersAndSort
  }
}
