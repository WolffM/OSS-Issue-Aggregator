/**
 * Tests for crimson-kitty recon endpoints.
 *
 * Uses the same mock-KV + Hono request helper as routes.test.ts.
 * GitHub API calls are intercepted via globalThis.fetch mocking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createReconRoutes } from '../index'
import {
  createMockKV,
  createMockExecutionCtx,
  makeConsolidatedReconData,
  makeRepoMeta
} from './helpers'

// ============================================================================
// Test App
// ============================================================================

function createTestApp(kv: KVNamespace, githubToken?: string) {
  const app = createReconRoutes()

  return {
    request: (path: string, init?: RequestInit) => {
      const req = new Request(`http://localhost${path}`, init)
      return app.fetch(
        req,
        {
          CACHE_KV: kv,
          GITHUB_TOKEN: githubToken
        },
        createMockExecutionCtx()
      )
    }
  }
}

// ============================================================================
// Fetch Mock Helpers
// ============================================================================

function mockFetch(responses: Record<string, { status: number; body: unknown }>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    for (const [pattern, resp] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(resp.body), {
          status: resp.status,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }
    return new Response(null, { status: 404 })
  })
}

function makeBase64File(content: string) {
  return {
    content: btoa(content),
    encoding: 'base64',
    path: ''
  }
}

// ============================================================================
// GET /:slug/contributing
// ============================================================================

describe('GET /:slug/contributing', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns parsed fields from KV contributingContent', async () => {
    const contributing = `# Contributing\n\nWe use DCO sign-off (Signed-off-by). No CLA required.`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ contributingContent: contributing })
      })
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/contributing')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.ai_policy).toBe('unknown')
    expect(body.data.dco_required).toBe(true)
    expect(body.data.license_check_required).toBe(false)
    expect(body.data.raw_excerpt).toContain('Contributing')
    expect(body._meta.served_at).toBeTruthy()
  })

  it('detects banned ai_policy', async () => {
    const contributing = `# Contributing\n\nWe do not accept AI-generated content. No AI submissions.\n\nAI-generated contributions are not allowed.`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ contributingContent: contributing })
      })
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/contributing')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.ai_policy).toBe('banned')
    expect(body.data.matched_phrase).toBeTruthy()
    expect(body.data.matched_in).toBe('contributing')
  })

  it('detects allowed ai_policy', async () => {
    const contributing = `# Contributing\n\nAI-assisted contributions are welcome as long as you review the output.`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ contributingContent: contributing })
      })
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/contributing')
    const body = await res.json()
    expect(body.data.ai_policy).toBe('allowed')
    expect(body.data.matched_phrase).toMatch(/AI-assisted contributions are welcome/i)
    expect(body.data.matched_in).toBe('contributing')
  })

  it('detects disclose_required from must-disclose phrasing', async () => {
    const contributing = `# Contributing\n\nIf you used AI tools, you must disclose it in the PR description.`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ contributingContent: contributing })
      })
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/contributing')
    const body = await res.json()
    expect(body.data.ai_policy).toBe('disclose_required')
    expect(body.data.matched_phrase).toMatch(/must disclose/i)
    expect(body.data.matched_in).toBe('contributing')
  })

  it('detects disclose_required from AGENTS.md pointer (TypeScript-style)', async () => {
    const contributing = `# Notes on Contributing\n\n<!-- CODING AGENTS: READ AGENTS.md BEFORE WRITING CODE -->\n\nAll code changes should follow our guidelines.`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ contributingContent: contributing })
      })
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/contributing')
    const body = await res.json()
    expect(body.data.ai_policy).toBe('disclose_required')
    expect(body.data.matched_phrase).toMatch(/CODING AGENTS/i)
    expect(body.data.matched_in).toBe('contributing')
  })

  it('returns null matched_phrase when policy is unknown', async () => {
    const contributing = `# Contributing\n\nThank you for helping! Please run the tests before submitting a PR.`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ contributingContent: contributing })
      })
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/contributing')
    const body = await res.json()
    expect(body.data.ai_policy).toBe('unknown')
    expect(body.data.matched_phrase).toBeNull()
    expect(body.data.matched_in).toBeNull()
  })

  it('detects CLA requirement', async () => {
    const contributing = `# Contributing\n\nAll contributors must sign the Contributor License Agreement (CLA).`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ contributingContent: contributing })
      })
    })
    const app = createTestApp(kv)

    const res = await app.request('/fastify-fastify/contributing')
    const body = await res.json()
    expect(body.data.license_check_required).toBe(true)
  })

  it('falls back to live GitHub API when contributingContent is null', async () => {
    const content = '# Contributing\n\nSigned-off-by required. Developer Certificate of Origin.'
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ contributingContent: null })
      })
    })
    // Serve 404 for all paths except the bare CONTRIBUTING.md
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url
      // Match the exact path: ends with /contents/CONTRIBUTING.md (no .github prefix)
      if (/\/contents\/CONTRIBUTING\.md$/.test(url)) {
        const b64 = btoa(content)
        return new Response(
          JSON.stringify({ content: b64, encoding: 'base64', path: 'CONTRIBUTING.md' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    })

    const app = createTestApp(kv, 'test-token')
    const res = await app.request('/fastify-fastify/contributing')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.dco_required).toBe(true)
  })

  it('returns unknown policy when no CONTRIBUTING.md found', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ contributingContent: null })
      })
    })
    mockFetch({})
    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/contributing')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.ai_policy).toBe('unknown')
    expect(body.data.matched_phrase).toBeNull()
    expect(body.data.matched_in).toBeNull()
    expect(body.data.raw_excerpt).toBe('')
  })

  it('returns 500 when KV is not configured', async () => {
    const app = createTestApp(undefined as unknown as KVNamespace)
    const res = await app.request('/fastify-fastify/contributing')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
  })
})

// ============================================================================
// GET /:slug/pr-template
// ============================================================================

describe('GET /:slug/pr-template', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns null result when no template found', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ prTemplateContent: null })
      })
    })
    mockFetch({})
    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/pr-template')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.path).toBeNull()
    expect(body.data.raw_text).toBeNull()
    expect(body.data.sections).toEqual([])
    expect(body.data.front_matter).toBeNull()
  })

  it('parses sections from KV prTemplateContent', async () => {
    const template = `## Description\n\nDescribe your changes.\n\n## Related Issue\n\nFixes #\n\n## Testing*\n\nHow did you test?`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ prTemplateContent: template })
      })
    })
    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/pr-template')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.sections).toHaveLength(3)
    expect(body.data.sections[0].heading).toBe('Description')
    expect(body.data.sections[0].required).toBe(false)
    expect(body.data.sections[2].heading).toBe('Testing*')
    expect(body.data.sections[2].required).toBe(true)
  })

  it('parses front matter if present', async () => {
    const template = `---\ntitle: My PR\nlabels: bug\n---\n\n## Description\n\nSome text.`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ prTemplateContent: template })
      })
    })
    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/pr-template')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.front_matter).toMatchObject({ title: 'My PR', labels: 'bug' })
  })

  it('falls back to live GitHub API when prTemplateContent is null', async () => {
    const template = `## Description\n\nDescribe changes.`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData({
        repoMeta: makeRepoMeta({ prTemplateContent: null })
      })
    })
    mockFetch({
      '/repos/fastify/fastify/contents/.github/PULL_REQUEST_TEMPLATE.md': {
        status: 200,
        body: { ...makeBase64File(template), path: '.github/PULL_REQUEST_TEMPLATE.md' }
      }
    })

    const app = createTestApp(kv, 'test-token')
    const res = await app.request('/fastify-fastify/pr-template')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.sections).toHaveLength(1)
    expect(body.data.sections[0].heading).toBe('Description')
  })
})

// ============================================================================
// GET /:slug/issue-templates
// ============================================================================

describe('GET /:slug/issue-templates', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns empty templates when directory listing is empty', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({
      '/repos/fastify/fastify/git/trees/HEAD': {
        status: 200,
        body: { tree: [] }
      }
    })
    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/issue-templates')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.templates).toEqual([])
  })

  it('parses yaml issue template and extracts name', async () => {
    const yamlContent = `name: Bug Report\ndescription: File a bug\nbody:\n  - type: input\n    id: title\n    attributes:\n      label: Title\n    validations:\n      required: true\n  - type: textarea\n    id: description\n    attributes:\n      label: Description\n`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({
      '/repos/fastify/fastify/git/trees/HEAD': {
        status: 200,
        body: {
          tree: [{ path: '.github/ISSUE_TEMPLATE/bug.yml', type: 'blob' }]
        }
      },
      '/repos/fastify/fastify/contents/.github/ISSUE_TEMPLATE/bug.yml': {
        status: 200,
        body: { ...makeBase64File(yamlContent), path: '.github/ISSUE_TEMPLATE/bug.yml' }
      }
    })

    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/issue-templates')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.templates).toHaveLength(1)
    expect(body.data.templates[0].name).toBe('Bug Report')
    expect(body.data.templates[0].format).toBe('yaml')
    expect(body.data.templates[0].required_fields).toContain('title')
  })

  it('returns empty required_fields for markdown templates', async () => {
    const mdContent = `---\nname: Feature Request\n---\n\n## Description\n\nDescribe the feature.`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({
      '/repos/fastify/fastify/git/trees/HEAD': {
        status: 200,
        body: {
          tree: [{ path: '.github/ISSUE_TEMPLATE/feature.md', type: 'blob' }]
        }
      },
      '/repos/fastify/fastify/contents/.github/ISSUE_TEMPLATE/feature.md': {
        status: 200,
        body: { ...makeBase64File(mdContent), path: '.github/ISSUE_TEMPLATE/feature.md' }
      }
    })

    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/issue-templates')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.templates[0].format).toBe('markdown')
    expect(body.data.templates[0].required_fields).toEqual([])
  })
})

// ============================================================================
// GET /:slug/codeowners
// ============================================================================

describe('GET /:slug/codeowners', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns null path and empty rules when no CODEOWNERS found', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({})
    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/codeowners')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.path).toBeNull()
    expect(body.data.rules).toEqual([])
  })

  it('parses CODEOWNERS rules correctly', async () => {
    const codeownersContent = `# This is a comment\n*.ts @TypeScriptOwner\n/src/ @maintainer1 @maintainer2\ndocs/ docs@example.com\n`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({
      '/repos/fastify/fastify/contents/CODEOWNERS': { status: 404, body: {} },
      '/repos/fastify/fastify/contents/.github/CODEOWNERS': {
        status: 200,
        body: { ...makeBase64File(codeownersContent), path: '.github/CODEOWNERS' }
      }
    })

    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/codeowners')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.path).toBe('.github/CODEOWNERS')
    expect(body.data.rules).toHaveLength(3)
    expect(body.data.rules[0]).toMatchObject({ pattern: '*.ts', owners: ['@TypeScriptOwner'] })
    expect(body.data.rules[1]).toMatchObject({
      pattern: '/src/',
      owners: ['@maintainer1', '@maintainer2']
    })
    expect(body.data.rules[2]).toMatchObject({
      pattern: 'docs/',
      owners: ['docs@example.com']
    })
  })

  it('skips blank lines and comments', async () => {
    const content = `\n# Comment\n\n*.md @docowner\n\n# Another comment\n`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({
      '/repos/fastify/fastify/contents/CODEOWNERS': {
        status: 200,
        body: { ...makeBase64File(content), path: 'CODEOWNERS' }
      }
    })

    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/codeowners')
    const body = await res.json()
    expect(body.data.rules).toHaveLength(1)
    expect(body.data.rules[0].pattern).toBe('*.md')
  })
})

// ============================================================================
// GET /:slug/labels
// ============================================================================

describe('GET /:slug/labels', () => {
  afterEach(() => vi.restoreAllMocks())

  const allLabels = [
    { name: 'bug', color: 'ff0000', description: 'Something broken' },
    { name: 'ai-generated', color: 'e4e669', description: 'AI generated content' },
    { name: 'ai-policy', color: 'fef2c0', description: null },
    { name: 'enhancement', color: '84b6eb', description: null },
    { name: 'no-ai', color: 'ee0701', description: 'No AI contributions' }
  ]

  it('returns all labels when prefix is empty string', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({
      '/repos/fastify/fastify/labels': { status: 200, body: allLabels }
    })

    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/labels?prefix=')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.prefix).toBe('')
    expect(body.data.labels).toHaveLength(5)
  })

  it('filters by default prefix=ai', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({
      '/repos/fastify/fastify/labels': { status: 200, body: allLabels }
    })

    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/labels')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.prefix).toBe('ai')
    expect(body.data.labels.map((l: { name: string }) => l.name)).toEqual([
      'ai-generated',
      'ai-policy'
    ])
  })

  it('filters by custom prefix', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({
      '/repos/fastify/fastify/labels': { status: 200, body: allLabels }
    })

    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/labels?prefix=no')
    const body = await res.json()
    expect(body.data.labels.map((l: { name: string }) => l.name)).toEqual(['no-ai'])
  })

  it('returns empty labels array when GitHub returns no labels', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({
      '/repos/fastify/fastify/labels': { status: 200, body: [] }
    })

    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/labels?prefix=ai')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.labels).toEqual([])
  })

  it('returns empty array when GitHub API fails', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({
      '/repos/fastify/fastify/labels': { status: 403, body: { message: 'Forbidden' } }
    })

    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/labels?prefix=ai')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.labels).toEqual([])
  })

  it('includes correct label fields in response', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({
      '/repos/fastify/fastify/labels': {
        status: 200,
        body: [{ name: 'ai-policy', color: 'fef2c0', description: 'AI policy label' }]
      }
    })

    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/labels?prefix=ai')
    const body = await res.json()
    expect(body.data.labels[0]).toMatchObject({
      name: 'ai-policy',
      color: 'fef2c0',
      description: 'AI policy label'
    })
    expect(body._meta).toMatchObject({
      served_at: expect.any(String)
    })
  })
})

// ============================================================================
// GET /:slug/agents-md
// ============================================================================

describe('GET /:slug/agents-md', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns exists:false when no AGENTS.md found anywhere', async () => {
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({})
    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/agents-md')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.exists).toBe(false)
    expect(body.data.path).toBeNull()
    expect(body.data.raw_text).toBeNull()
  })

  it('returns raw AGENTS.md content from repo root', async () => {
    const agents = `# Agent Directives\n\nRun \`pnpm test\` before submitting. Never touch files in src/compiler/transformers/.`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    mockFetch({
      '/repos/fastify/fastify/contents/AGENTS.md': {
        status: 200,
        body: { ...makeBase64File(agents), path: 'AGENTS.md' }
      }
    })

    const app = createTestApp(kv)
    const res = await app.request('/fastify-fastify/agents-md')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.exists).toBe(true)
    expect(body.data.path).toBe('AGENTS.md')
    expect(body.data.raw_text).toBe(agents)
  })

  it('falls through to .github/AGENTS.md when root is missing', async () => {
    const agents = `## Rules for LLM contributors`
    const kv = createMockKV({
      'recon:fastify-fastify': makeConsolidatedReconData()
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url
      if (/\/contents\/\.github\/AGENTS\.md$/.test(url)) {
        return new Response(
          JSON.stringify({ ...makeBase64File(agents), path: '.github/AGENTS.md' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    })

    const app = createTestApp(kv, 'test-token')
    const res = await app.request('/fastify-fastify/agents-md')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.exists).toBe(true)
    expect(body.data.path).toBe('.github/AGENTS.md')
    expect(body.data.raw_text).toBe(agents)
  })
})
