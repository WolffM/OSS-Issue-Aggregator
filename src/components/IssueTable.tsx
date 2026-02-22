import type { ScoredIssue } from '../api/types'
import type { SortField } from '../hooks/useIssueFilters'
import { CvsScoreBadge } from './CvsScoreBadge'
import { LifecycleBadge } from './LifecycleBadge'
import { ClaimBadge } from './ClaimBadge'
import { CompetitionIndicator } from './CompetitionIndicator'
import { SentimentIndicator } from './SentimentIndicator'
import { formatRelativeTime } from '../utils/formatDate'

interface IssueTableProps {
  issues: ScoredIssue[]
  onIssueClick: (issue: ScoredIssue) => void
  onRepoClick: (slug: string) => void
  sortField: SortField
  sortDirection: 'asc' | 'desc'
  onSort: (field: SortField) => void
}

interface ColumnDef {
  field: SortField
  label: string
  className: string
  sortable: boolean
}

const COLUMNS: ColumnDef[] = [
  { field: 'cvs', label: 'CVS', className: 'issue-table__cell--cvs', sortable: true },
  { field: 'title', label: 'Title', className: 'issue-table__cell--title', sortable: true },
  { field: 'repo', label: 'Repo', className: 'issue-table__cell--repo', sortable: true },
  {
    field: 'lifecycle',
    label: 'Lifecycle',
    className: 'issue-table__cell--lifecycle',
    sortable: true
  },
  {
    field: 'complexity',
    label: 'Complexity',
    className: 'issue-table__cell--complexity',
    sortable: true
  },
  { field: 'sentiment', label: 'Sent.', className: 'issue-table__cell--sentiment', sortable: true },
  {
    field: 'competition',
    label: 'Comp.',
    className: 'issue-table__cell--competition',
    sortable: true
  },
  { field: 'createdAt', label: 'Age', className: 'issue-table__cell--age', sortable: true }
]

function getSortIndicator(
  field: SortField,
  sortField: SortField,
  sortDirection: 'asc' | 'desc'
): string {
  if (field !== sortField) return ''
  return sortDirection === 'asc' ? ' ↑' : ' ↓'
}

export function IssueTable({
  issues,
  onIssueClick,
  onRepoClick,
  sortField,
  sortDirection,
  onSort
}: IssueTableProps) {
  if (issues.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__message">No issues match the current filters.</p>
      </div>
    )
  }

  return (
    <div className="issue-table-wrapper">
      <table className="issue-table">
        <thead>
          <tr className="issue-table__header">
            {COLUMNS.map(col => (
              <th
                key={col.field}
                className={`issue-table__header-cell ${col.className} ${col.sortable ? 'issue-table__header-cell--sortable' : ''} ${sortField === col.field ? 'issue-table__header-cell--sorted' : ''}`}
                onClick={col.sortable ? () => onSort(col.field) : undefined}
              >
                {col.label}
                {getSortIndicator(col.field, sortField, sortDirection)}
              </th>
            ))}
            <th className="issue-table__header-cell issue-table__cell--claim">Claim</th>
          </tr>
        </thead>
        <tbody>
          {issues.map(issue => (
            <tr
              key={issue.id}
              className={`issue-table__row ${issue.repoKilled ? 'issue-table__row--killed' : ''}`}
              onClick={() => onIssueClick(issue)}
            >
              <td className="issue-table__cell issue-table__cell--cvs">
                <CvsScoreBadge cvs={issue.cvs} tier={issue.cvsTier} size="sm" />
              </td>
              <td className="issue-table__cell issue-table__cell--title">
                <span className="issue-table__title-text" title={issue.title}>
                  {issue.title}
                </span>
              </td>
              <td className="issue-table__cell issue-table__cell--repo">
                <button
                  type="button"
                  className="issue-table__repo-link"
                  onClick={e => {
                    e.stopPropagation()
                    onRepoClick(issue.repoSlug)
                  }}
                >
                  {issue.repoSlug.replace('-', '/')}
                </button>
              </td>
              <td className="issue-table__cell issue-table__cell--lifecycle">
                <LifecycleBadge stage={issue.lifecycleStage} />
              </td>
              <td className="issue-table__cell issue-table__cell--complexity">
                <span className={`complexity-text complexity-text--${issue.complexity}`}>
                  {issue.complexity}
                </span>
              </td>
              <td className="issue-table__cell issue-table__cell--sentiment">
                <SentimentIndicator score={issue.sentimentScore} />
              </td>
              <td className="issue-table__cell issue-table__cell--competition">
                <CompetitionIndicator level={issue.competitionLevel} />
              </td>
              <td className="issue-table__cell issue-table__cell--age">
                {formatRelativeTime(issue.createdAt)}
              </td>
              <td className="issue-table__cell issue-table__cell--claim">
                <ClaimBadge status={issue.claimStatus} author={issue.claimAuthor} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
