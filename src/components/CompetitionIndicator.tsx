import type { CompetitionLevel } from '../api/types'

interface CompetitionIndicatorProps {
  level: CompetitionLevel
}

const LEVEL_BARS: Record<CompetitionLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3
}

export function CompetitionIndicator({ level }: CompetitionIndicatorProps) {
  const filled = LEVEL_BARS[level]

  return (
    <span
      className={`competition-indicator competition-indicator--${level}`}
      title={`Competition: ${level}`}
    >
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className={`competition-indicator__bar ${i < filled ? 'competition-indicator__bar--filled' : ''}`}
        />
      ))}
    </span>
  )
}
