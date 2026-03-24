import { useCallback } from 'react'
import { ossIssuesClient } from '../api/client'
import { isPendingResponse, type Dossier } from '../api/types'
import { useCachedFetch } from './useCachedFetch'

interface UseDossierResult {
  dossier: Dossier | null
  isPending: boolean
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useDossier(slug: string | null): UseDossierResult {
  const fetchFn = useCallback(async () => {
    const response = await ossIssuesClient.getDossier(slug!)
    if (isPendingResponse(response)) {
      return { data: null, isPending: true }
    }
    return { data: response.data, isPending: false }
  }, [slug])

  const { data, isPending, isLoading, error, refetch } = useCachedFetch<Dossier>({
    namespace: 'dossier',
    cacheKey: slug,
    maxAge: 10 * 60 * 1000,
    fetchFn,
    label: 'useDossier'
  })

  return { dossier: data, isPending, isLoading, error, refetch }
}
