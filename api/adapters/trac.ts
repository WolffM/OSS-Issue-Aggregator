import type { Issue, ProjectConfig } from '../types'
import {
  buildHeaders,
  checkApiResponse,
  parseDate,
  validateNotHtml,
  parseCSV,
  deduplicateBy
} from '../utils'
import { normalizeToIssue } from './normalize'

interface TracTicket {
  id: string
  Summary: string
  Status: string
  Keywords: string
  Reporter: string
  Created: string
  Modified: string
  Type: string
  Priority: string
  Component: string
}

export async function fetchTracIssues(config: ProjectConfig): Promise<Issue[]> {
  // Trac query API with CSV format
  // Build query for each beginner label (keywords contain)
  let allTickets: TracTicket[] = []

  for (const label of config.beginnerLabels) {
    // ~keyword means "contains" in Trac query syntax
    const url = `${config.apiBase}?status=new&status=open&status=assigned&keywords=~${encodeURIComponent(label)}&format=csv&col=id&col=summary&col=status&col=keywords&col=reporter&col=time&col=changetime&col=type&col=priority&col=component&max=100`

    const res = await fetch(url, {
      headers: buildHeaders({ accept: 'text/csv', userAgent: 'browser' })
    })
    checkApiResponse(res, 'Trac')

    const csvText = await res.text()
    validateNotHtml(csvText, 'Trac')

    const tickets = parseCSV<TracTicket>(csvText)
    allTickets.push(...tickets)
  }

  // Deduplicate by ticket ID
  allTickets = deduplicateBy(allTickets, ticket => ticket.id)

  return allTickets.map(ticket => {
    // Build labels from keywords, type, priority, component
    const labels: string[] = []
    if (ticket.Keywords) {
      labels.push(...ticket.Keywords.split(/[\s,]+/).filter(Boolean))
    }
    if (ticket.Type) labels.push(ticket.Type)
    if (ticket.Priority && ticket.Priority !== 'normal') labels.push(ticket.Priority)
    if (ticket.Component) labels.push(ticket.Component)

    // Construct ticket URL from API base
    const baseUrl = config.apiBase.replace('/query', '').replace(/\/$/, '')

    return normalizeToIssue('trac', config, {
      number: ticket.id,
      title: ticket.Summary,
      url: `${baseUrl}/ticket/${ticket.id}`,
      labels,
      createdAt: parseDate(ticket.Created),
      updatedAt: parseDate(ticket.Modified),
      author: ticket.Reporter || 'unknown'
    })
  })
}
