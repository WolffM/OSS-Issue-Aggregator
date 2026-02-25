import { useState, useEffect, useCallback } from 'react'
import { logger } from '@wolffm/task-ui-components'

interface CacheEntry<T> {
  data: T | null
  isPending: boolean
  timestamp: number
}

const caches = new Map<string, Map<string, CacheEntry<unknown>>>()

function getCache<T>(namespace: string): Map<string, CacheEntry<T>> {
  if (!caches.has(namespace)) {
    caches.set(namespace, new Map())
  }
  return caches.get(namespace)! as Map<string, CacheEntry<T>>
}

interface UseCachedFetchOptions<T> {
  /** Unique namespace for isolating this hook's cache (e.g. 'dossier', 'repoHealth') */
  namespace: string
  /** Cache key — typically the slug or a derived string. null disables fetching. */
  cacheKey: string | null
  /** Max cache age in ms */
  maxAge: number
  /** The async function that fetches data. Return { data, isPending }. */
  fetchFn: () => Promise<{ data: T | null; isPending: boolean }>
  /** Logger label for debug output */
  label: string
}

interface UseCachedFetchResult<T> {
  data: T | null
  isPending: boolean
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useCachedFetch<T>(options: UseCachedFetchOptions<T>): UseCachedFetchResult<T> {
  const { namespace, cacheKey, maxAge, fetchFn, label } = options

  const [data, setData] = useState<T | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doFetch = useCallback(
    async (forceRefresh = false) => {
      if (!cacheKey) {
        setData(null)
        setIsPending(false)
        setIsLoading(false)
        setError(null)
        return
      }

      const cache = getCache<T>(namespace)

      if (!forceRefresh) {
        const cached = cache.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < maxAge) {
          setData(cached.data)
          setIsPending(cached.isPending)
          setIsLoading(false)
          return
        }
      }

      setIsLoading(true)
      setError(null)

      try {
        const result = await fetchFn()
        setData(result.data)
        setIsPending(result.isPending)
        cache.set(cacheKey, {
          data: result.data,
          isPending: result.isPending,
          timestamp: Date.now()
        })
        logger.info(`[${label}] Fetched`, { cacheKey })
      } catch (err) {
        const message = err instanceof Error ? err.message : `Failed to fetch ${label}`
        setError(message)
        logger.error(`[${label}] Failed to fetch`, { cacheKey, error: String(err) })
      } finally {
        setIsLoading(false)
      }
    },
    [cacheKey, namespace, maxAge, fetchFn, label]
  )

  useEffect(() => {
    void doFetch()
  }, [doFetch])

  const refetch = useCallback(async () => {
    await doFetch(true)
  }, [doFetch])

  return { data, isPending, isLoading, error, refetch }
}
