import { useState, useMemo } from 'react'

interface ProjectItem {
  slug: string
  name: string
}

interface ProjectSelectorProps {
  projects: ProjectItem[]
  selectedProjects: string[]
  onSelectionChange: (slugs: string[]) => void
  disabled?: boolean
  focusedRepo?: string | null
  onFocusRepo?: (slug: string | null) => void
}

export function ProjectSelector({
  projects,
  selectedProjects,
  onSelectionChange,
  disabled,
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
        {filteredProjects.map(project => (
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
          </div>
        ))}
      </div>

      <div className="project-selector__count">
        {selectedProjects.length} of {projects.length} selected
      </div>
    </div>
  )
}
