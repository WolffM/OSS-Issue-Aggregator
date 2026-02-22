import type { ClaimStatus } from '../api/types'

interface ClaimBadgeProps {
  status: ClaimStatus
  author: string | null
}

export function ClaimBadge({ status, author }: ClaimBadgeProps) {
  return (
    <span className={`claim-badge claim-badge--${status}`}>
      <span className="claim-badge__dot" />
      {status === 'claimed' && author && <span className="claim-badge__author">{author}</span>}
      {status === 'unclaimed' && <span className="claim-badge__label">Open</span>}
      {status === 'stale-claim' && <span className="claim-badge__label">Stale</span>}
    </span>
  )
}
