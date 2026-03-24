/**
 * Production Data Integration Test
 *
 * Feeds real scraped data from the hadoku-scraper (fastify/fastify)
 * through the full scoring pipeline: health → issues → dossier.
 *
 * This validates that real-world data produces sensible scores.
 */

import { describe, it, expect } from 'vitest'
import { createReconRoutes } from '../index'
import { createMockKV, createMockExecutionCtx } from './helpers'
import { scoreRepoHealth } from '../health-scorer'
import { scoreIssues } from '../issue-scorer'
import { compileDossier } from '../dossier-compiler'
import { formatIssueBrief } from '../issue-brief'
import type {
  RepoMeta,
  PRSample,
  ConsolidatedReconData,
  ExtendedIssue,
  IssueComments,
  CommentThread,
  ScoredIssue,
  RepoHealth,
  Dossier
} from '../types'

// Load real scraped data from fixtures
import metaFixture from './fixtures/fastify-meta.json'
import issuesFixture from './fixtures/fastify-issues.json'
import prsFixture from './fixtures/fastify-prs.json'
import commentsFixture from './fixtures/fastify-comments.json'

// ============================================================================
// Data Extraction — map scraper response format to KV format
// ============================================================================

const SLUG = 'fastify-fastify'

const repoMeta: RepoMeta = metaFixture.data.meta as RepoMeta

const mergedPRs: PRSample[] = prsFixture.data.merged as PRSample[]
const rejectedPRs: PRSample[] = prsFixture.data.rejected as PRSample[]

const issues: ExtendedIssue[] = issuesFixture.data.items as ExtendedIssue[]

// Re-key comments from issue-number → compound-ID
// Scraper uses issue number as keys; scorer expects compound ID
const rawThreads = commentsFixture.data.threads as Record<string, CommentThread>
const comments: IssueComments = {}
for (const [issueNumber, thread] of Object.entries(rawThreads)) {
  const compoundId = `github-fastify-fastify-${issueNumber}`
  comments[compoundId] = thread
}

// Build consolidated recon data (new single-key format)
const consolidatedRecon: ConsolidatedReconData = {
  scrapedAt: repoMeta.scrapedAt,
  source: 'hadoku-scraper',
  platform: 'github',
  issues,
  mergedPrs: mergedPRs,
  rejectedPrs: rejectedPRs,
  repoMeta,
  comments: { threads: comments },
  dataTypes: ['issues', 'prs', 'meta', 'comments'],
  errors: null
}

// ============================================================================
// Helper
// ============================================================================

