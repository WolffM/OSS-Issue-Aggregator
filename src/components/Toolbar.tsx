import type { SortField, IssueFilters } from '../hooks/useIssueFilters'

interface ToolbarProps {
  viewMode: 'table' | 'cards'
  onViewModeChange: (mode: 'table' | 'cards') => void
  sortField: SortField
  sortDirection: 'asc' | 'desc'
  onSort: (field: SortField) => void
  filters: IssueFilters
  onFiltersChange: (filters: IssueFilters) => void
  issueCount: number
  searchQuery: string
  onSearchChange: (query: string) => void
}

export function Toolbar({
  viewMode,
  onViewModeChange,
  sortField,
  sortDirection,
  onSort,
  filters,
  onFiltersChange,
  issueCount,
  searchQuery,
  onSearchChange
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar__left">
        <div className="toolbar__view-toggle">
          <button
            type="button"
            className={`toolbar__view-btn ${viewMode === 'table' ? 'toolbar__view-btn--active' : ''}`}
            onClick={() => onViewModeChange('table')}
            title="Table view"
          >
            ≡
          </button>
          <button
            type="button"
            className={`toolbar__view-btn ${viewMode === 'cards' ? 'toolbar__view-btn--active' : ''}`}
            onClick={() => onViewModeChange('cards')}
            title="Card view"
          >
            ⊞
          </button>
        </div>

        <input
          type="text"
          className="toolbar__search"
          placeholder="Search issues..."
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
        />
      </div>

      <div className="toolbar__right">
        <select
          className="toolbar__filter-select"
          value={filters.tiers.length === 0 ? '' : filters.tiers[0]}
          onChange={e => {
            const val = e.target.value
            onFiltersChange({
              ...filters,
              tiers: val ? [val as IssueFilters['tiers'][number]] : []
            })
          }}
        >
          <option value="">All Tiers</option>
          <option value="go">Go</option>
          <option value="likely">Likely</option>
          <option value="maybe">Maybe</option>
          <option value="risky">Risky</option>
          <option value="skip">Skip</option>
        </select>

        <select
          className="toolbar__filter-select"
          value={filters.lifecycleStages.length === 0 ? '' : filters.lifecycleStages[0]}
          onChange={e => {
            const val = e.target.value
            onFiltersChange({
              ...filters,
              lifecycleStages: val ? [val as IssueFilters['lifecycleStages'][number]] : []
            })
          }}
        >
          <option value="">All Stages</option>
          <option value="fresh">Fresh</option>
          <option value="triaged">Triaged</option>
          <option value="accepted">Accepted</option>
          <option value="stale">Stale</option>
          <option value="zombie">Zombie</option>
        </select>

        <select
          className="toolbar__filter-select"
          value={filters.complexities.length === 0 ? '' : filters.complexities[0]}
          onChange={e => {
            const val = e.target.value
            onFiltersChange({
              ...filters,
              complexities: val ? [val as IssueFilters['complexities'][number]] : []
            })
          }}
        >
          <option value="">All Complexity</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>

        <select
          className="toolbar__sort-select"
          value={`${sortField}-${sortDirection}`}
          onChange={e => {
            const [field] = e.target.value.split('-') as [SortField]
            onSort(field)
          }}
        >
          <option value="cvs-desc">CVS (High → Low)</option>
          <option value="cvs-asc">CVS (Low → High)</option>
          <option value="createdAt-desc">Newest First</option>
          <option value="createdAt-asc">Oldest First</option>
          <option value="competition-asc">Least Competition</option>
          <option value="complexity-asc">Easiest First</option>
        </select>

        <span className="toolbar__count">{issueCount} issues</span>
      </div>
    </div>
  )
}
