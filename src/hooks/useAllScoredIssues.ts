import { useState, useEffect, useCallback, useRef } from 'react'
import { logger } from '@wolffm/task-ui-components'
import { ossIssuesClient } from '../api/client'
import type { ScoredIssue } from '../api/types'

const PAGE_SIZE = 100

interface UseAllScoredIssuesResult {
  issues: ScoredIssue[]
  isLoading: boolean
  isLoadingMore: boolean
  error: string | null
  totalCount: number
  repoCount: number
  lastFetched: Date | null
  hasMore: boolean
  loadMore: () => void
  refetch: () => Promise<void>
}

interface CacheEntry {
  issues: ScoredIssue[]
  totalCount: number
  repoCount: number
  hasMore: boolean
  timestamp: number
}

const CACHE_MAX_AGE = 4 * 60 * 1000

const cache = new Map<string, CacheEntry>()

function isCacheFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_MAX_AGE
}

function makeCacheKey(sort: string, dir: string, offset: number): string {
  return `${sort}:${dir}:${offset}`
}

export function useAllScoredIssues(
  includeKilled = false,
  sortField = 'cvs',
  sortDirection: 'asc' | 'desc' = 'desc'
): UseAllScoredIssuesResult {
  const [issues, setIssues] = useState<ScoredIssue[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [repoCount, setRepoCount] = useState(0)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const currentOffsetRef = useRef(0)
  const generationRef = useRef(0)

  const fetchPage = useCallback(
    async (offset: number, append: boolean, forceRefresh: boolean) => {
      const generation = ++generationRef.current
      const key = makeCacheKey(sortField, sortDirection, offset)

      if (!forceRefresh) {
        const cached = cache.get(key)
        if (cached && isCacheFresh(cached)) {
          if (generation !== generationRef.current) return
          if (append) {
            setIssues(prev => [...prev, ...cached.issues])
          } else {
            setIssues(cached.issues)
          }
          setTotalCount(cached.totalCount)
          setRepoCount(cached.repoCount)
          setHasMore(cached.hasMore)
          setLastFetched(new Date(cached.timestamp))
          currentOffsetRef.current = offset + cached.issues.length
          if (!append) setIsLoading(false)
          setIsLoadingMore(false)
          logger.info('[useAllScoredIssues] Using cached page', {
            offset,
            count: cached.issues.length
          })
          return
        }
      }

      if (append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
      }
      setError(null)

      try {
        const response = await ossIssuesClient.getAllScoredIssues({
          includeKilled,
          sort: sortField,
          dir: sortDirection,
          offset,
          limit: PAGE_SIZE
        })

        if (generation !== generationRef.current) return

        const pageIssues = response.data.issues
        const pageHasMore = response.data.hasMore ?? false
        const now = Date.now()

        if (append) {
          setIssues(prev => [...prev, ...pageIssues])
        } else {
          setIssues(pageIssues)
        }
        setTotalCount(response.data.totalCount)
        setRepoCount(response.data.repoCount)
        setHasMore(pageHasMore)
        setLastFetched(new Date(now))
        currentOffsetRef.current = offset + pageIssues.length

        cache.set(key, {
          issues: pageIssues,
          totalCount: response.data.totalCount,
          repoCount: response.data.repoCount,
          hasMore: pageHasMore,
          timestamp: now
        })

        logger.info('[useAllScoredIssues] Fetched page', {
          offset,
          count: pageIssues.length,
          totalCount: response.data.totalCount,
          hasMore: pageHasMore
        })
      } catch (err) {
        if (generation !== generationRef.current) return
        const message = err instanceof Error ? err.message : 'Failed to fetch scored issues'
        setError(message)
        logger.error('[useAllScoredIssues] Failed to fetch', { error: String(err) })
      } finally {
        if (generation === generationRef.current) {
          setIsLoading(false)
          setIsLoadingMore(false)
        }
      }
    },
    [includeKilled, sortField, sortDirection]
  )

  // Fetch first page on mount or when sort/direction/includeKilled changes
  useEffect(() => {
    currentOffsetRef.current = 0
    void fetchPage(0, false, false)
  }, [fetchPage])

  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore) return
    void fetchPage(currentOffsetRef.current, true, false)
  }, [fetchPage, isLoadingMore, hasMore])

  const refetch = useCallback(async () => {
    cache.clear()
    currentOffsetRef.current = 0
    await fetchPage(0, false, true)
  }, [fetchPage])

  return {
    issues,
    isLoading,
    isLoadingMore,
    error,
    totalCount,
    repoCount,
    lastFetched,
    hasMore,
    loadMore,
    refetch
  }
}
