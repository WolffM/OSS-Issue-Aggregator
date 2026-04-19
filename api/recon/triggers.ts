/**
 * Scraper API Trigger
 *
 * Fire-and-forget POST to the hadoku-scraper API to trigger a re-scrape.
 * The aggregator doesn't wait for the scraper to complete.
 */

const DEFAULT_DATA_TYPES = ['issues', 'prs', 'meta', 'comments']

export async function triggerScrape(
  scraperApiUrl: string,
  slug: string,
  dataTypes: string[] = DEFAULT_DATA_TYPES,
  apiKey?: string,
  force = false
): Promise<{ triggered: boolean; error?: string }> {
  try {
    const body: Record<string, unknown> = { slug, data_types: dataTypes }
    if (force) body.force = true

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const res = await fetch(`${scraperApiUrl}/api/v1/oss-recon/scrape`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      return { triggered: false, error: `Scraper returned ${res.status}` }
    }

    return { triggered: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return { triggered: false, error: msg }
  }
}
