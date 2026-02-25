/**
 * Shared utilities for OSS Issues API adapters
 */

// ============================================================================
// HTTP Utilities
// ============================================================================

const DEFAULT_USER_AGENT = 'oss-issue-aggregator'

// Some sites block simple user agents, use browser-like UA
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export function buildHeaders(options?: {
  accept?: string
  userAgent?: 'default' | 'browser'
  auth?: string
}): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': options?.userAgent === 'browser' ? BROWSER_USER_AGENT : DEFAULT_USER_AGENT
  }

  if (options?.accept) {
    headers.Accept = options.accept
  }

  if (options?.auth) {
    headers.Authorization = options.auth
  }

  return headers
}

export function checkApiResponse(res: Response, platform: string): void {
  if (!res.ok) {
    throw new Error(`${platform} API error: ${res.status} ${res.statusText}`)
  }
}

export function validateJsonResponse(res: Response, platform: string): void {
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error(
      `${platform} returned non-JSON response (${contentType}). The server may be blocking automated requests.`
    )
  }
}

export function validateNotHtml(text: string, platform: string): void {
  const trimmed = text.trim().toLowerCase()
  if (trimmed.startsWith('<!') || trimmed.startsWith('<html') || trimmed.startsWith('<head')) {
    throw new Error(
      `${platform} returned HTML instead of expected data. The server may be blocking automated requests.`
    )
  }
}

// ============================================================================
// Date Utilities
// ============================================================================

/**
 * Parse various date formats to ISO 8601 string.
 * Handles: ISO strings, Unix timestamps (seconds), locale strings like "Jan 16, 2019"
 */
export function parseDate(value: string | number): string {
  // Unix timestamp in seconds
  if (typeof value === 'number') {
    return new Date(value * 1000).toISOString()
  }

  // Already ISO format or parseable string
  try {
    const date = new Date(value)
    if (!isNaN(date.getTime())) {
      return date.toISOString()
    }
  } catch {
    // Fall through
  }

  // Return original if unparseable
  return value
}

// ============================================================================
// Collection Utilities
// ============================================================================

/**
 * Deduplicate items by a key extractor function.
 */
export function deduplicateBy<T, K>(items: T[], keyFn: (item: T) => K): T[] {
  const seen = new Set<K>()
  const result: T[] = []

  for (const item of items) {
    const key = keyFn(item)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }

  return result
}

// ============================================================================
// CSV Parsing (for Trac)
// ============================================================================

export function parseCSVLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
    } else {
      current += char
    }
  }
  values.push(current)

  return values
}

export function parseCSV<T>(csvText: string): T[] {
  const lines = csvText.trim().split('\n')
  if (lines.length < 2) return []

  const header = parseCSVLine(lines[0])
  const records: T[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    const record: Record<string, string> = {}
    for (let j = 0; j < header.length; j++) {
      record[header[j]] = values[j] || ''
    }
    records.push(record as unknown as T)
  }

  return records
}
