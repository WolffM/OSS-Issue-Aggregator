import { useCallback } from 'react'
import { ossIssuesClient } from '../api/client'
import { isPendingResponse, type RepoHealth } from '../api/types'
import { useCachedFetch } from './useCachedFetch'

interface UseRepoHealthResult {
  health: RepoHealth | null
  isPending: boolean
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useRepoHealth(slug: string | null): UseRepoHealthResult {
  const fetchFn = useCallback(async () => {
    const response = await ossIssuesClient.getRepoHealth(slug!)
    if (isPendingResponse(response)) {
      return { data: null, isPending: true }
    }
    return { data: response.data, isPending: false }
  }, [slug])

  const { data, isPending, isLoading, error, refetch } = useCachedFetch<RepoHealth>({
    namespace: 'repoHealth',
    cacheKey: slug,
    maxAge: 10 * 60 * 1000,
    fetchFn,
    label: 'useRepoHealth'
  })

  return { health: data, isPending, isLoading, error, refetch }
}
