import type { LifecycleStage } from '../api/types'

interface LifecycleBadgeProps {
  stage: LifecycleStage
}

export function LifecycleBadge({ stage }: LifecycleBadgeProps) {
  return <span className={`lifecycle-badge lifecycle-badge--${stage}`}>{stage}</span>
}
