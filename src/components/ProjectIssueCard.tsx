import { useState } from 'react'
import type { Issue, Project } from '../api/types'
import { PlatformIcon } from './PlatformIcon'
import { DifficultyBadge } from './DifficultyBadge'
import { ProjectDetailModal } from './ProjectDetailModal'
import { formatRelativeTime } from '../utils/formatDate'

interface ProjectIssueCardProps {
  project: Project
  issues: Issue[]
  maxIssues?: number
}

export function ProjectIssueCard({ project, issues, maxIssues = 5 }: ProjectIssueCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const displayIssues = issues.slice(0, maxIssues)

  return (
    <div className="project-card">
      <button
        type="button"
        className="project-card__header project-card__header--clickable"
        onClick={() => setIsModalOpen(true)}
        title="Click to view all issues"
      >
        <PlatformIcon platform={project.platform} />
        <h3 className="project-card__title">{project.name}</h3>
        <span className="project-card__count">{issues.length} issues</span>
        <span className="project-card__expand-icon" aria-hidden="true">
          ⤢
        </span>
      </button>

      <ProjectDetailModal
        project={project}
        issues={issues}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />

      {displayIssues.length === 0 ? (
        <div className="project-card__empty">No issues available</div>
      ) : (
        <ul className="project-card__issues">
          {displayIssues.map(issue => (
            <li key={issue.id} className="project-card__issue">
              <a
                href={issue.url}
                target="_blank"
                rel="noopener noreferrer"
                className="project-card__issue-link"
                title={issue.title}
              >
                {issue.title}
              </a>
              <div className="project-card__issue-meta">
                <DifficultyBadge difficulty={issue.difficulty} />
                <span className="project-card__issue-date">
                  {formatRelativeTime(issue.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {project.contributingUrl && (
        <a
          href={project.contributingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="project-card__contribute"
        >
          Contributing Guide →
        </a>
      )}
    </div>
  )
}
