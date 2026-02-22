import { useState, useEffect, useCallback } from 'react'
import { logger } from '@wolffm/task-ui-components'
import { ossIssuesClient } from '../api/client'
import { isPendingResponse, type RepoHealth } from '../api/types'

interface UseRepoHealthResult {
  health: RepoHealth | null
  isPending: boolean
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

interface CacheEntry {
  health: RepoHealth | null
  isPending: boolean
  timestamp: number
}

const CACHE_MAX_AGE = 10 * 60 * 1000

const cache = new Map<string, CacheEntry>()

function isCacheFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_MAX_AGE
}

export function useRepoHealth(slug: string | null): UseRepoHealthResult {
  const [health, setHealth] = useState<RepoHealth | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = useCallback(
    async (forceRefresh = false) => {
      if (!slug) {
        setHealth(null)
        setIsPending(false)
        setIsLoading(false)
        setError(null)
        return
      }

      if (!forceRefresh) {
        const cached = cache.get(slug)
        if (cached && isCacheFresh(cached)) {
          setHealth(cached.health)
          setIsPending(cached.isPending)
          setIsLoading(false)
          return
        }
      }

      setIsLoading(true)
      setError(null)

      try {
        const response = await ossIssuesClient.getRepoHealth(slug)

        if (isPendingResponse(response)) {
          setHealth(null)
          setIsPending(true)
          cache.set(slug, { health: null, isPending: true, timestamp: Date.now() })
        } else {
          const healthData = response.data
          setHealth(healthData)
          setIsPending(false)
          cache.set(slug, { health: healthData, isPending: false, timestamp: Date.now() })
        }

        logger.info('[useRepoHealth] Fetched health', { slug })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch repo health'
        setError(message)
        logger.error('[useRepoHealth] Failed to fetch', { slug, error: String(err) })
      } finally {
        setIsLoading(false)
      }
    },
    [slug]
  )

  useEffect(() => {
    void fetchHealth()
  }, [fetchHealth])

  const refetch = useCallback(async () => {
    await fetchHealth(true)
  }, [fetchHealth])

  return { health, isPending, isLoading, error, refetch }
}
