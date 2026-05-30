import { useState, useCallback } from 'react'
import { logger } from '@wolffm/logger/client'
import { ossIssuesClient } from '../api/client'

interface UseClaimResult {
  claim: (slug: string, issueId: string, claimedBy: string, forkIssueUrl?: string) => Promise<void>
  unclaim: (slug: string, issueId: string) => Promise<void>
  isLoading: boolean
  error: string | null
}

export function useClaim(onMutate?: () => Promise<void>): UseClaimResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const claim = useCallback(
    async (slug: string, issueId: string, claimedBy: string, forkIssueUrl?: string) => {
      setIsLoading(true)
      setError(null)

      try {
        await ossIssuesClient.claimIssue(slug, issueId, claimedBy, forkIssueUrl)
        logger.info('[useClaim] Issue claimed', { slug, issueId, claimedBy })
        if (onMutate) await onMutate()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to claim issue'
        setError(message)
        logger.error('[useClaim] Failed to claim', { slug, issueId, error: String(err) })
      } finally {
        setIsLoading(false)
      }
    },
    [onMutate]
  )

  const unclaim = useCallback(
    async (slug: string, issueId: string) => {
      setIsLoading(true)
      setError(null)

      try {
        await ossIssuesClient.unclaimIssue(slug, issueId)
        logger.info('[useClaim] Issue unclaimed', { slug, issueId })
        if (onMutate) await onMutate()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to unclaim issue'
        setError(message)
        logger.error('[useClaim] Failed to unclaim', { slug, issueId, error: String(err) })
      } finally {
        setIsLoading(false)
      }
    },
    [onMutate]
  )

  return { claim, unclaim, isLoading, error }
}
