/**
 * Scraper API Trigger
 *
 * Fire-and-forget POST to the hadoku-scraper API to trigger a re-scrape.
 * The aggregator doesn't wait for the scraper to complete.
 */

export async function triggerScrape(
  scraperApiUrl: string,
  slug: string,
  dataTypes?: string[]
): Promise<{ triggered: boolean; error?: string }> {
  try {
    const body: Record<string, unknown> = { slug }
    if (dataTypes) {
      body.data_types = dataTypes
    }

    const res = await fetch(`${scraperApiUrl}/api/v1/oss-recon/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
