import { describe, it, expect } from 'vitest'
import { compileDossier } from '../dossier-compiler'
import { makeRepoMeta, makeRepoHealth, makeScoredIssue, makePRSample } from './helpers'

describe('compileDossier', () => {
  describe('output shape', () => {
    it('returns valid Dossier with all 6 sections', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth()
      const result = compileDossier('fastify-fastify', meta, health, [], [], [])

      expect(result.slug).toBe('fastify-fastify')
      expect(result.generatedAt).toBeDefined()
      expect(new Date(result.generatedAt).getTime()).not.toBeNaN()
      expect(result.sections).toHaveProperty('overview')
      expect(result.sections).toHaveProperty('contributionRules')
      expect(result.sections).toHaveProperty('successPatterns')
      expect(result.sections).toHaveProperty('antiPatterns')
      expect(result.sections).toHaveProperty('issueBoard')
      expect(result.sections).toHaveProperty('environmentSetup')
    })
  })

  describe('overview section', () => {
    it('includes repo name and stars', () => {
      const meta = makeRepoMeta({ owner: 'fastify', repo: 'fastify', stars: 30000 })
      const health = makeRepoHealth()
      const result = compileDossier('fastify-fastify', meta, health, [], [], [])

      expect(result.sections.overview).toContain('fastify/fastify')
      expect(result.sections.overview).toContain('30,000')
    })

    it('shows Viable verdict for high viability', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth({ overallViability: 80 })
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.overview).toContain('Viable')
    })

    it('shows Caution verdict for medium viability', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth({ overallViability: 50 })
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.overview).toContain('Caution')
    })

    it('shows Not Viable verdict for low viability', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth({ overallViability: 30 })
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.overview).toContain('Not Viable')
    })

    it('shows kill reason for killed repos', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth({
        killed: true,
        killReason: 'Repository is archived',
        overallViability: 0
      })
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.overview).toContain('Not Viable')
      expect(result.sections.overview).toContain('Repository is archived')
    })

    it('includes quirk warnings', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth({
        detectedQuirks: [
          {
            type: 'changeset-required',
            description: 'Changeset file required for PRs',
            impact: 'blocker',
            evidence: "CONTRIBUTING.md mentions 'changeset'"
          }
        ]
      })
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.overview).toContain('BLOCKER')
      expect(result.sections.overview).toContain('Changeset file required')
    })
  })

  describe('contributionRules section', () => {
    it('includes CONTRIBUTING.md content when present', () => {
      const meta = makeRepoMeta({
        hasContributing: true,
        contributingContent: 'Fork the repo and submit a PR against main.'
      })
      const health = makeRepoHealth()
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.contributionRules).toContain('Fork the repo')
    })

    it('shows default branch and merge style', () => {
      const meta = makeRepoMeta({ defaultBranch: 'develop' })
      const health = makeRepoHealth({
        prPatterns: {
          ...makeRepoHealth().prPatterns,
          mergeStyle: 'rebase'
        }
      })
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.contributionRules).toContain('develop')
      expect(result.sections.contributionRules).toContain('rebase')
    })

    it('shows quirks with evidence', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth({
        detectedQuirks: [
          {
            type: 'cla-required',
            description: 'CLA/DCO signature required',
            impact: 'blocker',
            evidence: "CONTRIBUTING.md mentions 'CLA'"
          }
        ]
      })
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.contributionRules).toContain('cla-required')
      expect(result.sections.contributionRules).toContain('blocker')
    })
  })

  describe('successPatterns section', () => {
    it('includes PR pattern data', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth({
        prPatterns: {
          medianFilesChanged: 5,
          medianAdditions: 100,
          medianTimeToMergeDays: 3.2,
          mergeStyle: 'squash',
          commitConvention: 'conventional',
          externalContributorMergeRate: 0.72,
          topRejectionReasons: []
        }
      })
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.successPatterns).toContain('5')
      expect(result.sections.successPatterns).toContain('100')
      expect(result.sections.successPatterns).toContain('3.2')
      expect(result.sections.successPatterns).toContain('72%')
    })

    it('shows branch prefixes from merged PRs', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth()
      const mergedPRs = [
        makePRSample({ number: 1, headRefName: 'fix/bug-1' }),
        makePRSample({ number: 2, headRefName: 'fix/bug-2' }),
        makePRSample({ number: 3, headRefName: 'feat/new-feature' })
      ]
      const result = compileDossier('test', meta, health, [], mergedPRs, [])

      expect(result.sections.successPatterns).toContain('fix/')
      expect(result.sections.successPatterns).toContain('feat/')
    })
  })

  describe('antiPatterns section', () => {
    it('includes rejection reasons', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth({
        prPatterns: {
          ...makeRepoHealth().prPatterns,
          topRejectionReasons: ['too large', 'wrong branch']
        }
      })
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.antiPatterns).toContain('too large')
      expect(result.sections.antiPatterns).toContain('wrong branch')
    })

    it('shows no anti-patterns message when none detected', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth()
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.antiPatterns).toContain('No significant anti-patterns')
    })
  })

  describe('issueBoard section', () => {
    it('shows top 10 issues as markdown table', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth()
      const issues = Array.from({ length: 15 }, (_, i) =>
        makeScoredIssue({
          id: `issue-${i}`,
          title: `Issue number ${i}`,
          cvs: 90 - i * 5,
          cvsTier: i < 2 ? 'go' : 'maybe'
        })
      )
      const result = compileDossier('test', meta, health, issues, [], [])

      expect(result.sections.issueBoard).toContain('Issue number 0')
      expect(result.sections.issueBoard).toContain('Issue number 9')
      // 11th issue should not appear
      expect(result.sections.issueBoard).not.toContain('Issue number 10')
    })

    it('handles empty issues', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth()
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.issueBoard).toContain('No scored issues available')
    })

    it('truncates long titles', () => {
      const meta = makeRepoMeta()
      const health = makeRepoHealth()
      const issues = [
        makeScoredIssue({
          title:
            'This is a very long issue title that exceeds the maximum display length and should be truncated'
        })
      ]
      const result = compileDossier('test', meta, health, issues, [], [])

      expect(result.sections.issueBoard).toContain('...')
    })
  })

  describe('environmentSetup section', () => {
    it('includes language and tools', () => {
      const meta = makeRepoMeta({
        language: 'TypeScript',
        topics: ['nodejs', 'http', 'web'],
        externalTools: ['CodeRabbit', 'Codecov']
      })
      const health = makeRepoHealth()
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.environmentSetup).toContain('TypeScript')
      expect(result.sections.environmentSetup).toContain('nodejs')
      expect(result.sections.environmentSetup).toContain('CodeRabbit')
    })

    it('shows resource availability', () => {
      const meta = makeRepoMeta({
        hasContributing: true,
        hasPrTemplate: false,
        hasCodeOfConduct: true,
        hasCodeowners: false
      })
      const health = makeRepoHealth()
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.environmentSetup).toContain('CONTRIBUTING.md | Yes')
      expect(result.sections.environmentSetup).toContain('PR Template | No')
      expect(result.sections.environmentSetup).toContain('Code of Conduct | Yes')
      expect(result.sections.environmentSetup).toContain('CODEOWNERS | No')
    })

    it('includes CONTRIBUTING.md link when available', () => {
      const meta = makeRepoMeta({
        owner: 'fastify',
        repo: 'fastify',
        defaultBranch: 'main',
        hasContributing: true
      })
      const health = makeRepoHealth()
      const result = compileDossier('test', meta, health, [], [], [])

      expect(result.sections.environmentSetup).toContain(
        'https://github.com/fastify/fastify/blob/main/CONTRIBUTING.md'
      )
    })
  })
})
