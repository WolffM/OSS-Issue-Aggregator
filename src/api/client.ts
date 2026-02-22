import type {
  IssuesResponse,
  ProjectsResponse,
  ProjectIssuesResponse,
  WatchlistResponse,
  WatchlistAddResponse,
  WatchlistRemoveResponse,
  RepoHealthResponse,
  ScoredIssuesResponse,
  DossierResponse,
  AllScoredIssuesResponse,
  ClaimResponse,
  UnclaimResponse,
  RefreshResponse
} from './types'

// Base URL for API calls
// In production: https://hadoku.me/oss/api
// In development: http://localhost:8787/oss/api (if running worker locally)
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) || 'https://hadoku.me/oss/api'

class OssIssuesClient {
  private baseUrl: string

  constructor(baseUrl = API_BASE) {
    this.baseUrl = baseUrl
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`)

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({ error: 'Unknown error' }))) as {
        error?: string
      }
      throw new Error(errorData.error ?? `HTTP ${response.status}`)
    }

    return response.json() as Promise<T>
  }

  private async post<T>(endpoint: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({ error: 'Unknown error' }))) as {
        error?: string
      }
      throw new Error(errorData.error ?? `HTTP ${response.status}`)
    }

    return response.json() as Promise<T>
  }

  // ---- Legacy endpoints ----

  async getProjects(): Promise<ProjectsResponse> {
    return this.fetch<ProjectsResponse>('/projects')
  }

  async getIssues(pool = 'all'): Promise<IssuesResponse> {
    return this.fetch<IssuesResponse>(`/issues?pool=${encodeURIComponent(pool)}`)
  }

  async getProjectIssues(slug: string): Promise<ProjectIssuesResponse> {
    return this.fetch<ProjectIssuesResponse>(`/issues/${encodeURIComponent(slug)}`)
  }

  async health(): Promise<{ status: string }> {
    return this.fetch('/health')
  }

  // ---- Recon: Watchlist ----

  async getWatchlist(): Promise<WatchlistResponse> {
    return this.fetch<WatchlistResponse>('/recon/watchlist')
  }

  async addToWatchlist(slug: string): Promise<WatchlistAddResponse> {
    return this.post<WatchlistAddResponse>('/recon/watchlist/add', { slug })
  }

  async removeFromWatchlist(slug: string): Promise<WatchlistRemoveResponse> {
    return this.post<WatchlistRemoveResponse>('/recon/watchlist/remove', { slug })
  }

  // ---- Recon: Per-repo data ----

  async getRepoHealth(slug: string): Promise<RepoHealthResponse> {
    return this.fetch<RepoHealthResponse>(`/recon/${encodeURIComponent(slug)}/health`)
  }

  async getScoredIssues(slug: string): Promise<ScoredIssuesResponse> {
    return this.fetch<ScoredIssuesResponse>(`/recon/${encodeURIComponent(slug)}/scored-issues`)
  }

  async getDossier(slug: string): Promise<DossierResponse> {
    return this.fetch<DossierResponse>(`/recon/${encodeURIComponent(slug)}/dossier`)
  }

  // ---- Recon: Aggregate ----

  async getAllScoredIssues(includeKilled = false): Promise<AllScoredIssuesResponse> {
    const query = includeKilled ? '?includeKilled=true' : ''
    return this.fetch<AllScoredIssuesResponse>(`/recon/all-scored-issues${query}`)
  }

  // ---- Recon: Claims ----

  async claimIssue(
    slug: string,
    issueId: string,
    claimedBy: string,
    forkIssueUrl?: string
  ): Promise<ClaimResponse> {
    return this.post<ClaimResponse>(`/recon/${encodeURIComponent(slug)}/claim`, {
      issueId,
      claimedBy,
      ...(forkIssueUrl && { forkIssueUrl })
    })
  }

  async unclaimIssue(slug: string, issueId: string): Promise<UnclaimResponse> {
    return this.post<UnclaimResponse>(`/recon/${encodeURIComponent(slug)}/unclaim`, { issueId })
  }

  // ---- Recon: Triggers ----

  async refreshRepo(slug: string): Promise<RefreshResponse> {
    return this.post<RefreshResponse>(`/recon/${encodeURIComponent(slug)}/refresh`, {})
  }
}

// Singleton instance
export const ossIssuesClient = new OssIssuesClient()

// Export class for custom instances
export { OssIssuesClient }
