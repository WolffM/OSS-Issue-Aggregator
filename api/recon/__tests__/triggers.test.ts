import { describe, it, expect, vi, beforeEach } from 'vitest'
import { triggerScrape } from '../triggers'

describe('triggerScrape', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends POST to scraper API with slug and default data types', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    const result = await triggerScrape('https://scraper.example.com', 'fastify-fastify')

    expect(result).toEqual({ triggered: true })
    expect(mockFetch).toHaveBeenCalledOnce()

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://scraper.example.com/api/v1/oss-recon/scrape')
    expect(options.method).toBe('POST')

    const body = JSON.parse(options.body)
    expect(body.slug).toBe('fastify-fastify')
    expect(body.data_types).toEqual(['issues', 'prs', 'meta', 'comments'])
  })

  it('sends Authorization header when apiKey is provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    await triggerScrape('https://scraper.example.com', 'fastify-fastify', undefined, 'test-key-123')

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Authorization']).toBe('Bearer test-key-123')
  })

  it('includes data_types when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    await triggerScrape('https://scraper.example.com', 'fastify-fastify', ['issues', 'prs', 'meta'])

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.data_types).toEqual(['issues', 'prs', 'meta'])
  })

  it('returns error when scraper returns non-ok status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal('fetch', mockFetch)

    const result = await triggerScrape('https://scraper.example.com', 'fastify-fastify')

    expect(result.triggered).toBe(false)
    expect(result.error).toContain('503')
  })

  it('returns error on network failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'))
    vi.stubGlobal('fetch', mockFetch)

    const result = await triggerScrape('https://scraper.example.com', 'fastify-fastify')

    expect(result.triggered).toBe(false)
    expect(result.error).toBe('Connection refused')
  })
})
