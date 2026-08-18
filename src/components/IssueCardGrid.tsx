import type { ScoredIssue } from '../api/types'
import { CvsScoreBadge } from './CvsScoreBadge'
import { LifecycleBadge } from './LifecycleBadge'
import { ClaimBadge } from './ClaimBadge'
import { CompetitionIndicator } from './CompetitionIndicator'
import { formatRelativeTime } from '../utils/formatDate'

interface IssueCardGridProps {
  issues: ScoredIssue[]
  onIssueClick: (issue: ScoredIssue) => void
  onRepoClick: (slug: string) => void
}

export function IssueCardGrid({ issues, onIssueClick, onRepoClick }: IssueCardGridProps) {
  if (issues.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__message">No issues match the current filters.</p>
      </div>
    )
  }

  return (
    <div className="issue-card-grid">
      {issues.map(issue => (
        <div
          key={issue.id}
          className={`issue-card issue-card--${issue.cvsTier} ${issue.repoKilled ? 'issue-card--killed' : ''}`}
          onClick={() => onIssueClick(issue)}
        >
          <div className="issue-card__header">
            <CvsScoreBadge cvs={issue.cvs} tier={issue.cvsTier} size="lg" />
            <span className="issue-card__age">{formatRelativeTime(issue.createdAt)}</span>
          </div>

          <h3 className="issue-card__title" title={issue.title}>
            {issue.title}
          </h3>

          <button
            type="button"
            className="issue-card__repo"
            onClick={e => {
              e.stopPropagation()
              onRepoClick(issue.repoSlug)
            }}
          >
            {issue.project}
          </button>

          <div className="issue-card__badges">
            <LifecycleBadge stage={issue.lifecycleStage} />
            <span className={`complexity-text complexity-text--${issue.complexity}`}>
              {issue.complexity}
            </span>
            <CompetitionIndicator level={issue.competitionLevel} />
          </div>

          <div className="issue-card__footer">
            <ClaimBadge status={issue.claimStatus} author={issue.claimAuthor} />
          </div>
        </div>
      ))}
    </div>
  )
}
