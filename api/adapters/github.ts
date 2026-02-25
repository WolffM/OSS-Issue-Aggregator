import type { Issue, ProjectConfig } from '../types'
import { buildHeaders, deduplicateBy } from '../utils'
import { normalizeToIssue } from './normalize'

interface GitHubIssue {
  id: number
  number: number
  title: string
  body: string | null
  html_url: string
  labels: { name: string }[]
  created_at: string
  updated_at: string
  user: { login: string } | null
  pull_request?: unknown
}

export async function fetchGitHubIssues(config: ProjectConfig, token?: string): Promise<Issue[]> {
  const headers = buildHeaders({
    accept: 'application/vnd.github.v3+json',
    auth: token ? `token ${token}` : undefined
  })

  // GitHub's labels param uses AND logic, so we need to fetch each label separately
  // and merge the results to get OR behavior
  let allIssues: GitHubIssue[] = []

  for (const label of config.beginnerLabels) {
    const url = `${config.apiBase}/repos/${config.projectId}/issues?labels=${encodeURIComponent(label)}&state=open&per_page=100`
    const res = await fetch(url, { headers })

    if (!res.ok) {
      const errorBody = await res.text()
      console.error(`GitHub API error for ${config.projectId}: ${res.status} - ${errorBody}`)
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`)
    }

    const data: GitHubIssue[] = await res.json()
    allIssues.push(...data)
  }

  // Deduplicate (an issue might have multiple beginner labels)
  allIssues = deduplicateBy(allIssues, issue => issue.id)

  // Filter out pull requests (GitHub returns PRs in issues endpoint)
  const issues = allIssues.filter(item => !item.pull_request)

  return issues.map(issue =>
    normalizeToIssue('github', config, {
      number: issue.number,
      title: issue.title,
      body: issue.body || undefined,
      url: issue.html_url,
      labels: issue.labels.map(l => l.name),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      author: issue.user?.login ?? 'unknown'
    })
  )
}
