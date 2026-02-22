import { useState, useCallback, useMemo, useEffect } from 'react'
import type {
  ScoredIssue,
  CVSTier,
  LifecycleStage,
  Complexity,
  CompetitionLevel,
  ClaimStatus
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

const STORAGE_KEY = 'oss-aggregator-filters'

const DEFAULT_FILTERS: IssueFilters = {
  tiers: [],
  lifecycleStages: [],
  complexities: [],
  claimStatuses: [],
  competitionLevels: [],
  minCvs: 0,
  includeKilled: false
}

interface PersistedState {
  viewMode: 'table' | 'cards'
  sortField: SortField
  sortDirection: 'asc' | 'desc'
  filters: IssueFilters
}

function loadPersistedState(): PersistedState | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      return JSON.parse(saved) as PersistedState
    }
  } catch {
    // Ignore parse errors
  }
  return null
}

function savePersistedState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage errors
  }
}

const LIFECYCLE_ORDER: Record<LifecycleStage, number> = {
  fresh: 0,
  triaged: 1,
  accepted: 2,
  stale: 3,
  zombie: 4
}

const COMPLEXITY_ORDER: Record<Complexity, number> = {
  low: 0,
  medium: 1,
  high: 2
}

const COMPETITION_ORDER: Record<CompetitionLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3
}

export function useIssueFilters(): UseIssueFiltersResult {
  const persisted = useMemo(() => loadPersistedState(), [])

  const [filters, setFilters] = useState<IssueFilters>(persisted?.filters ?? DEFAULT_FILTERS)
  const [sortField, setSortField] = useState<SortField>(persisted?.sortField ?? 'cvs')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(
    persisted?.sortDirection ?? 'desc'
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(persisted?.viewMode ?? 'table')

  // Persist state changes
  useEffect(() => {
    savePersistedState({ viewMode, sortField, sortDirection, filters })
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

      // Sort
      result = [...result].sort((a, b) => {
        let cmp = 0
        switch (sortField) {
          case 'cvs':
            cmp = a.cvs - b.cvs
            break
          case 'title':
            cmp = a.title.localeCompare(b.title)
            break
          case 'repo':
            cmp = a.repoSlug.localeCompare(b.repoSlug)
            break
          case 'lifecycle':
            cmp = LIFECYCLE_ORDER[a.lifecycleStage] - LIFECYCLE_ORDER[b.lifecycleStage]
            break
          case 'complexity':
            cmp = COMPLEXITY_ORDER[a.complexity] - COMPLEXITY_ORDER[b.complexity]
            break
          case 'sentiment':
            cmp = a.sentimentScore - b.sentimentScore
            break
          case 'competition':
            cmp = COMPETITION_ORDER[a.competitionLevel] - COMPETITION_ORDER[b.competitionLevel]
            break
          case 'createdAt':
            cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            break
        }
        return sortDirection === 'asc' ? cmp : -cmp
      })

      return result
    },
    [filters, searchQuery, sortField, sortDirection]
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
