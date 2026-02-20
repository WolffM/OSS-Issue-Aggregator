import { useEffect, useRef, type MouseEvent } from 'react'
import type { Issue, Project } from '../api/types'
import { PlatformIcon } from './PlatformIcon'
import { DifficultyBadge } from './DifficultyBadge'
import { ContributingLink } from './ContributingLink'
import { formatRelativeTime } from '../utils/formatDate'

interface ProjectDetailModalProps {
  project: Project
  issues: Issue[]
  isOpen: boolean
  onClose: () => void
}

export function ProjectDetailModal({ project, issues, isOpen, onClose }: ProjectDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Close when clicking backdrop
  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true">
        <div className="modal__header">
          <div className="modal__title-row">
            <PlatformIcon platform={project.platform} />
            <h2 className="modal__title">{project.name}</h2>
            <span className="modal__count">{issues.length} issues</span>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <div className="modal__body">
          {issues.length === 0 ? (
            <div className="modal__empty">No issues available for this project.</div>
          ) : (
            <ul className="modal__issue-list">
              {issues.map(issue => (
                <li key={issue.id} className="modal__issue">
                  <div className="modal__issue-header">
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="modal__issue-title"
                    >
                      {issue.title}
                    </a>
                    <DifficultyBadge difficulty={issue.difficulty} />
                  </div>

                  <div className="modal__issue-meta">
                    <span className="modal__issue-author">by {issue.author}</span>
                    <span className="modal__issue-date">
                      Created {formatRelativeTime(issue.createdAt)}
                    </span>
                  </div>

                  {issue.labels.length > 0 && (
                    <div className="modal__issue-labels">
                      {issue.labels.slice(0, 5).map(label => (
                        <span key={label} className="modal__issue-label">
                          {label}
                        </span>
                      ))}
                      {issue.labels.length > 5 && (
                        <span className="modal__issue-label modal__issue-label--more">
                          +{issue.labels.length - 5} more
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal__footer">
          <ContributingLink url={project.contributingUrl} className="modal__contribute-link">
            View Contributing Guide
          </ContributingLink>
          <button className="modal__close-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
