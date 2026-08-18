import { useRef, useState, useMemo, useEffect, useCallback, type RefObject } from 'react'
import { AppHeader, LoadingSkeleton } from '@wolffm/task-ui-components'
import { useHadokuTheme, HadokuThemeRoot } from '@wolffm/themes'
import { useAllScoredIssues } from './hooks/useAllScoredIssues'
import { useRepoHealth } from './hooks/useRepoHealth'
import { useIssueFilters } from './hooks/useIssueFilters'
import { useClaim } from './hooks/useClaim'
import {
  ProjectSelector,
  IssueTable,
  IssueCardGrid,
  Toolbar,
  IssueDetailDrawer,
  DossierDrawer,
  RepoHealthPanel,
  ErrorState,
  Footer
} from './components'
import { ossIssuesClient } from './api/client'
import { loadAggregatorPrefs, saveAggregatorPrefs } from './prefs/aggregatorPrefs'
import { repoNameFor } from './utils/repoName'
import type { ScoredIssue } from './api/types'
import type { OssAggregatorProps } from './entry'

/**
 * Provider boundary. Theme state belongs to the platform (@wolffm/themes),
 * not to this app — the local hooks/useTheme.ts, prefs/themePrefs.ts and
 * app/themeConfig.tsx copies are gone. AppHeader renders the shared picker
 * from this context, so nothing below passes one.
 */
export default function App(props: OssAggregatorProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null)
  return (
    <HadokuThemeRoot theme={props.theme} containerRef={containerRef}>
      <AppInner {...props} containerRef={containerRef} />
    </HadokuThemeRoot>
  )
}

