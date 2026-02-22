import { useState, useEffect, useCallback } from 'react'
import { logger } from '@wolffm/task-ui-components'
import { ossIssuesClient } from '../api/client'
import { isPendingResponse, type Dossier } from '../api/types'

interface UseDossierResult {
  dossier: Dossier | null
  isPending: boolean
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

interface CacheEntry {
  dossier: Dossier | null
  isPending: boolean
  timestamp: number
}

const CACHE_MAX_AGE = 10 * 60 * 1000

const cache = new Map<string, CacheEntry>()

function isCacheFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_MAX_AGE
}

export function useDossier(slug: string | null): UseDossierResult {
  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDossier = useCallback(
    async (forceRefresh = false) => {
      if (!slug) {
        setDossier(null)
        setIsPending(false)
        setIsLoading(false)
        setError(null)
        return
      }

      if (!forceRefresh) {
        const cached = cache.get(slug)
        if (cached && isCacheFresh(cached)) {
          setDossier(cached.dossier)
          setIsPending(cached.isPending)
          setIsLoading(false)
          return
        }
      }

      setIsLoading(true)
      setError(null)

      try {
        const response = await ossIssuesClient.getDossier(slug)

        if (isPendingResponse(response)) {
          setDossier(null)
          setIsPending(true)
          cache.set(slug, { dossier: null, isPending: true, timestamp: Date.now() })
        } else {
          const dossierData = response.data
          setDossier(dossierData)
          setIsPending(false)
          cache.set(slug, { dossier: dossierData, isPending: false, timestamp: Date.now() })
        }

        logger.info('[useDossier] Fetched dossier', { slug })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch dossier'
        setError(message)
        logger.error('[useDossier] Failed to fetch', { slug, error: String(err) })
      } finally {
        setIsLoading(false)
      }
    },
    [slug]
  )

  useEffect(() => {
    void fetchDossier()
  }, [fetchDossier])

  const refetch = useCallback(async () => {
    await fetchDossier(true)
  }, [fetchDossier])

  return { dossier, isPending, isLoading, error, refetch }
}
