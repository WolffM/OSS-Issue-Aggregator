import { useRef, useState, useMemo, useEffect } from 'react'
import { ConnectedThemePicker, LoadingSkeleton } from '@wolffm/task-ui-components'
import { THEME_ICON_MAP } from '@wolffm/themes'
import { useTheme } from './hooks/useTheme'
import { useProjects } from './hooks/useProjects'
import { useIssues } from './hooks/useIssues'
import { ProjectSelector, ProjectIssueCard, ErrorState, Footer } from './components'
import type { OssAggregatorProps } from './entry'

// Default selected projects by name (must match API project names exactly)
const DEFAULT_SELECTED_NAMES = [
  'VLC Media Player',
  'MediaWiki',
  'Internet Archive Open Library',
  'PyTorch',
  'Node.js',
  'Blender',
  'Hugging Face Transformers',
  'React'
]

const STORAGE_KEY = 'oss-aggregator-selected-projects'

// Load saved selections from localStorage
function loadSavedSelections(): string[] | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed: unknown = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
        return parsed
      }
    }
  } catch {
    // Ignore parse errors
  }
  return null
}

// Save selections to localStorage
function saveSelections(slugs: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slugs))
  } catch {
    // Ignore storage errors (e.g., quota exceeded)
  }
}

export default function App(props: OssAggregatorProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedProjectSlugs, setSelectedProjectSlugs] = useState<string[]>([])
  const [hasInitializedDefaults, setHasInitializedDefaults] = useState(false)

  // Detect system preference for loading skeleton
  const [systemPrefersDark] = useState(() => {
    if (window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  })

  const { theme, setTheme, isDarkTheme, isThemeReady, isInitialThemeLoad, THEME_FAMILIES } =
    useTheme({
      propsTheme: props.theme,
      experimentalThemes: false,
      containerRef
    })

  // Fetch projects and pools
  const { projects, isLoading: projectsLoading, error: projectsError } = useProjects()

  // Fetch all issues (we'll filter client-side by selected projects)
  const {
    issues,
    isLoading: issuesLoading,
    error: issuesError,
    fetchErrors,
    lastFetched,
    refetch
  } = useIssues('all')

  // Initialize selected projects from localStorage or defaults
  useEffect(() => {
    if (projects.length > 0 && !hasInitializedDefaults) {
      const savedSlugs = loadSavedSelections()

      if (savedSlugs && savedSlugs.length > 0) {
        // Filter to only include slugs that exist in current projects
        const validSlugs = savedSlugs.filter(slug => projects.some(p => p.slug === slug))
        if (validSlugs.length > 0) {
          setSelectedProjectSlugs(validSlugs)
          setHasInitializedDefaults(true)
          return
        }
      }

      // Fall back to defaults
      const defaultSlugs = projects
        .filter(p => DEFAULT_SELECTED_NAMES.includes(p.name))
        .map(p => p.slug)
      setSelectedProjectSlugs(defaultSlugs)
      setHasInitializedDefaults(true)
    }
  }, [projects, hasInitializedDefaults])

  // Save selections to localStorage whenever they change
  useEffect(() => {
    if (hasInitializedDefaults && selectedProjectSlugs.length >= 0) {
      saveSelections(selectedProjectSlugs)
    }
  }, [selectedProjectSlugs, hasInitializedDefaults])

  // Group issues by project and filter by selection
  const issuesByProject = useMemo(() => {
    const grouped = new Map<string, typeof issues>()

    // Get selected project names
    const selectedNames = new Set(
      projects.filter(p => selectedProjectSlugs.includes(p.slug)).map(p => p.name)
    )

    for (const issue of issues) {
      if (!selectedNames.has(issue.project)) continue

      const existing = grouped.get(issue.project) ?? []
      existing.push(issue)
      grouped.set(issue.project, existing)
    }

    // Sort issues within each project by createdAt (newest first)
    for (const [key, projectIssues] of grouped) {
      grouped.set(
        key,
        projectIssues.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      )
    }

    return grouped
  }, [issues, projects, selectedProjectSlugs])

  // Get selected projects in order
  const selectedProjects = useMemo(() => {
    return projects
      .filter(p => selectedProjectSlugs.includes(p.slug))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [projects, selectedProjectSlugs])

  // Show loading skeleton during initial theme load to prevent FOUC
  if (isInitialThemeLoad && !isThemeReady) {
    return <LoadingSkeleton isDarkTheme={systemPrefersDark} />
  }

  const isLoading = projectsLoading || issuesLoading
  const error = projectsError || issuesError

  // Count total issues shown
  const totalIssuesShown = Array.from(issuesByProject.values()).reduce(
    (sum, arr) => sum + arr.length,
    0
  )

  return (
    <div
      ref={containerRef}
      className="oss-aggregator-container"
      data-theme={theme}
      data-dark-theme={isDarkTheme ? 'true' : 'false'}
    >
      <div className="oss-aggregator">
        <header className="oss-aggregator__header">
          <h1 className="oss-aggregator__title">OSS Issue Aggregator</h1>

          <div className="oss-aggregator__controls">
            <button
              className={`refresh-button ${issuesLoading ? 'refresh-button--loading' : ''}`}
              onClick={() => {
                void refetch()
              }}
              disabled={issuesLoading}
            >
              <span className="refresh-button__icon">↻</span>
              <span>Refresh</span>
            </button>

            <ConnectedThemePicker
              themeFamilies={THEME_FAMILIES}
              currentTheme={theme}
              onThemeChange={setTheme}
              getThemeIcon={(themeName: string) => {
                const Icon = THEME_ICON_MAP[themeName as keyof typeof THEME_ICON_MAP]
                return Icon ? <Icon /> : null
              }}
            />
          </div>
        </header>

        <div className="oss-aggregator__body">
          <aside className="oss-aggregator__sidebar">
            <h2 className="oss-aggregator__sidebar-title">Select Projects</h2>
            <ProjectSelector
              projects={projects}
              selectedProjects={selectedProjectSlugs}
              onSelectionChange={setSelectedProjectSlugs}
              disabled={isLoading}
            />
          </aside>

          <main className="oss-aggregator__main">
            {isLoading && issues.length === 0 ? (
              <div className="project-grid">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="project-card">
                    <div className="project-card__header">
                      <div className="skeleton-line skeleton-card__icon" />
                      <div className="skeleton-line skeleton-card__title" />
                      <div className="skeleton-line skeleton-card__count" />
                    </div>
                    {Array.from({ length: 3 }, (_, j) => (
                      <div key={j} className="skeleton-card__issue">
                        <div className="skeleton-line skeleton-card__issue-title" />
                        <div className="skeleton-card__issue-meta">
                          <div className="skeleton-line skeleton-card__badge" />
                          <div className="skeleton-line skeleton-card__date" />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : error ? (
              <ErrorState
                message={error}
                onRetry={() => {
                  void refetch()
                }}
              />
            ) : selectedProjects.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state__icon">📋</div>
                <p className="empty-state__message">
                  Select projects from the sidebar to view issues.
                </p>
              </div>
            ) : (
              <div className="project-grid">
                {selectedProjects.map(project => (
                  <ProjectIssueCard
                    key={project.slug}
                    project={project}
                    issues={issuesByProject.get(project.name) ?? []}
                  />
                ))}
              </div>
            )}
          </main>
        </div>

        <Footer
          issueCount={totalIssuesShown}
          projectCount={selectedProjects.length}
          lastFetched={lastFetched}
          errorCount={fetchErrors.length}
        />
      </div>
    </div>
  )
}