function createTestApp(kv: KVNamespace) {
  const app = createReconRoutes()
  return {
    request: (path: string, init?: RequestInit) => {
      const req = new Request(`http://localhost${path}`, init)
      return app.fetch(req, { CACHE_KV: kv }, createMockExecutionCtx())
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Production Data: fastify/fastify', () => {
  // --------------------------------------------------------------------------
  // Fixture sanity checks
  // --------------------------------------------------------------------------
  describe('fixture data sanity', () => {
    it('loaded all fixture data', () => {
      expect(repoMeta.owner).toBe('fastify')
      expect(repoMeta.repo).toBe('fastify')
      expect(repoMeta.stars).toBeGreaterThan(30000)
      expect(issues.length).toBe(76)
      expect(mergedPRs.length).toBe(10)
      expect(rejectedPRs.length).toBe(8)
      expect(Object.keys(comments).length).toBe(20)
    })

    it('issues have expected structure', () => {
      for (const issue of issues) {
        expect(issue.id).toMatch(/^github-fastify-fastify-\d+$/)
        expect(issue.platform).toBe('github')
        expect(issue.project).toBe('fastify/fastify')
        expect(issue.title).toBeTruthy()
        expect(issue.url).toContain('github.com/fastify/fastify')
        expect(typeof issue.commentCount).toBe('number')
        expect(typeof issue.thumbsUpCount).toBe('number')
        expect(Array.isArray(issue.assignees)).toBe(true)
      }
    })

    it('PRs have expected structure', () => {
      for (const pr of mergedPRs) {
        expect(pr.mergedAt).toBeTruthy()
        expect(typeof pr.additions).toBe('number')
        expect(typeof pr.reviewCount).toBe('number')
      }
      for (const pr of rejectedPRs) {
        expect(pr.closedAt).toBeTruthy()
        expect(pr.mergedAt).toBeNull()
      }
    })
  })

  // --------------------------------------------------------------------------
  // Health Scoring
  // --------------------------------------------------------------------------
  describe('health scoring', () => {
    let health: RepoHealth

    it('scores repo health without errors', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      expect(health).toBeDefined()
      expect(health.slug).toBe(SLUG)
    })

    it('fastify is NOT killed', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      expect(health.killed).toBe(false)
      expect(health.killReason).toBeNull()
    })

    it('has positive viability scores', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      expect(health.overallViability).toBeGreaterThan(0)
      expect(health.maintainerHealthScore).toBeGreaterThan(0)
      expect(health.mergeAccessibilityScore).toBeGreaterThan(0)
      expect(health.availabilityScore).toBeGreaterThan(0)
    })

    it('all scores are within 0-100 range', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      for (const key of [
        'overallViability',
        'maintainerHealthScore',
        'mergeAccessibilityScore',
        'availabilityScore'
      ] as const) {
        expect(health[key]).toBeGreaterThanOrEqual(0)
        expect(health[key]).toBeLessThanOrEqual(100)
      }
    })

    it('detects PR patterns', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      expect(health.prPatterns).toBeDefined()
      expect(typeof health.prPatterns.medianFilesChanged).toBe('number')
      expect(typeof health.prPatterns.medianAdditions).toBe('number')
      expect(typeof health.prPatterns.medianTimeToMergeDays).toBe('number')
      expect(typeof health.prPatterns.externalContributorMergeRate).toBe('number')
    })

    it('has a reasonable viability for an active popular repo', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      // Fastify is a very active, well-maintained repo — viability should be decent
      expect(health.overallViability).toBeGreaterThan(30)
    })
  })

  // --------------------------------------------------------------------------
  // Issue Scoring (CVS)
  // --------------------------------------------------------------------------
  describe('issue scoring (CVS)', () => {
    let health: RepoHealth
    let scored: ScoredIssue[]

    it('scores all issues without errors', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      expect(scored).toBeDefined()
      expect(scored.length).toBe(76)
    })

    it('every scored issue has required CVS fields', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      for (const issue of scored) {
        expect(typeof issue.cvs).toBe('number')
        expect(['go', 'likely', 'maybe', 'risky', 'skip']).toContain(issue.cvsTier)
        expect(['fresh', 'triaged', 'accepted', 'stale', 'zombie']).toContain(issue.lifecycleStage)
        expect(['unclaimed', 'claimed', 'stale-claim']).toContain(issue.claimStatus)
        expect(['low', 'medium', 'high']).toContain(issue.complexity)
        expect(typeof issue.sentimentScore).toBe('number')
        expect(typeof issue.contentQualityScore).toBe('number')
        expect(['none', 'low', 'medium', 'high']).toContain(issue.competitionLevel)
        expect(typeof issue.repoKilled).toBe('boolean')
      }
    })

    it('every scored issue has _scoring metadata', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      for (const issue of scored) {
        expect(issue._scoring).toBeDefined()
        expect(typeof issue._scoring.scored_at).toBe('string')
        expect(new Date(issue._scoring.scored_at).getTime()).not.toBeNaN()
        expect(issue._scoring.data_completeness).toMatch(/^(full|partial)$/)
        expect(Array.isArray(issue._scoring.signals_used)).toBe(true)
        expect(issue._scoring.signals_available).toHaveLength(7)
        // Every signal name should be a known signal
        for (const signal of issue._scoring.signals_used) {
          expect(issue._scoring.signals_available).toContain(signal)
        }
      }
    })

    it('_scoring.scored_at is consistent across all issues', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      const timestamps = new Set(scored.map(i => i._scoring.scored_at))
      expect(timestamps.size).toBe(1)
    })

    it('CVS scores are within 0-100 range', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      for (const issue of scored) {
        expect(issue.cvs).toBeGreaterThanOrEqual(0)
        expect(issue.cvs).toBeLessThanOrEqual(100)
      }
    })

    it('issues are sorted by CVS descending', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      for (let i = 1; i < scored.length; i++) {
        expect(scored[i - 1].cvs).toBeGreaterThanOrEqual(scored[i].cvs)
      }
    })

    it('produces meaningful score differentiation', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      const scores = scored.map(s => s.cvs)
      const min = Math.min(...scores)
      const max = Math.max(...scores)
      const spread = max - min

      // With 75 real issues, we expect at least some differentiation
      expect(spread).toBeGreaterThan(5)
    })

    it('produces multiple CVS tiers', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      const tiers = new Set(scored.map(s => s.cvsTier))
      // Real data should produce at least 2 different tiers
      expect(tiers.size).toBeGreaterThanOrEqual(2)
    })

    it('produces multiple lifecycle stages', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      const stages = new Set(scored.map(s => s.lifecycleStage))
      // With issues ranging from 2020 to 2026, we expect multiple stages
      expect(stages.size).toBeGreaterThanOrEqual(2)
    })

    it('preserves original issue data', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      // Check that the first scored issue preserves the original fields
      const first = scored[0]
      expect(first.id).toMatch(/^github-fastify-fastify-\d+$/)
      expect(first.platform).toBe('github')
      expect(first.project).toBe('fastify/fastify')
      expect(first.title).toBeTruthy()
      expect(first.url).toContain('github.com/fastify/fastify')
    })

    it('no issues are marked as repoKilled', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      for (const issue of scored) {
        expect(issue.repoKilled).toBe(false)
      }
    })

    it('sentiment scores are within expected range', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      for (const issue of scored) {
        expect(issue.sentimentScore).toBeGreaterThanOrEqual(-1)
        expect(issue.sentimentScore).toBeLessThanOrEqual(1)
      }
    })
  })

  // --------------------------------------------------------------------------
  // Dossier Compilation
  // --------------------------------------------------------------------------
  describe('dossier compilation', () => {
    let health: RepoHealth
    let scored: ScoredIssue[]
    let dossier: Dossier

    it('compiles dossier without errors', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      dossier = compileDossier(SLUG, repoMeta, health, scored, mergedPRs, rejectedPRs)
      expect(dossier).toBeDefined()
    })

    it('has all 6 sections', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      dossier = compileDossier(SLUG, repoMeta, health, scored, mergedPRs, rejectedPRs)

      expect(dossier.sections.overview).toBeTruthy()
      expect(dossier.sections.contributionRules).toBeTruthy()
      expect(dossier.sections.successPatterns).toBeTruthy()
      expect(dossier.sections.antiPatterns).toBeTruthy()
      expect(dossier.sections.issueBoard).toBeTruthy()
      expect(dossier.sections.environmentSetup).toBeTruthy()
    })

    it('overview mentions fastify', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      dossier = compileDossier(SLUG, repoMeta, health, scored, mergedPRs, rejectedPRs)

      expect(dossier.sections.overview.toLowerCase()).toContain('fastify')
    })

    it('overview includes star count and language', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      dossier = compileDossier(SLUG, repoMeta, health, scored, mergedPRs, rejectedPRs)

      expect(dossier.sections.overview).toContain('35')
      expect(dossier.sections.overview).toContain('JavaScript')
    })

    it('contribution rules section has content from CONTRIBUTING.md', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      dossier = compileDossier(SLUG, repoMeta, health, scored, mergedPRs, rejectedPRs)

      // Fastify has a CONTRIBUTING.md — the dossier should reference it
      expect(dossier.sections.contributionRules.length).toBeGreaterThan(50)
    })

    it('issue board lists top issues', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      dossier = compileDossier(SLUG, repoMeta, health, scored, mergedPRs, rejectedPRs)

      // Issue board should contain issue references
      expect(dossier.sections.issueBoard.length).toBeGreaterThan(100)
    })

    it('all sections are markdown strings', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      dossier = compileDossier(SLUG, repoMeta, health, scored, mergedPRs, rejectedPRs)

      for (const section of Object.values(dossier.sections)) {
        expect(typeof section).toBe('string')
        expect(section.length).toBeGreaterThan(0)
      }
    })

    it('has generatedAt timestamp', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      dossier = compileDossier(SLUG, repoMeta, health, scored, mergedPRs, rejectedPRs)

      expect(dossier.generatedAt).toBeTruthy()
      expect(new Date(dossier.generatedAt).getTime()).toBeGreaterThan(0)
    })

    it('has completeness field with per-section booleans', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      dossier = compileDossier(SLUG, repoMeta, health, scored, mergedPRs, rejectedPRs)

      expect(dossier.completeness).toBeDefined()
      expect(typeof dossier.completeness.overview).toBe('boolean')
      expect(typeof dossier.completeness.contributionRules).toBe('boolean')
      expect(typeof dossier.completeness.successPatterns).toBe('boolean')
      expect(typeof dossier.completeness.antiPatterns).toBe('boolean')
      expect(typeof dossier.completeness.issueBoard).toBe('boolean')
      expect(typeof dossier.completeness.environmentSetup).toBe('boolean')
      expect(dossier.completeness.total).toBe(6)
      expect(dossier.completeness.score).toBeGreaterThanOrEqual(0)
      expect(dossier.completeness.score).toBeLessThanOrEqual(6)
    })

    it('fastify dossier has high completeness (active popular repo)', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      dossier = compileDossier(SLUG, repoMeta, health, scored, mergedPRs, rejectedPRs)

      // Fastify is a well-maintained repo with issues, PRs, and contributing docs
      expect(dossier.completeness.overview).toBe(true)
      expect(dossier.completeness.contributionRules).toBe(true)
      expect(dossier.completeness.successPatterns).toBe(true)
      expect(dossier.completeness.issueBoard).toBe(true)
      expect(dossier.completeness.environmentSetup).toBe(true)
      expect(dossier.completeness.score).toBeGreaterThanOrEqual(5)
    })
  })

  // --------------------------------------------------------------------------
  // Full Pipeline via Route Handlers
  // --------------------------------------------------------------------------
  describe('full pipeline via routes', () => {
    // Pre-compute data that routes now require from KV
    const preHealth = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
    const preScored = scoreIssues(issues, comments, preHealth, [])
    const preDossier = compileDossier(SLUG, repoMeta, preHealth, preScored, mergedPRs, rejectedPRs)

    function buildKV() {
      return createMockKV({
        'recon:fastify-fastify': consolidatedRecon,
        'recon:fastify-fastify:claims': [],
        'recon:fastify-fastify:health': preHealth,
        'recon:fastify-fastify:scored-issues': preScored,
        'recon:fastify-fastify:dossier': preDossier
      })
    }

    it('GET /:slug/health returns valid health data', async () => {
      const app = createTestApp(buildKV())
      const res = await app.request(`/${SLUG}/health`)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.slug).toBe(SLUG)
      expect(body.data.killed).toBe(false)
      expect(body.data.overallViability).toBeGreaterThan(0)
      expect(typeof body.data.maintainerHealthScore).toBe('number')
      expect(typeof body.data.mergeAccessibilityScore).toBe('number')
      expect(typeof body.data.availabilityScore).toBe('number')
    })

    it('GET /:slug/scored-issues returns scored issues', async () => {
      const app = createTestApp(buildKV())
      const res = await app.request(`/${SLUG}/scored-issues`)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.issues.length).toBe(76)
      expect(body.data.slug).toBe(SLUG)

      // Verify first issue (highest CVS) has expected structure
      const top = body.data.issues[0]
      expect(typeof top.cvs).toBe('number')
      expect(top.cvs).toBeGreaterThan(0)
      expect(['go', 'likely', 'maybe', 'risky', 'skip']).toContain(top.cvsTier)
      expect(top.repoKilled).toBe(false)
    })

    it('GET /:slug/dossier returns 6-section dossier', async () => {
      const app = createTestApp(buildKV())
      const res = await app.request(`/${SLUG}/dossier`)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.sections.overview).toBeTruthy()
      expect(body.data.sections.contributionRules).toBeTruthy()
      expect(body.data.sections.successPatterns).toBeTruthy()
      expect(body.data.sections.antiPatterns).toBeTruthy()
      expect(body.data.sections.issueBoard).toBeTruthy()
      expect(body.data.sections.environmentSetup).toBeTruthy()
      expect(body.data.generatedAt).toBeTruthy()
    })

    it('GET /all-scored-issues returns issues from all scraped repos', async () => {
      const app = createTestApp(buildKV())
      const res = await app.request('/all-scored-issues')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.issues.length).toBe(76)
      expect(body.data.totalCount).toBe(76)
      expect(body.data.repoCount).toBe(1)

      // All issues should be from fastify-fastify
      for (const issue of body.data.issues) {
        expect(issue.repoSlug).toBe(SLUG)
      }
    })

    it('GET /:slug/issue-brief/:issueId returns brief with new sections', async () => {
      const app = createTestApp(buildKV())
      // Use the first issue from the fixture
      const firstIssueId = issues[0].id
      const res = await app.request(`/${SLUG}/issue-brief/${firstIssueId}`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        success: boolean
        data: { issue: ScoredIssue; repoHealth: RepoHealth; brief: string }
      }
      expect(body.success).toBe(true)
      expect(body.data.brief).toBeTruthy()

      const brief = body.data.brief

      // Critical Rules section is present and before Issue Details
      expect(brief).toContain('## CRITICAL RULES (Read First)')
      const rulesIdx = brief.indexOf('## CRITICAL RULES (Read First)')
      const detailsIdx = brief.indexOf('## Issue Details')
      expect(rulesIdx).toBeLessThan(detailsIdx)

      // Critical rules content
      expect(brief).toContain('DO NOT use GitHub MCP tools')
      expect(brief).toContain('DO NOT add Closes, Fixes, or Resolves')

      // Environment Setup section is present and before Issue Details
      expect(brief).toContain('## Environment Setup')
      const setupIdx = brief.indexOf('## Environment Setup')
      expect(setupIdx).toBeLessThan(detailsIdx)

      // Since fastify is JavaScript and no devEnvironment, should have inferred hints
      expect(brief).toContain('**Language:** JavaScript')
      expect(brief).toContain('Check for lock file to determine package manager')
      expect(brief).toContain('npm test')

      // Other existing sections still present
      expect(brief).toContain('## Contribution Rules (MUST FOLLOW)')
      expect(brief).toContain('## What Gets PRs Merged Here')
      expect(brief).toContain('## Environment')
    })
  })

  // --------------------------------------------------------------------------
  // Related Issues & Likely Files
  // --------------------------------------------------------------------------
  describe('related issues and likely files', () => {
    let health: RepoHealth
    let scored: ScoredIssue[]

    it('every scored issue has likelyFiles and relatedIssues arrays', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      for (const issue of scored) {
        expect(Array.isArray(issue.likelyFiles)).toBe(true)
        expect(Array.isArray(issue.relatedIssues)).toBe(true)
      }
    })

    it('relatedIssues entries have valid structure', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      for (const issue of scored) {
        for (const related of issue.relatedIssues) {
          expect(typeof related.id).toBe('string')
          expect(related.id).toMatch(/^github-fastify-fastify-\d+$/)
          expect(typeof related.similarity).toBe('number')
          expect(related.similarity).toBeGreaterThanOrEqual(0)
          expect(related.similarity).toBeLessThanOrEqual(1)
          expect(typeof related.reason).toBe('string')
          expect(related.reason.length).toBeGreaterThan(0)
        }
      }
    })

    it('relatedIssues are capped at 5 per issue', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      for (const issue of scored) {
        expect(issue.relatedIssues.length).toBeLessThanOrEqual(5)
      }
    })

    it('relatedIssues are sorted by similarity descending', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      for (const issue of scored) {
        for (let i = 1; i < issue.relatedIssues.length; i++) {
          expect(issue.relatedIssues[i - 1].similarity).toBeGreaterThanOrEqual(
            issue.relatedIssues[i].similarity
          )
        }
      }
    })

    it('related issue detection runs without errors on all 76 issues', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      // Detection should complete without errors; whether any overlap is found
      // depends on the specific issue content (file references, text similarity)
      const withRelated = scored.filter(i => i.relatedIssues.length > 0)
      const withFiles = scored.filter(i => i.likelyFiles.length > 0)

      // With full body data, we expect meaningful file path extraction
      expect(withFiles.length).toBeGreaterThanOrEqual(3)
      expect(typeof withRelated.length).toBe('number')
    })

    it('relatedIssues do not reference themselves', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      for (const issue of scored) {
        const selfRef = issue.relatedIssues.find(r => r.id === issue.id)
        expect(selfRef).toBeUndefined()
      }
    })
  })

  // --------------------------------------------------------------------------
  // Issue Brief with Production Data
  // --------------------------------------------------------------------------
  describe('issue brief formatting', () => {
    let health: RepoHealth
    let scored: ScoredIssue[]

    it('generates brief for top-scored issue without errors', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      const brief = formatIssueBrief(scored[0], health, repoMeta, mergedPRs, rejectedPRs)

      expect(brief).toBeTruthy()
      expect(typeof brief).toBe('string')
      expect(brief.length).toBeGreaterThan(200)
    })

    it('brief has correct section ordering', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      const brief = formatIssueBrief(scored[0], health, repoMeta, mergedPRs, rejectedPRs)

      const sections = [
        '# Task:',
        '## CRITICAL RULES (Read First)',
        '## Environment Setup',
        '## Issue Details',
        '## Contribution Rules (MUST FOLLOW)',
        '## What Gets PRs Merged Here',
        '## What Gets PRs Rejected',
        '## Quirks & Blockers',
        '\n## Environment\n'
      ]

      let lastIdx = -1
      for (const section of sections) {
        const idx = brief.indexOf(section)
        expect(idx).toBeGreaterThan(lastIdx)
        lastIdx = idx
      }
    })

    it('brief includes real CONTRIBUTING.md content from fastify', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      const brief = formatIssueBrief(scored[0], health, repoMeta, mergedPRs, rejectedPRs)

      // Fastify has CONTRIBUTING.md content
      expect(brief).toContain('### CONTRIBUTING.md')
      expect(brief).toContain('Fastify')
    })

    it('brief infers JavaScript environment hints', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])
      const brief = formatIssueBrief(scored[0], health, repoMeta, mergedPRs, rejectedPRs)

      // Fastify is JavaScript, no devEnvironment — should infer hints
      expect(brief).toContain('**Language:** JavaScript')
      expect(brief).toContain('Check for lock file to determine package manager')
      expect(brief).toContain('npm test')
    })

    it('generates briefs for all 76 issues without errors', () => {
      health = scoreRepoHealth(repoMeta, mergedPRs, rejectedPRs)
      scored = scoreIssues(issues, comments, health, [])

      for (const issue of scored) {
        const brief = formatIssueBrief(issue, health, repoMeta, mergedPRs, rejectedPRs)
        expect(brief).toBeTruthy()
        expect(brief).toContain(`# Task: ${issue.title}`)
        expect(brief).toContain('## CRITICAL RULES (Read First)')
        expect(brief).toContain('## Environment Setup')
      }
    })
  })
})
