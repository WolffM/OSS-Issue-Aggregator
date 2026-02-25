import type { Issue, ProjectConfig } from '../types'
import { buildHeaders, checkApiResponse, validateJsonResponse } from '../utils'
import { normalizeToIssue } from './normalize'

interface BugzillaBug {
  id: number
  summary: string
  status: string
  creation_time: string
  last_change_time: string
  creator: string
  keywords: string[]
  component: string
  product: string
  severity: string
  priority: string
}

interface BugzillaResponse {
  bugs: BugzillaBug[]
}

export async function fetchBugzillaIssues(config: ProjectConfig): Promise<Issue[]> {
  // Bugzilla REST API - fetch bugs with specific keywords
  const keywords = config.beginnerLabels.join(',')
  const url = `${config.apiBase}/bug?keywords=${encodeURIComponent(keywords)}&status=NEW&status=ASSIGNED&status=REOPENED&limit=100`

  const res = await fetch(url, {
    headers: buildHeaders({ accept: 'application/json', userAgent: 'browser' })
  })
  checkApiResponse(res, 'Bugzilla')
  validateJsonResponse(res, 'Bugzilla')

  const data: BugzillaResponse = await res.json()

  return data.bugs.map(bug => {
    // Combine keywords with component/product for labels
    const labels = [...bug.keywords]
    if (bug.component) labels.push(bug.component)
    if (bug.severity && bug.severity !== 'normal') labels.push(bug.severity)

    return normalizeToIssue('bugzilla', config, {
      number: bug.id,
      title: bug.summary,
      url: `${config.apiBase.replace('/rest', '')}/show_bug.cgi?id=${bug.id}`,
      labels,
      createdAt: bug.creation_time,
      updatedAt: bug.last_change_time,
      author: bug.creator
    })
  })
}