function AppInner(props: OssAggregatorProps & { containerRef: RefObject<HTMLDivElement | null> }) {
  const { containerRef } = props
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [selectedProjectSlugs, setSelectedProjectSlugs] = useState<string[]>([])
  const [hasInitializedDefaults, setHasInitializedDefaults] = useState(false)
  // Selected-projects persisted in the unified prefs store (async). We gate the
  // default-selection logic on this load so a fresh device pulls the saved
  // selection instead of briefly flashing "all selected".
  const [savedSelections, setSavedSelections] = useState<string[] | null>(null)
  const [savedSelectionsLoaded, setSavedSelectionsLoaded] = useState(false)
  const knownSlugsRef = useRef<Set<string>>(new Set())
  const [focusedRepo, setFocusedRepo] = useState<string | null>(null)
  const [versionProjects, setVersionProjects] = useState<{ slug: string; name: string }[]>([])

  // Drawer state
  const [selectedIssue, setSelectedIssue] = useState<ScoredIssue | null>(null)
  const [issueDrawerOpen, setIssueDrawerOpen] = useState(false)
  const [dossierSlug, setDossierSlug] = useState<string | null>(null)
  const [dossierDrawerOpen, setDossierDrawerOpen] = useState(false)

  const [systemPrefersDark] = useState(() => {
    if (window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  })

  // Theme comes from <HadokuThemeRoot> above — one implementation for
  // every app, instead of this repo's former hooks/useTheme.ts copy.
  const { theme, isDarkTheme, isThemeReady, isInitialThemeLoad } = useHadokuTheme()

  // Data hooks
  const {
    filters,
    setFilters,
    sortField,
    sortDirection,
    setSort,
    searchQuery,
    setSearchQuery,
    viewMode,
    setViewMode,
    applyFiltersAndSort
  } = useIssueFilters()

  const {
    issues: allIssues,
    isLoading: issuesLoading,
    isLoadingMore,
    error: issuesError,
    repoCount,
    lastFetched,
    hasMore,
    loadMore,
    refetch
  } = useAllScoredIssues(filters.includeKilled, sortField, sortDirection)

  const {
    health: focusedHealth,
    isPending: focusedHealthPending,
    isLoading: focusedHealthLoading
  } = useRepoHealth(focusedRepo)

  const { claim, unclaim } = useClaim(refetch)

  // Load the persisted selected-projects from the unified prefs store (async;
  // also runs the one-shot legacy-localStorage migration).
  useEffect(() => {
    let cancelled = false
    void loadAggregatorPrefs().then(prefs => {
      if (cancelled) return
      setSavedSelections(prefs.selectedProjects ?? null)
      setSavedSelectionsLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch full project list from version endpoint on mount
  useEffect(() => {
    ossIssuesClient
      .getAggVersion()
      .then(res => {
        if (res.data.projects?.length) setVersionProjects(res.data.projects)
      })
      .catch(() => {
        // Non-critical: fall back to deriving projects from paginated issues
      })
  }, [])

  // Merge version projects (complete list) with issue-derived projects (incremental)
  const derivedProjects = useMemo(() => {
    const seen = new Map<string, string>()
    for (const p of versionProjects) seen.set(p.slug, p.name)
    for (const issue of allIssues) {
      if (!seen.has(issue.repoSlug)) {
        seen.set(issue.repoSlug, issue.project)
      }
    }
    return [...seen.entries()].map(([slug, name]) => ({ slug, name }))
  }, [versionProjects, allIssues])

  // Slug -> `owner/repo`. Slugs join both halves with a hyphen and either half may
  // contain one, so the split point only survives in the project name the API sends.
  const projectNames = useMemo(
    () => new Map(derivedProjects.map(p => [p.slug, p.name])),
    [derivedProjects]
  )

  // Initialize selected projects from the prefs store or select all.
  // Also auto-select newly discovered projects from infinite scroll
  // when all previously known projects are already selected.
  useEffect(() => {
    if (derivedProjects.length === 0) return
    // Wait for the persisted selection to load before deciding defaults, so we
    // don't flash "all selected" then snap to the saved subset.
    if (!savedSelectionsLoaded) return

    if (!hasInitializedDefaults) {
      const savedSlugs = savedSelections
      const allSlugs = derivedProjects.map(p => p.slug)

      // Track all initially known slugs
      for (const slug of allSlugs) knownSlugsRef.current.add(slug)

      if (savedSlugs && savedSlugs.length > 0) {
        const validSlugs = savedSlugs.filter(slug => derivedProjects.some(p => p.slug === slug))
        if (validSlugs.length > 0) {
          setSelectedProjectSlugs(validSlugs)
          setHasInitializedDefaults(true)
          return
        }
      }

      // Default: select all projects
      setSelectedProjectSlugs(allSlugs)
      setHasInitializedDefaults(true)
      return
    }

    // Find slugs that are genuinely new (not previously seen at all)
    const trulyNewSlugs = derivedProjects
      .map(p => p.slug)
      .filter(slug => !knownSlugsRef.current.has(slug))

    if (trulyNewSlugs.length > 0) {
      // Track these as known now
      for (const slug of trulyNewSlugs) knownSlugsRef.current.add(slug)

      // Only auto-add if every previously known project is still selected
      // (i.e., user hasn't manually deselected anything)
      const allPreviousSelected = [...knownSlugsRef.current]
        .filter(slug => !trulyNewSlugs.includes(slug))
        .every(slug => selectedProjectSlugs.includes(slug))

      if (allPreviousSelected) {
        setSelectedProjectSlugs(prev => [...prev, ...trulyNewSlugs])
      }
    }
  }, [
    derivedProjects,
    hasInitializedDefaults,
    selectedProjectSlugs,
    savedSelectionsLoaded,
    savedSelections
  ])

  useEffect(() => {
    if (hasInitializedDefaults && selectedProjectSlugs.length >= 0) {
      saveAggregatorPrefs({ selectedProjects: selectedProjectSlugs })
    }
  }, [selectedProjectSlugs, hasInitializedDefaults])

  // Infinite scroll: observe sentinel element
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting && hasMore && !issuesLoading && !isLoadingMore) {
          loadMore()
        }
      },
      { rootMargin: '200px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, issuesLoading, isLoadingMore, loadMore])

  // Filter issues by selected projects, then apply toolbar filters
  const displayIssues = useMemo(() => {
    const selectedSet = new Set(selectedProjectSlugs)

    const projectFiltered =
      selectedSet.size === 0 ? [] : allIssues.filter(issue => selectedSet.has(issue.repoSlug))

    return applyFiltersAndSort(projectFiltered)
  }, [allIssues, selectedProjectSlugs, applyFiltersAndSort])

  // Drawer handlers
  const handleIssueClick = useCallback((issue: ScoredIssue) => {
    setSelectedIssue(issue)
    setIssueDrawerOpen(true)
  }, [])

  const handleRepoClick = useCallback((slug: string) => {
    setDossierSlug(slug)
    setDossierDrawerOpen(true)
  }, [])

  const handleClaimIssue = useCallback(
    (issueId: string, slug: string) => {
      // In a real app, we'd prompt for username. For now, use a placeholder.
      void claim(slug, issueId, 'current-user')
      setIssueDrawerOpen(false)
    },
    [claim]
  )

  const handleUnclaimIssue = useCallback(
    (issueId: string, slug: string) => {
      void unclaim(slug, issueId)
      setIssueDrawerOpen(false)
    },
    [unclaim]
  )

  const handleViewDossierFromDetail = useCallback((slug: string) => {
    setIssueDrawerOpen(false)
    setDossierSlug(slug)
    setDossierDrawerOpen(true)
  }, [])

  if (isInitialThemeLoad && !isThemeReady) {
    return <LoadingSkeleton isDarkTheme={systemPrefersDark} />
  }

  const isLoading = issuesLoading
  const error = issuesError

  return (
    <div
      ref={containerRef}
      className="oss-aggregator-container"
      data-theme={theme}
      data-dark-theme={isDarkTheme ? 'true' : 'false'}
    >
      <div className="oss-aggregator">
        <AppHeader title="OSS Recon Dashboard" />

        <div className="oss-aggregator__actions">
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
        </div>

        <div className="oss-aggregator__body">
          <aside className="oss-aggregator__sidebar">
            <h2 className="oss-aggregator__sidebar-title">Projects</h2>
            <ProjectSelector
              projects={derivedProjects}
              selectedProjects={selectedProjectSlugs}
              onSelectionChange={setSelectedProjectSlugs}
              disabled={isLoading}
              focusedRepo={focusedRepo}
              onFocusRepo={setFocusedRepo}
            />
            <RepoHealthPanel
              health={focusedHealth}
              isLoading={focusedHealthLoading}
              isPending={focusedHealthPending}
              slug={focusedRepo}
              repo={focusedRepo ? repoNameFor(focusedRepo, projectNames) : ''}
              onViewDossier={handleRepoClick}
            />
          </aside>

          <main className="oss-aggregator__main">
            {error ? (
              <ErrorState
                message={error}
                onRetry={() => {
                  void refetch()
                }}
              />
            ) : (
              <>
                <Toolbar
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={setSort}
                  filters={filters}
                  onFiltersChange={setFilters}
                  issueCount={displayIssues.length}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                />

                {isLoading && allIssues.length === 0 ? (
                  <div className="issue-table-wrapper">
                    <div className="loading-state">
                      <div className="loading-state__spinner" />
                      <span className="loading-state__text">Loading scored issues...</span>
                    </div>
                  </div>
                ) : viewMode === 'table' ? (
                  <IssueTable
                    issues={displayIssues}
                    onIssueClick={handleIssueClick}
                    onRepoClick={handleRepoClick}
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={setSort}
                  />
                ) : (
                  <IssueCardGrid
                    issues={displayIssues}
                    onIssueClick={handleIssueClick}
                    onRepoClick={handleRepoClick}
                  />
                )}

                {/* Scroll sentinel for infinite loading */}
                <div ref={sentinelRef} className="scroll-sentinel" />
                {isLoadingMore && (
                  <div className="loading-more">
                    <div className="loading-state__spinner" />
                    <span className="loading-more__text">Loading more issues...</span>
                  </div>
                )}
              </>
            )}
          </main>
        </div>

        <Footer
          issueCount={displayIssues.length}
          projectCount={repoCount}
          lastFetched={lastFetched}
          errorCount={0}
        />
      </div>

      <IssueDetailDrawer
        issue={selectedIssue}
        isOpen={issueDrawerOpen}
        onClose={() => setIssueDrawerOpen(false)}
        onClaim={handleClaimIssue}
        onUnclaim={handleUnclaimIssue}
        onViewDossier={handleViewDossierFromDetail}
      />

      <DossierDrawer
        slug={dossierSlug}
        repo={dossierSlug ? repoNameFor(dossierSlug, projectNames) : ''}
        isOpen={dossierDrawerOpen}
        onClose={() => setDossierDrawerOpen(false)}
      />
    </div>
  )
}
