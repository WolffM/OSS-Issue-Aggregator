import type { Issue, ProjectConfig } from '../types'
import { buildHeaders, checkApiResponse } from '../utils'
import { normalizeToIssue } from './normalize'

interface GitLabIssue {
  id: number
  iid: number
  title: string
  description: string | null
  web_url: string
  labels: string[]
  created_at: string
  updated_at: string
  author: { username: string } | null
}

export async function fetchGitLabIssues(config: ProjectConfig): Promise<Issue[]> {
  const projectId = encodeURIComponent(config.projectId)
  const labels = config.beginnerLabels.join(',')
  const url = `${config.apiBase}/projects/${projectId}/issues?labels=${encodeURIComponent(labels)}&state=opened&per_page=100`

  const res = await fetch(url, { headers: buildHeaders() })
  checkApiResponse(res, 'GitLab')

  const data: GitLabIssue[] = await res.json()

  return data.map(issue =>
    normalizeToIssue('gitlab', config, {
      number: issue.iid,
      title: issue.title,
      body: issue.description || undefined,
      url: issue.web_url,
      labels: issue.labels,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      author: issue.author?.username ?? 'unknown'
    })
  )
}
