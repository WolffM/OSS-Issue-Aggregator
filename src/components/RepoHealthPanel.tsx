import type { RepoHealth } from '../api/types'

interface RepoHealthPanelProps {
  health: RepoHealth | null
  isLoading: boolean
  isPending: boolean
  slug: string | null
  onViewDossier: (slug: string) => void
}

function viabilityColor(score: number): string {
  if (score >= 70) return 'repo-health__score--viable'
  if (score >= 40) return 'repo-health__score--caution'
  return 'repo-health__score--killed'
}

export function RepoHealthPanel({
  health,
  isLoading,
  isPending,
  slug,
  onViewDossier
}: RepoHealthPanelProps) {
  if (!slug) return null

  if (isLoading) {
    return (
      <div className="repo-health">
        <h3 className="repo-health__title">{slug.replace('-', '/')}</h3>
        <div className="repo-health__loading">Loading health data...</div>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="repo-health">
        <h3 className="repo-health__title">{slug.replace('-', '/')}</h3>
        <div className="repo-health__pending">Awaiting initial scan</div>
      </div>
    )
  }

  if (!health) return null

  return (
    <div className="repo-health">
      <h3 className="repo-health__title">{slug.replace('-', '/')}</h3>

      {health.killed ? (
        <div className="repo-health__killed-warning">Not Viable: {health.killReason}</div>
      ) : (
        <>
          <div className={`repo-health__score ${viabilityColor(health.overallViability)}`}>
            <span className="repo-health__score-number">{health.overallViability}</span>
            <span className="repo-health__score-label">Viability</span>
          </div>

          <div className="repo-health__sub-scores">
            <div className="repo-health__sub-score">
              <span className="repo-health__sub-label">Maintainer</span>
              <div className="repo-health__bar">
                <div
                  className="repo-health__bar-fill"
                  style={{ width: `${health.maintainerHealthScore}%` }}
                />
              </div>
              <span className="repo-health__sub-value">{health.maintainerHealthScore}</span>
            </div>
            <div className="repo-health__sub-score">
              <span className="repo-health__sub-label">Merge Access</span>
              <div className="repo-health__bar">
                <div
                  className="repo-health__bar-fill"
                  style={{ width: `${health.mergeAccessibilityScore}%` }}
                />
              </div>
              <span className="repo-health__sub-value">{health.mergeAccessibilityScore}</span>
            </div>
            <div className="repo-health__sub-score">
              <span className="repo-health__sub-label">Availability</span>
              <div className="repo-health__bar">
                <div
                  className="repo-health__bar-fill"
                  style={{ width: `${health.availabilityScore}%` }}
                />
              </div>
              <span className="repo-health__sub-value">{health.availabilityScore}</span>
            </div>
          </div>
        </>
      )}

      {health.detectedQuirks.length > 0 && (
        <div className="repo-health__quirks">
          <h4 className="repo-health__quirks-title">Quirks</h4>
          {health.detectedQuirks.map((quirk, i) => (
            <div key={i} className={`repo-health__quirk repo-health__quirk--${quirk.impact}`}>
              <span className="repo-health__quirk-impact">{quirk.impact}</span>
              <span className="repo-health__quirk-desc">{quirk.description}</span>
            </div>
          ))}
        </div>
      )}

      <div className="repo-health__pr-patterns">
        <span className="repo-health__pattern">
          {health.prPatterns.mergeStyle} merge · {health.prPatterns.medianTimeToMergeDays}d avg ·{' '}
          {Math.round(health.prPatterns.externalContributorMergeRate * 100)}% ext. merge
        </span>
      </div>

      <button
        type="button"
        className="repo-health__dossier-btn"
        onClick={() => onViewDossier(slug)}
      >
        View Full Dossier
      </button>
    </div>
  )
}
