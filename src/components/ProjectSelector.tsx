import { useState, useMemo } from 'react'
import type { Project, RepoHealth } from '../api/types'

interface ProjectSelectorProps {
  projects: Project[]
  selectedProjects: string[]
  onSelectionChange: (slugs: string[]) => void
  disabled?: boolean
  repoHealthMap?: Map<string, RepoHealth | null>
  focusedRepo?: string | null
  onFocusRepo?: (slug: string | null) => void
}

function healthDotClass(health: RepoHealth | null | undefined): string {
  if (!health) return ''
  if (health.killed) return 'project-selector__health-dot--killed'
  if (health.overallViability >= 70) return 'project-selector__health-dot--viable'
  if (health.overallViability >= 40) return 'project-selector__health-dot--caution'
  return 'project-selector__health-dot--killed'
}

export function ProjectSelector({
  projects,
  selectedProjects,
  onSelectionChange,
  disabled,
  repoHealthMap,
  focusedRepo,
  onFocusRepo
}: ProjectSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredProjects = useMemo(() => {
    let filtered = projects
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = projects.filter(p => p.name.toLowerCase().includes(query))
    }
    return [...filtered].sort((a, b) => {
      const aSelected = selectedProjects.includes(a.slug)
      const bSelected = selectedProjects.includes(b.slug)
      if (aSelected && !bSelected) return -1
      if (!aSelected && bSelected) return 1
      return a.name.localeCompare(b.name)
    })
  }, [projects, searchQuery, selectedProjects])

  const handleToggle = (slug: string) => {
    if (selectedProjects.includes(slug)) {
      onSelectionChange(selectedProjects.filter(s => s !== slug))
    } else {
      onSelectionChange([...selectedProjects, slug])
    }
  }

  const handleFocus = (slug: string) => {
    if (onFocusRepo) {
      onFocusRepo(focusedRepo === slug ? null : slug)
    }
  }

  const handleSelectAll = () => {
    onSelectionChange(projects.map(p => p.slug))
  }

  const handleClearAll = () => {
    onSelectionChange([])
  }

  return (
    <div className="project-selector">
      <div className="project-selector__header">
        <input
          type="text"
          className="project-selector__search"
          placeholder="Search projects..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          disabled={disabled}
        />
        <div className="project-selector__actions">
          <button
            type="button"
            className="project-selector__action"
            onClick={handleSelectAll}
            disabled={disabled}
          >
            All
          </button>
          <button
            type="button"
            className="project-selector__action"
            onClick={handleClearAll}
            disabled={disabled}
          >
            None
          </button>
        </div>
      </div>

      <div className="project-selector__list">
        {filteredProjects.map(project => {
          const health = repoHealthMap?.get(project.slug)
          const dotClass = healthDotClass(health)

          return (
            <div
              key={project.slug}
              className={`project-selector__item ${selectedProjects.includes(project.slug) ? 'project-selector__item--selected' : ''} ${focusedRepo === project.slug ? 'project-selector__item--focused' : ''}`}
            >
              <input
                type="checkbox"
                className="project-selector__checkbox"
                checked={selectedProjects.includes(project.slug)}
                onChange={() => handleToggle(project.slug)}
                disabled={disabled}
              />
              <button
                type="button"
                className="project-selector__name-btn"
                onClick={() => handleFocus(project.slug)}
              >
                {project.name}
              </button>
              {dotClass && <span className={`project-selector__health-dot ${dotClass}`} />}
            </div>
          )
        })}
      </div>

      <div className="project-selector__count">
        {selectedProjects.length} of {projects.length} selected
      </div>
    </div>
  )
}
