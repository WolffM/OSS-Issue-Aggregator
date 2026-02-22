import { useState, useEffect, useCallback, useRef } from 'react'
import { logger } from '@wolffm/task-ui-components'
import { ossIssuesClient } from '../api/client'
import type { ScoredIssue } from '../api/types'

interface UseAllScoredIssuesResult {
  issues: ScoredIssue[]
  isLoading: boolean
  error: string | null
  totalCount: number
  repoCount: number
  lastFetched: Date | null
  refetch: () => Promise<void>
}

interface CacheEntry {
  issues: ScoredIssue[]
  totalCount: number
  repoCount: number
  timestamp: number
}

const CACHE_MAX_AGE = 4 * 60 * 1000

const cache = new Map<string, CacheEntry>()

function isCacheFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_MAX_AGE
}

export function useAllScoredIssues(includeKilled = false): UseAllScoredIssuesResult {
  const [issues, setIssues] = useState<ScoredIssue[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [repoCount, setRepoCount] = useState(0)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  const includeKilledRef = useRef(includeKilled)
  includeKilledRef.current = includeKilled

  const fetchIssues = useCallback(
    async (forceRefresh = false) => {
      const cacheKey = `all-scored-${includeKilled}`

      if (!forceRefresh) {
        const cached = cache.get(cacheKey)
        if (cached && isCacheFresh(cached)) {
          setIssues(cached.issues)
          setTotalCount(cached.totalCount)
          setRepoCount(cached.repoCount)
          setLastFetched(new Date(cached.timestamp))
          setIsLoading(false)
          logger.info('[useAllScoredIssues] Using cached data', {
            issueCount: cached.totalCount
          })
          return
        }
      }

      setIsLoading(true)
      setError(null)

      try {
        const response = await ossIssuesClient.getAllScoredIssues(includeKilled)

        if (includeKilledRef.current === includeKilled) {
          const now = Date.now()
          setIssues(response.data.issues)
          setTotalCount(response.data.totalCount)
          setRepoCount(response.data.repoCount)
          setLastFetched(new Date(now))

          cache.set(cacheKey, {
            issues: response.data.issues,
            totalCount: response.data.totalCount,
            repoCount: response.data.repoCount,
            timestamp: now
          })

          logger.info('[useAllScoredIssues] Fetched scored issues', {
            totalCount: response.data.totalCount,
            repoCount: response.data.repoCount
          })
        }
      } catch (err) {
        if (includeKilledRef.current === includeKilled) {
          const message = err instanceof Error ? err.message : 'Failed to fetch scored issues'
          setError(message)
          logger.error('[useAllScoredIssues] Failed to fetch', { error: String(err) })
        }
      } finally {
        if (includeKilledRef.current === includeKilled) {
          setIsLoading(false)
        }
      }
    },
    [includeKilled]
  )

  useEffect(() => {
    void fetchIssues()
  }, [fetchIssues])

  const refetch = useCallback(async () => {
    await fetchIssues(true)
  }, [fetchIssues])

  return {
    issues,
    isLoading,
    error,
    totalCount,
    repoCount,
    lastFetched,
    refetch
  }
}
