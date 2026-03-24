import type {
  RepoHealthResponse,
  ScoredIssuesResponse,
  DossierResponse,
  AllScoredIssuesResponse,
  AggregateVersionResponse,
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

  async health(): Promise<{ status: string }> {
    return this.fetch('/health')
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

  async getAllScoredIssues(params?: {
    includeKilled?: boolean
    sort?: string
    dir?: 'asc' | 'desc'
    offset?: number
    limit?: number
  }): Promise<AllScoredIssuesResponse> {
    const searchParams = new URLSearchParams()
    if (params?.includeKilled) searchParams.set('includeKilled', 'true')
    if (params?.sort) searchParams.set('sort', params.sort)
    if (params?.dir) searchParams.set('dir', params.dir)
    if (params?.offset !== undefined) searchParams.set('offset', String(params.offset))
    if (params?.limit !== undefined) searchParams.set('limit', String(params.limit))
    const query = searchParams.toString()
    return this.fetch<AllScoredIssuesResponse>(
      `/recon/all-scored-issues${query ? `?${query}` : ''}`
    )
  }

  async getAggVersion(): Promise<AggregateVersionResponse> {
    return this.fetch<AggregateVersionResponse>('/recon/all-scored-issues/version')
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
