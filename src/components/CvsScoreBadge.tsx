import type { CVSTier } from '../api/types'

interface CvsScoreBadgeProps {
  cvs: number
  tier: CVSTier
  size?: 'sm' | 'md' | 'lg'
}

export function CvsScoreBadge({ cvs, tier, size = 'md' }: CvsScoreBadgeProps) {
  return (
    <span className={`cvs-badge cvs-badge--${tier} cvs-badge--${size}`}>
      <span className="cvs-badge__score">{cvs}</span>
      {size !== 'sm' && <span className="cvs-badge__tier">{tier}</span>}
    </span>
  )
}
