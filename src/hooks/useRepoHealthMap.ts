import { useState, useEffect, useRef } from 'react'
import { logger } from '@wolffm/task-ui-components'
import { ossIssuesClient } from '../api/client'
import { isPendingResponse, type RepoHealth } from '../api/types'

interface UseRepoHealthMapResult {
  healthMap: Map<string, RepoHealth | null>
  isLoading: boolean
}

interface CacheEntry {
  health: RepoHealth | null
  timestamp: number
}

const CACHE_MAX_AGE = 10 * 60 * 1000

const cache = new Map<string, CacheEntry>()

function isCacheFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_MAX_AGE
}

export function useRepoHealthMap(slugs: string[]): UseRepoHealthMapResult {
  const [healthMap, setHealthMap] = useState<Map<string, RepoHealth | null>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const prevSlugsRef = useRef<string>('')

  useEffect(() => {
    const slugKey = [...slugs].sort().join(',')
    if (slugKey === prevSlugsRef.current) return
    prevSlugsRef.current = slugKey

    if (slugs.length === 0) {
      setHealthMap(new Map())
      return
    }

    // Separate cached and uncached slugs
    const result = new Map<string, RepoHealth | null>()
    const toFetch: string[] = []

    for (const slug of slugs) {
      const cached = cache.get(slug)
      if (cached && isCacheFresh(cached)) {
        result.set(slug, cached.health)
      } else {
        toFetch.push(slug)
      }
    }

    // If everything is cached, just set and return
    if (toFetch.length === 0) {
      setHealthMap(result)
      return
    }

    setIsLoading(true)

    void Promise.allSettled(
      toFetch.map(async slug => {
        const response = await ossIssuesClient.getRepoHealth(slug)
        if (isPendingResponse(response)) {
          return { slug, health: null }
        }
        return { slug, health: response.data }
      })
    ).then(results => {
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { slug, health } = r.value
          result.set(slug, health)
          cache.set(slug, { health, timestamp: Date.now() })
        }
      }

      setHealthMap(new Map(result))
      setIsLoading(false)
      logger.info('[useRepoHealthMap] Fetched health map', {
        total: slugs.length,
        fetched: toFetch.length
      })
    })
  }, [slugs])

  return { healthMap, isLoading }
}
