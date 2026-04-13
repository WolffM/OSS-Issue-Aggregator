/**
 * GitHub API Fetcher
 *
 * Lightweight helpers for fetching raw file content from GitHub's REST API.
 * Used by crimson-kitty endpoints that need live data not stored in KV.
 *
 * All helpers accept an optional token and return null on any error —
 * callers decide how to handle missing data.
 */

export interface FetchedFile {
  path: string
  content: string
}

export interface GitHubLabel {
  name: string
  color: string
  description: string | null
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

/** Type guard for GitHub file API response. */
function isFileResponse(v: unknown): v is { content: string; encoding: string; path: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'content' in v &&
    'encoding' in v &&
    'path' in v &&
    typeof (v as Record<string, unknown>).content === 'string' &&
    typeof (v as Record<string, unknown>).encoding === 'string' &&
    typeof (v as Record<string, unknown>).path === 'string'
  )
}

/** Type guard for GitHub tree API response. */
function isTreeResponse(v: unknown): v is { tree: { path: string; type: string }[] } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'tree' in v &&
    Array.isArray((v as Record<string, unknown>).tree)
  )
}

/** Type guard for GitHub labels array response. */
function isLabelsArray(
  v: unknown
): v is { name: string; color: string; description: string | null }[] {
  return Array.isArray(v)
}

/**
 * Fetch raw text content of a single file from GitHub.
 * Returns null if the file does not exist or any error occurs.
 */
export async function fetchGitHubFile(
  owner: string,
  repo: string,
  path: string,
  token?: string
): Promise<FetchedFile | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      headers: buildHeaders(token)
    })
    if (!res.ok) return null
    const json: unknown = await res.json()
    if (!isFileResponse(json)) return null
    if (json.encoding !== 'base64' || !json.content) return null
    // GitHub base64 encodes with newlines — strip them before decoding
    const decoded = atob(json.content.replace(/\n/g, ''))
    return { path: json.path, content: decoded }
  } catch {
    return null
  }
}

/**
 * Try multiple paths in order; return the first one that resolves.
 */
export async function fetchFirstExisting(
  owner: string,
  repo: string,
  paths: string[],
  token?: string
): Promise<FetchedFile | null> {
  for (const p of paths) {
    const result = await fetchGitHubFile(owner, repo, p, token)
    if (result) return result
  }
  return null
}

/**
 * Fetch all labels for a repo (up to 100).
 * Returns empty array on error.
 */
export async function fetchGitHubLabels(
  owner: string,
  repo: string,
  token?: string
): Promise<GitHubLabel[]> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/labels?per_page=100`, {
      headers: buildHeaders(token)
    })
    if (!res.ok) return []
    const json: unknown = await res.json()
    if (!isLabelsArray(json)) return []
    return json
  } catch {
    return []
  }
}

/**
 * List paths inside a directory by fetching the repo tree at the default branch.
 * Returns only the paths (strings) that start with dirPrefix.
 * Returns empty array on error.
 */
export async function fetchDirListing(
  owner: string,
  repo: string,
  dirPrefix: string,
  token?: string
): Promise<string[]> {
  try {
    // Use the Git Trees API; the dir listing endpoint works only on the default branch
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
      { headers: buildHeaders(token) }
    )
    if (!res.ok) return []
    const json: unknown = await res.json()
    if (!isTreeResponse(json)) return []
    return json.tree
      .filter(item => item.type === 'blob' && item.path.startsWith(dirPrefix))
      .map(item => item.path)
  } catch {
    return []
  }
}

/**
 * Convert a hyphenated slug (e.g. "microsoft-markitdown") into owner/repo.
 *
 * Strategy: use the RepoMeta owner/repo when available (authoritative).
 * Fallback: the slug is always `owner-repo`, but owner or repo may themselves
 * contain hyphens (e.g. "mermaid-js-mermaid"). Without KV data we can't
 * resolve ambiguity, so we return the slug as-is and let callers surface the gap.
 *
 * This function is only used when meta is unavailable.
 */
export function slugToOwnerRepo(slug: string): { owner: string; repo: string } | null {
  const idx = slug.indexOf('-')
  if (idx === -1) return null
  return { owner: slug.slice(0, idx), repo: slug.slice(idx + 1) }
}
