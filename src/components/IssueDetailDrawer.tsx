import type { ScoredIssue } from '../api/types'
import { Drawer } from './Drawer'
import { CvsScoreBadge } from './CvsScoreBadge'
import { LifecycleBadge } from './LifecycleBadge'
import { ClaimBadge } from './ClaimBadge'
import { CompetitionIndicator } from './CompetitionIndicator'
import { SentimentIndicator } from './SentimentIndicator'
import { formatRelativeTime } from '../utils/formatDate'

interface IssueDetailDrawerProps {
  issue: ScoredIssue | null
  isOpen: boolean
  onClose: () => void
  onClaim: (issueId: string, slug: string) => void
  onUnclaim: (issueId: string, slug: string) => void
  onViewDossier: (slug: string) => void
}

export function IssueDetailDrawer({
  issue,
  isOpen,
  onClose,
  onClaim,
  onUnclaim,
  onViewDossier
}: IssueDetailDrawerProps) {
  if (!issue) return null

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Issue Detail" width={560}>
      <div className="issue-detail">
        <div className="issue-detail__header">
          <CvsScoreBadge cvs={issue.cvs} tier={issue.cvsTier} size="lg" />
          <div className="issue-detail__title-group">
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="issue-detail__title"
            >
              {issue.title}
            </a>
            <span className="issue-detail__repo">{issue.repoSlug.replace('-', '/')}</span>
          </div>
        </div>

        <div className="issue-detail__metrics">
          <div className="issue-detail__metric">
            <span className="issue-detail__metric-label">Lifecycle</span>
            <LifecycleBadge stage={issue.lifecycleStage} />
          </div>
          <div className="issue-detail__metric">
            <span className="issue-detail__metric-label">Complexity</span>
            <span className={`complexity-text complexity-text--${issue.complexity}`}>
              {issue.complexity}
            </span>
          </div>
          <div className="issue-detail__metric">
            <span className="issue-detail__metric-label">Sentiment</span>
            <SentimentIndicator score={issue.sentimentScore} />
            <span className="issue-detail__metric-value">{issue.sentimentScore.toFixed(2)}</span>
          </div>
          <div className="issue-detail__metric">
            <span className="issue-detail__metric-label">Competition</span>
            <CompetitionIndicator level={issue.competitionLevel} />
          </div>
          <div className="issue-detail__metric">
            <span className="issue-detail__metric-label">Content Quality</span>
            <span className="issue-detail__metric-value">{issue.contentQualityScore}/100</span>
          </div>
          <div className="issue-detail__metric">
            <span className="issue-detail__metric-label">Claim</span>
            <ClaimBadge status={issue.claimStatus} author={issue.claimAuthor} />
          </div>
          <div className="issue-detail__metric">
            <span className="issue-detail__metric-label">Created</span>
            <span className="issue-detail__metric-value">
              {formatRelativeTime(issue.createdAt)}
            </span>
          </div>
          <div className="issue-detail__metric">
            <span className="issue-detail__metric-label">Comments</span>
            <span className="issue-detail__metric-value">{issue.commentCount}</span>
          </div>
          {issue.thumbsUpCount > 0 && (
            <div className="issue-detail__metric">
              <span className="issue-detail__metric-label">Thumbs Up</span>
              <span className="issue-detail__metric-value">{issue.thumbsUpCount}</span>
            </div>
          )}
        </div>

        {issue.bodyPreview && (
          <div className="issue-detail__body-preview">
            <h4 className="issue-detail__section-title">Description</h4>
            <p className="issue-detail__body-text">{issue.bodyPreview}</p>
          </div>
        )}

        {issue.labels.length > 0 && (
          <div className="issue-detail__labels">
            <h4 className="issue-detail__section-title">Labels</h4>
            <div className="issue-detail__label-list">
              {issue.labels.map(label => (
                <span key={label} className="issue-detail__label">
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {issue.lastCommentAuthor && (
          <div className="issue-detail__last-comment">
            <h4 className="issue-detail__section-title">Last Comment</h4>
            <p className="issue-detail__comment-meta">
              by {issue.lastCommentAuthor}
              {issue.lastCommentAt && ` · ${formatRelativeTime(issue.lastCommentAt)}`}
            </p>
          </div>
        )}

        <div className="issue-detail__actions">
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="issue-detail__action-btn issue-detail__action-btn--primary"
          >
            Open on GitHub
          </a>
          <button
            type="button"
            className="issue-detail__action-btn"
            onClick={() => onViewDossier(issue.repoSlug)}
          >
            View Repo Dossier
          </button>
          {issue.claimStatus === 'unclaimed' && (
            <button
              type="button"
              className="issue-detail__action-btn issue-detail__action-btn--claim"
              onClick={() => onClaim(issue.id, issue.repoSlug)}
            >
              Claim Issue
            </button>
          )}
          {issue.claimStatus === 'claimed' && (
            <button
              type="button"
              className="issue-detail__action-btn issue-detail__action-btn--unclaim"
              onClick={() => onUnclaim(issue.id, issue.repoSlug)}
            >
              Unclaim
            </button>
          )}
        </div>

        {issue.repoKilled && (
          <div className="issue-detail__killed-warning">
            This issue belongs to a killed repository. Contribution is not recommended.
          </div>
        )}
      </div>
    </Drawer>
  )
}
